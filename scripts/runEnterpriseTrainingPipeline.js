#!/usr/bin/env node
/**
 * Reproducible enterprise-style training pipeline entrypoint.
 */

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const browser = args.includes("--browser");

const steps = [
  ["Generate synthetic corpus", ["scripts/generateSyntheticData.js"]],
  ["Build bulk synthetic corpus", ["scripts/buildBulkSyntheticTraining.js"]],
  ["Structural validation", ["scripts/testRunner.js"]],
  ["Deterministic quality gates", ["scripts/trainDeterministicEngine.js", strict ? "--strict" : "--gated"]]
];

if (browser) {
  steps.push(["Controlled browser smoke", ["scripts/browserSmokeTest.js"]]);
}

let failed = false;

console.log("\n=== Enterprise Training Pipeline ===");
for (const [name, command] of steps) {
  const [script, ...scriptArgs] = command;
  const result = spawnSync(process.execPath, [path.join(ROOT, script), ...scriptArgs], {
    cwd: ROOT,
    encoding: "utf8"
  });

  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  console.log(`  ${result.status === 0 ? "PASS" : "FAIL"} ${name}`);

  if (result.status !== 0) {
    failed = true;
    break;
  }
}

if (failed) process.exit(1);
