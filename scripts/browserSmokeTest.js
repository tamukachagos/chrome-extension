#!/usr/bin/env node
/**
 * Controlled regular-browser-tab smoke tests.
 *
 * This is intentionally read-only: it navigates to configured http/https URLs,
 * captures basic page context, and writes a JSON report. It never submits forms
 * or clicks page controls.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SCENARIO_PATH = path.join(ROOT, "training", "browser_tab_scenarios.json");
const REPORT_DIR = path.join(ROOT, "training", "browser_reports");
const LATEST_REPORT = path.join(ROOT, "training", "browser_smoke_report.json");

async function main() {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (error) {
    throw new Error("Playwright is not installed. Run: npm install");
  }

  const scenario = JSON.parse(fs.readFileSync(SCENARIO_PATH, "utf8"));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true
  });

  const report = {
    generated_at: new Date().toISOString(),
    source: SCENARIO_PATH,
    pages: []
  };

  for (const tab of scenario.open_tabs || []) {
    const pageReport = {
      name: tab.name,
      url: tab.url,
      purpose: tab.purpose,
      ok: false,
      status: null,
      title: "",
      final_url: "",
      headings: [],
      links_sample: [],
      visible_text_length: 0,
      error: null
    };

    if (!/^https?:\/\//i.test(tab.url)) {
      pageReport.error = "Only http/https URLs can be tested";
      report.pages.push(pageReport);
      continue;
    }

    const page = await context.newPage();
    try {
      const response = await page.goto(tab.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(750);

      pageReport.status = response ? response.status() : null;
      pageReport.title = await page.title();
      pageReport.final_url = page.url();
      pageReport.headings = await page.locator("h1,h2,h3").evaluateAll((nodes) =>
        nodes.slice(0, 10).map((node) => node.textContent.trim()).filter(Boolean)
      );
      pageReport.links_sample = await page.locator("a[href]").evaluateAll((nodes) =>
        nodes.slice(0, 15).map((node) => ({
          text: node.textContent.trim().slice(0, 80),
          href: node.href
        })).filter((link) => link.text || link.href)
      );
      pageReport.visible_text_length = (await page.locator("body").innerText({ timeout: 5000 })).length;
      pageReport.ok = Boolean(pageReport.title || pageReport.visible_text_length > 0);
    } catch (error) {
      pageReport.error = error.message;
    } finally {
      await page.close();
    }

    report.pages.push(pageReport);
  }

  await browser.close();
  report.ok = report.pages.every((page) => page.ok);
  writeReport(report);
  printSummary(report);

  if (!report.ok) process.exitCode = 1;
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.generated_at.replace(/[:.]/g, "-");
  const reportPath = path.join(REPORT_DIR, `browser-smoke-${stamp}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(LATEST_REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function printSummary(report) {
  console.log("\n=== Browser Smoke Test ===");
  for (const page of report.pages) {
    console.log(`  ${page.ok ? "PASS" : "FAIL"} ${page.name} ${page.url}`);
    if (page.error) console.log(`    ${page.error}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
