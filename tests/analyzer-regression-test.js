const { analyzeDAX, formatAnalysisResult } = require("../analyze-dax");
const rules = require("../rules/processed/final_rules.json");

function normalize(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function isEquivalentFix(expected, actual) {
  return normalize(expected) === normalize(actual);
}

const caseGroups = {
  positive_cases: [
    {
      name: "SUMX misuse",
      input: "SUMX(Sales, Sales[Amount])",
      expected_issue: "Using SUMX without row context need",
      expected_fix: "SUM(Sales[Amount])"
    }
  ],
  negative_cases: [
    {
      name: "Valid SUMX",
      input: "SUMX(Sales, Sales[Amount] * 0.9)"
    },
    {
      name: "Already optimal",
      input: "SUM(Sales[Amount])"
    }
  ],
  edge_cases: [
    {
      name: "Complex FILTER",
      input: "SUMX(FILTER(Sales, Sales[Amount] > 100 && Sales[Region] = \"US\"), Sales[Amount])",
      expected_fix: "CALCULATE(SUM(Sales[Amount]), Sales[Amount] > 100 && Sales[Region] = \"US\")"
    }
  ]
};

const testCases = [
  ...caseGroups.positive_cases,
  ...caseGroups.negative_cases.map((test) => ({
    ...test,
    expected_issue: null
  })),
  ...caseGroups.edge_cases
];

for (const rule of rules) {
  if (!rule.bad_dax || !rule.fixed_dax) continue;

  testCases.push({
    name: `Auto test: ${rule.pattern}`,
    input: rule.bad_dax,
    expected_issue: rule.pattern,
    expected_fix: rule.fixed_dax,
    auto: true
  });
}

let passed = 0;
let failed = 0;
const coverage = {};

for (const test of testCases) {
  const results = analyzeDAX(test.input).map(formatAnalysisResult);
  const result = results[0];
  if (result?.issue) {
    coverage[result.issue] = (coverage[result.issue] || 0) + 1;
  }

  if (test.expected_issue === null) {
    if (results.length === 0 || results[0].confidence < 0.6) {
      console.log(`PASS: ${test.name} (correctly ignored)`);
      passed += 1;
    } else {
      console.log(`FAIL: ${test.name} (false positive)`);
      console.log(`  issue: ${result.issue}`);
      console.log(`  fix: ${result.fix}`);
      console.log(`  confidence: ${result.confidence}`);
      failed += 1;
    }
    continue;
  }

  if (!result) {
    failed += 1;
    console.error(`FAIL: ${test.name}`);
    console.error("  no result");
    continue;
  }

  const actual_issue = result.issue;
  const actual_fix = result.fix;
  const issueMatches = typeof test.expected_issue === "undefined" || test.expected_issue === actual_issue;
  const fixMatches = typeof test.expected_fix === "undefined" || isEquivalentFix(test.expected_fix, actual_fix);

  if (!issueMatches || !fixMatches) {
    failed += 1;
    console.error(`FAIL: ${test.name}`);
    console.error(`  actual_issue: ${actual_issue}`);
    console.error(`  actual_fix: ${actual_fix}`);
    console.error(`  expected_issue: ${test.expected_issue}`);
    console.error(`  expected_fix: ${test.expected_fix}`);
    console.error(`  equivalent_fix: ${fixMatches}`);
    continue;
  }

  passed += 1;
}

if (failed > 0) {
  process.exitCode = 1;
  console.error(`FAIL: ${failed} analyzer regression cases (${passed} passed)`);
} else {
  console.log(`PASS: ${passed} analyzer regression cases`);
}

console.log("COVERAGE:");
console.log(JSON.stringify(coverage, null, 2));
