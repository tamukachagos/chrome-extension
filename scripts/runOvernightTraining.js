#!/usr/bin/env node
/**
 * Overnight autonomous training coordinator.
 *
 * Runs synthetic generation, deterministic test validation, engine scoring, and
 * optional browser-tab opening in repeated cycles.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const LOG_DIR = path.join(ROOT, "training", "overnight_runs");
const BROWSER_SCENARIOS = path.join(ROOT, "training", "browser_tab_scenarios.json");

const args = parseArgs(process.argv.slice(2));
const hours = Number(args.hours || 8);
const intervalMinutes = Number(args["interval-minutes"] || 30);
const once = Boolean(args.once);
const openBrowser = Boolean(args["open-browser"]);
const heartbeatMinutes = Number(args["heartbeat-minutes"] || 1);

function parseArgs(raw) {
  const parsed = {};
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = raw[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function runNode(script, extraArgs = []) {
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...extraArgs], {
    cwd: ROOT,
    encoding: "utf8"
  });

  return {
    script,
    command: `node ${script} ${extraArgs.join(" ")}`.trim(),
    status: result.status,
    ok: result.status === 0,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function openConfiguredTabs() {
  const scenario = JSON.parse(fs.readFileSync(BROWSER_SCENARIOS, "utf8"));
  const opened = [];

  for (const tab of scenario.open_tabs || []) {
    if (!/^https?:\/\//i.test(tab.url)) {
      opened.push({ ...tab, ok: false, error: "Only http/https URLs are supported" });
      continue;
    }

    const result = process.platform === "win32"
      ? spawnSync("powershell", ["-NoProfile", "-Command", "Start-Process", tab.url], { encoding: "utf8" })
      : spawnSync(process.platform === "darwin" ? "open" : "xdg-open", [tab.url], { encoding: "utf8" });

    opened.push({
      ...tab,
      ok: result.status === 0,
      status: result.status,
      stderr: result.stderr
    });
  }

  return opened;
}

function sleep(ms, onHeartbeat) {
  const started = Date.now();
  let nextHeartbeat = started + heartbeatMinutes * 60 * 1000;

  return new Promise((resolve) => {
    const tick = () => {
      const now = Date.now();
      if (now >= started + ms) {
        resolve();
        return;
      }

      if (now >= nextHeartbeat) {
        onHeartbeat?.(Math.ceil((started + ms - now) / 1000));
        nextHeartbeat = now + heartbeatMinutes * 60 * 1000;
      }

      setTimeout(tick, Math.min(1000, started + ms - now));
    };

    tick();
  });
}

async function main() {
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("--hours must be a positive number");
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) throw new Error("--interval-minutes must be a positive number");

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const startedAt = new Date();
  const deadline = new Date(startedAt.getTime() + hours * 60 * 60 * 1000);
  const runId = startedAt.toISOString().replace(/[:.]/g, "-");
  const runLogPath = path.join(LOG_DIR, `overnight-${runId}.json`);
  const runLog = {
    started_at: startedAt.toISOString(),
    hours,
    interval_minutes: intervalMinutes,
    open_browser: openBrowser,
    deadline_at: deadline.toISOString(),
    cycles: []
  };
  let interrupted = false;

  const writeRunLog = () => {
    fs.writeFileSync(runLogPath, `${JSON.stringify(runLog, null, 2)}\n`, "utf8");
  };

  process.on("SIGINT", () => {
    interrupted = true;
    runLog.interrupted_at = new Date().toISOString();
    writeRunLog();
    console.log(`\nInterrupted. Partial overnight training log: ${runLogPath}`);
    process.exit(130);
  });

  console.log(`Overnight training started: ${startedAt.toLocaleString()}`);
  console.log(`Deadline: ${deadline.toLocaleString()}`);
  console.log(`Interval: ${intervalMinutes} minute(s)`);

  let cycle = 0;
  do {
    cycle += 1;
    const cycleStarted = new Date();
    const cycleLog = {
      cycle,
      started_at: cycleStarted.toISOString(),
      browser_tabs: [],
      steps: []
    };

    console.log(`\n=== Overnight Training Cycle ${cycle} ===`);

    if (openBrowser) {
      cycleLog.browser_tabs = openConfiguredTabs();
      console.log(`  Browser tabs opened: ${cycleLog.browser_tabs.filter((tab) => tab.ok).length}/${cycleLog.browser_tabs.length}`);
    }

    const steps = [
      ["scripts/generateSyntheticData.js", []],
      ["scripts/buildBulkSyntheticTraining.js", []],
      ["scripts/testRunner.js", []],
      ["scripts/trainDeterministicEngine.js", []]
    ];

    for (const [script, extraArgs] of steps) {
      const result = runNode(script, extraArgs);
      cycleLog.steps.push(result);
      console.log(`  ${result.ok ? "PASS" : "FAIL"} ${result.command}`);
      if (!result.ok) break;
    }

    cycleLog.finished_at = new Date().toISOString();
    runLog.cycles.push(cycleLog);
    writeRunLog();

    if (once) break;
    if (new Date() >= deadline) break;
    if (interrupted) break;

    const nextRunAt = new Date(Date.now() + intervalMinutes * 60 * 1000);
    console.log(`  Cycle ${cycle} complete. Sleeping until ${nextRunAt.toLocaleString()}...`);
    await sleep(intervalMinutes * 60 * 1000, (remainingSeconds) => {
      const minutes = Math.ceil(remainingSeconds / 60);
      console.log(`  Waiting for next cycle: about ${minutes} minute(s) remaining`);
    });
  } while (new Date() < deadline);

  runLog.finished_at = new Date().toISOString();
  writeRunLog();
  console.log(`\nOvernight training log: ${runLogPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
