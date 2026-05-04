#!/usr/bin/env node
/**
 * Scores the deterministic DAX engine against training/test_suite.json and
 * writes a report that can drive rule and matcher improvements.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SUITE_PATH = path.join(ROOT, "training", "test_suite.json");
const RULES_PATH = path.join(ROOT, "training", "rules_advanced.json");
const ENGINE_PATH = path.join(ROOT, "src", "daxEngine.js");
const REPORT_DIR = path.join(ROOT, "training", "reports");
const LATEST_REPORT = path.join(ROOT, "training", "training_report.json");
const LATEST_MARKDOWN_REPORT = path.join(ROOT, "training", "training_report.md");
const QUALITY_GATES_PATH = path.join(ROOT, "training", "quality_gates.json");
const NEGATIVE_CONFIDENCE_THRESHOLD = Number(process.env.TRAIN_NEGATIVE_THRESHOLD || 0.6);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadEngine() {
  const sandbox = {
    window: {},
    console,
    require,
    Date,
    setTimeout,
    clearTimeout
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(ENGINE_PATH, "utf8"), sandbox, { filename: ENGINE_PATH });

  if (!sandbox.window.PowerBIDaxEngine) {
    throw new Error("PowerBIDaxEngine was not exposed by src/daxEngine.js");
  }

  return sandbox.window.PowerBIDaxEngine;
}

function expectedRuleId(test) {
  const value = test.expected_rule || test.expected_issue || "";
  const match = String(value).match(/\badv-[a-z]+-\d+\b/i);
  return match ? match[0] : "";
}

function expectedText(test) {
  return String(test.expected_issue || "").split(":").slice(1).join(":").trim().toLowerCase();
}

function topResult(results) {
  return results[0] || null;
}

function compactResult(result) {
  if (!result) return null;
  return {
    rule_id: result.rule?.id || null,
    issue: result.issue,
    confidence: Number((result.confidence || 0).toFixed(4)),
    fix_type: result.fix_type
  };
}

function positivePass(test, results) {
  const id = expectedRuleId(test);
  const text = expectedText(test);
  const top = topResult(results);

  if (!top) return false;
  if (id && top.rule?.id === id) return true;
  if (text && String(top.issue || "").toLowerCase().includes(text.slice(0, 60))) return true;
  return false;
}

function edgePass(test, results) {
  if (!results.length) return false;
  const id = expectedRuleId(test);
  if (!id) return true;
  return results.some((result) => result.rule?.id === id);
}

function evaluate() {
  const suite = readJson(SUITE_PATH);
  const rules = readJson(RULES_PATH);
  const engine = loadEngine();
  engine.setRules(rules);

  const report = {
    generated_at: new Date().toISOString(),
    thresholds: {
      negative_confidence: NEGATIVE_CONFIDENCE_THRESHOLD
    },
    counts: {
      rules: rules.length,
      positive: suite.positive_cases?.length || 0,
      negative: suite.negative_cases?.length || 0,
      edge: suite.edge_cases?.length || 0,
      cross_measure: suite.cross_measure_cases?.length || 0
    },
    stats: {
      positive_passed: 0,
      positive_missed: 0,
      positive_wrong_top_rule: 0,
      negative_passed: 0,
      false_positives: 0,
      edge_passed: 0,
      edge_missed: 0,
      cross_measure_passed: 0,
      cross_measure_missed: 0,
      cross_measure_false_positives: 0
    },
    coverage: {
      rules_with_positive_examples: 0,
      rules_with_hits: 0,
      uncovered_rule_ids: []
    },
    misses: [],
    false_positives: [],
    wrong_top_rules: [],
    edge_misses: [],
    cross_measure_misses: [],
    cross_measure_false_positives: []
  };

  const positiveExpectedIds = new Set();
  const hitRuleIds = new Set();

  for (const test of suite.positive_cases || []) {
    const id = expectedRuleId(test);
    if (id) positiveExpectedIds.add(id);

    const results = engine.analyzeRuleMatches(test.input, test.modelContext || {});
    const top = topResult(results);
    if (top?.rule?.id) hitRuleIds.add(top.rule.id);

    if (!top) {
      report.stats.positive_missed += 1;
      report.misses.push({ name: test.name, expected_rule_id: id, input: test.input });
    } else if (positivePass(test, results)) {
      report.stats.positive_passed += 1;
    } else {
      report.stats.positive_wrong_top_rule += 1;
      report.wrong_top_rules.push({
        name: test.name,
        expected_rule_id: id,
        top: compactResult(top),
        input: test.input
      });
    }
  }

  for (const test of suite.negative_cases || []) {
    const results = engine.analyzeRuleMatches(test.input, test.modelContext || {});
    const top = topResult(results);

    if (top && top.confidence >= NEGATIVE_CONFIDENCE_THRESHOLD) {
      report.stats.false_positives += 1;
      report.false_positives.push({
        name: test.name,
        top: compactResult(top),
        input: test.input
      });
    } else {
      report.stats.negative_passed += 1;
    }
  }

  for (const test of suite.edge_cases || []) {
    const results = engine.analyzeRuleMatches(test.input, test.modelContext || {});
    const top = topResult(results);
    if (top?.rule?.id) hitRuleIds.add(top.rule.id);

    if (edgePass(test, results)) {
      report.stats.edge_passed += 1;
    } else {
      report.stats.edge_missed += 1;
      report.edge_misses.push({
        name: test.name,
        expected_rule_id: expectedRuleId(test),
        top: compactResult(top),
        input: test.input
      });
    }
  }

  for (const test of suite.cross_measure_cases || []) {
    const result = engine.analyzeMultiple(test.measures, test.modelContext || {});
    const interactions = result.crossMeasure || [];

    if (test.expected_interaction_type) {
      // Positive: must detect the named interaction involving the expected measures
      const found = interactions.some((ix) =>
        ix.type === test.expected_interaction_type &&
        (test.expected_measures || []).every((m) => ix.measures.includes(m))
      );
      if (found) {
        report.stats.cross_measure_passed += 1;
      } else {
        report.stats.cross_measure_missed += 1;
        report.cross_measure_misses.push({
          name: test.name,
          expected_type: test.expected_interaction_type,
          expected_measures: test.expected_measures,
          got: interactions.map((i) => ({ type: i.type, measures: i.measures }))
        });
      }
    } else {
      // Negative: must NOT fire the excluded interaction type (or any, if none specified)
      const badType = test.excluded_interaction_type;
      const hasBad = badType
        ? interactions.some((ix) => ix.type === badType)
        : interactions.length > 0;
      if (hasBad) {
        report.stats.cross_measure_false_positives += 1;
        report.cross_measure_false_positives.push({
          name: test.name,
          excluded_type: badType || "(any)",
          got: interactions.map((i) => ({ type: i.type, measures: i.measures }))
        });
      } else {
        report.stats.cross_measure_passed += 1;
      }
    }
  }

  report.coverage.rules_with_positive_examples = positiveExpectedIds.size;
  report.coverage.rules_with_hits = hitRuleIds.size;
  report.coverage.uncovered_rule_ids = rules
    .map((rule) => rule.id)
    .filter((id) => !positiveExpectedIds.has(id));

  report.accuracy = {
    positive_detection_pct: pct(report.stats.positive_passed, report.counts.positive),
    negative_rejection_pct: pct(report.stats.negative_passed, report.counts.negative),
    edge_detection_pct: pct(report.stats.edge_passed, report.counts.edge),
    rule_positive_coverage_pct: pct(report.coverage.rules_with_positive_examples, report.counts.rules),
    cross_measure_detection_pct: pct(report.stats.cross_measure_passed, report.counts.cross_measure)
  };
  report.gates = evaluateQualityGates(report);

  writeReport(report);
  printSummary(report);

  if ((process.argv.includes("--strict") || process.argv.includes("--gated")) && !report.gates.passed) {
    process.exitCode = 1;
  }
}

function pct(numerator, denominator) {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.generated_at.replace(/[:.]/g, "-");
  const reportPath = path.join(REPORT_DIR, `training-report-${stamp}.json`);
  const markdownPath = path.join(REPORT_DIR, `training-report-${stamp}.md`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(LATEST_REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdown = renderMarkdownReport(report);
  fs.writeFileSync(markdownPath, markdown, "utf8");
  fs.writeFileSync(LATEST_MARKDOWN_REPORT, markdown, "utf8");
  report.report_path = reportPath;
}

function printSummary(report) {
  console.log("\n=== Deterministic Engine Training Evaluation ===");
  console.log(`  Rules:              ${report.counts.rules}`);
  console.log(`  Positive cases:     ${report.stats.positive_passed}/${report.counts.positive} passed`);
  console.log(`  Negative cases:     ${report.stats.negative_passed}/${report.counts.negative} rejected`);
  console.log(`  Edge cases:         ${report.stats.edge_passed}/${report.counts.edge} detected`);
  console.log(`  Cross-measure:      ${report.stats.cross_measure_passed}/${report.counts.cross_measure} passed`);
  console.log(`  False positives:    ${report.stats.false_positives}`);
  console.log(`  Positive misses:    ${report.stats.positive_missed}`);
  console.log(`  Wrong top rules:    ${report.stats.positive_wrong_top_rule}`);
  console.log(`  CX false positives: ${report.stats.cross_measure_false_positives}`);
  console.log(`  Rule coverage:      ${report.accuracy.rule_positive_coverage_pct}%`);
  console.log(`  Quality gates:      ${report.gates.passed ? "PASS" : "FAIL"} (${report.gates.mode})`);
  console.log(`  Latest report:      ${LATEST_REPORT}`);
}

function evaluateQualityGates(report) {
  const config = fs.existsSync(QUALITY_GATES_PATH) ? readJson(QUALITY_GATES_PATH) : {};
  const strictMode = process.argv.includes("--strict") || config.mode === "strict";
  const mode = strictMode ? "strict" : "baseline";
  const failures = [];

  if (strictMode) {
    const strict = config.strict || {};
    checkMin(failures, "positive_detection_pct", report.accuracy.positive_detection_pct, strict.positive_detection_pct_min);
    checkMin(failures, "negative_rejection_pct", report.accuracy.negative_rejection_pct, strict.negative_rejection_pct_min);
    checkMin(failures, "edge_detection_pct", report.accuracy.edge_detection_pct, strict.edge_detection_pct_min);
    checkMin(failures, "rule_positive_coverage_pct", report.accuracy.rule_positive_coverage_pct, strict.rule_positive_coverage_pct_min);
    checkMin(failures, "cross_measure_detection_pct", report.accuracy.cross_measure_detection_pct, strict.cross_measure_detection_pct_min);
    checkMax(failures, "false_positives", report.stats.false_positives, strict.false_positives_max);
    checkMax(failures, "positive_misses", report.stats.positive_missed, strict.positive_misses_max);
    checkMax(failures, "cross_measure_false_positives", report.stats.cross_measure_false_positives, strict.cross_measure_false_positives_max);
  } else {
    const baseline = config.baseline || {};
    checkMin(failures, "positive_detection_pct", report.accuracy.positive_detection_pct, baseline.positive_detection_pct);
    checkMin(failures, "negative_rejection_pct", report.accuracy.negative_rejection_pct, baseline.negative_rejection_pct);
    checkMin(failures, "edge_detection_pct", report.accuracy.edge_detection_pct, baseline.edge_detection_pct);
    checkMin(failures, "rule_positive_coverage_pct", report.accuracy.rule_positive_coverage_pct, baseline.rule_positive_coverage_pct);
    checkMin(failures, "cross_measure_detection_pct", report.accuracy.cross_measure_detection_pct, baseline.cross_measure_detection_pct);
    checkMax(failures, "false_positives", report.stats.false_positives, baseline.false_positives_max);
    checkMax(failures, "cross_measure_false_positives", report.stats.cross_measure_false_positives, baseline.cross_measure_false_positives_max);
  }

  return {
    mode,
    passed: failures.length === 0,
    failures
  };
}

function checkMin(failures, metric, actual, expected) {
  if (typeof expected !== "number") return;
  if (actual < expected) failures.push({ metric, actual, expected, operator: ">=" });
}

function checkMax(failures, metric, actual, expected) {
  if (typeof expected !== "number") return;
  if (actual > expected) failures.push({ metric, actual, expected, operator: "<=" });
}

function renderMarkdownReport(report) {
  const topMisses = report.misses.slice(0, 25).map((miss) =>
    `| ${escapeMd(miss.name)} | ${escapeMd(miss.expected_rule_id || "n/a")} | \`${escapeMd(miss.input).slice(0, 120)}\` |`
  ).join("\n");
  const falsePositives = report.false_positives.slice(0, 25).map((failure) =>
    `| ${escapeMd(failure.name)} | ${escapeMd(failure.top?.rule_id || "n/a")} | ${failure.top?.confidence ?? "n/a"} |`
  ).join("\n");
  const gateRows = report.gates.failures.map((failure) =>
    `| ${failure.metric} | ${failure.actual} | ${failure.operator} ${failure.expected} |`
  ).join("\n");

  return `# Deterministic Training Report

Generated: ${report.generated_at}

## Summary

| Metric | Value |
| --- | ---: |
| Rules | ${report.counts.rules} |
| Positive cases | ${report.counts.positive} |
| Negative cases | ${report.counts.negative} |
| Edge cases | ${report.counts.edge} |
| Positive detection | ${report.accuracy.positive_detection_pct}% |
| Negative rejection | ${report.accuracy.negative_rejection_pct}% |
| Edge detection | ${report.accuracy.edge_detection_pct}% |
| Rule positive coverage | ${report.accuracy.rule_positive_coverage_pct}% |
| Quality gates | ${report.gates.passed ? "PASS" : "FAIL"} (${report.gates.mode}) |

## Gate Failures

${gateRows || "None."}

## Top Misses

| Case | Expected rule | Input |
| --- | --- | --- |
${topMisses || "| None | n/a | n/a |"}

## False Positives

| Case | Top rule | Confidence |
| --- | --- | ---: |
${falsePositives || "| None | n/a | n/a |"}
`;
}

function escapeMd(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

evaluate();
