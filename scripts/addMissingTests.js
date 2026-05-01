#!/usr/bin/env node
/**
 * addMissingTests.js — generate positive test cases for rules with no coverage
 *
 * Finds rule IDs in rules_advanced.json that have no matching positive test case
 * in test_suite.json, then generates a skeleton test case for each.
 * Appends to test_suite.json without duplicating.
 */

const fs   = require("fs");
const path = require("path");

const ROOT  = path.join(__dirname, "..");
const RULES = path.join(ROOT, "training", "rules_advanced.json");
const SUITE = path.join(ROOT, "training", "test_suite.json");

const rulesRaw = JSON.parse(fs.readFileSync(RULES, "utf8"));
const rules    = Array.isArray(rulesRaw) ? rulesRaw : (rulesRaw.rules || Object.values(rulesRaw));
const suite    = JSON.parse(fs.readFileSync(SUITE, "utf8"));

// Build set of rule IDs that already have explicit coverage
const extractId = t => (t.expected_rule || (t.expected_issue || "").split(":")[0]).trim();
const coveredIds = new Set([
  ...suite.positive_cases.map(extractId),
  ...(suite.edge_cases || []).map(extractId),
].filter(Boolean));

const uncovered = rules.filter(r => !coveredIds.has(r.id));

if (uncovered.length === 0) {
  console.log("\nAll rules have test coverage. Nothing to add.\n");
  process.exit(0);
}

const existingNames = new Set(suite.positive_cases.map(t => t.name));
let added = 0;

uncovered.forEach(rule => {
  const name = `[auto] ${rule.id}: ${rule.pattern.slice(0, 60)}`;
  if (existingNames.has(name)) return;

  suite.positive_cases.push({
    name,
    input: rule.bad_dax || `// Pattern: ${rule.pattern}`,
    expected_rule: rule.id,
    expected_issue: `${rule.id}: ${rule.pattern}`,
    expected_fix: rule.fixed_dax || "See rule fix_template",
    auto_generated: true,
  });

  existingNames.add(name);
  added++;
});

fs.writeFileSync(SUITE, JSON.stringify(suite, null, 2), "utf8");

console.log(`\n=== addMissingTests ===`);
console.log(`  Rules without coverage: ${uncovered.length}`);
console.log(`  New skeleton tests added: ${added}`);
console.log(`  Total positive cases: ${suite.positive_cases.length}`);
console.log(`\nReview auto-generated cases and add real input examples.\n`);
