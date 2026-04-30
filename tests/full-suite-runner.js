const { analyzeDAX } = require("../analyze-dax");
const suite = require("../tests/fullSuite.json");

function normalize(str = "") {
  return String(str || "").replace(/\s+/g, "").toLowerCase();
}

let stats = {
  total: 0,
  correctDetection: 0,
  correctFix: 0,
  falsePositives: 0,
  missed: 0
};

const coverage = {};

function testPositive(test) {
  stats.total += 1;

  const results = analyzeDAX(test.input);
  if (!results.length) {
    console.log(`MISS: ${test.name}`);
    stats.missed += 1;
    return;
  }

  const top = results[0];
  coverage[top.issue] = (coverage[top.issue] || 0) + 1;

  if (normalize(top.issue).includes(normalize(test.expected_issue))) {
    stats.correctDetection += 1;

    if (normalize(top.fix) === normalize(test.expected_fix)) {
      stats.correctFix += 1;
      console.log(`PASS: ${test.name}`);
    } else {
      console.log(`FIX WRONG: ${test.name}`);
    }
  } else {
    console.log(`WRONG DETECTION: ${test.name}`);
  }
}

function testNegative(test) {
  stats.total += 1;

  const results = analyzeDAX(test.input);

  if (results.length && results[0].confidence > 0.6) {
    console.log(`FALSE POSITIVE: ${test.name}`);
    stats.falsePositives += 1;
  } else {
    console.log(`CORRECTLY IGNORED: ${test.name}`);
  }
}

function testEdge(test) {
  stats.total += 1;

  const results = analyzeDAX(test.input);

  if (!results.length) {
    console.log(`EDGE MISS: ${test.name}`);
    stats.missed += 1;
    return;
  }

  const top = results[0];
  coverage[top.issue] = (coverage[top.issue] || 0) + 1;

  if (test.expected_fix && normalize(top.fix) === normalize(test.expected_fix)) {
    console.log(`EDGE PASS: ${test.name}`);
    stats.correctFix += 1;
  } else {
    console.log(`EDGE IMPERFECT: ${test.name}`);
  }
}

function run() {
  console.log("=== RUNNING FULL TEST SUITE ===\n");

  suite.positive_cases.forEach(testPositive);
  suite.negative_cases.forEach(testNegative);
  suite.edge_cases.forEach(testEdge);

  console.log("\n=== SUMMARY ===");
  console.log(stats);

  console.log("\n=== RULE COVERAGE ===");
  console.log(coverage);

  if (stats.falsePositives > 0 || stats.missed > 0) {
    process.exitCode = 1;
  }
}

run();
