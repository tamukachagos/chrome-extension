const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = path.resolve(__dirname, "..");
const engineSource = fs.readFileSync(path.join(rootDir, "src", "daxEngine.js"), "utf8");
const rules = require("../rules/processed/final_rules.json");
const suite = require("../tests/fullSuite.json");

function normalize(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

const sandbox = {
  window: {},
  console
};

vm.createContext(sandbox);
vm.runInContext(engineSource, sandbox, { filename: "src/daxEngine.js" });

const engine = sandbox.window.PowerBIDaxEngine;
if (!engine) {
  throw new Error("PowerBIDaxEngine was not registered on window.");
}

engine.setRules(rules);

let failed = 0;
let passed = 0;

function fail(message) {
  failed += 1;
  console.error(`FAIL: ${message}`);
}

function pass() {
  passed += 1;
}

for (const test of suite.positive_cases) {
  const result = engine.analyzeDAX(test.input)[0];
  if (!result) {
    fail(`${test.name} was missed`);
    continue;
  }

  if (!normalize(result.issue).includes(normalize(test.expected_issue))) {
    fail(`${test.name} wrong issue: ${result.issue}`);
    continue;
  }

  if (normalize(result.fix) !== normalize(test.expected_fix)) {
    fail(`${test.name} wrong fix: ${result.fix}`);
    continue;
  }

  pass();
}

for (const test of suite.negative_cases) {
  const result = engine.analyzeDAX(test.input)[0];
  if (result && result.confidence > 0.6) {
    fail(`${test.name} false positive: ${result.issue}`);
    continue;
  }

  pass();
}

for (const test of suite.edge_cases) {
  const result = engine.analyzeDAX(test.input)[0];
  if (!result) {
    fail(`${test.name} edge miss`);
    continue;
  }

  if (normalize(result.fix) !== normalize(test.expected_fix)) {
    fail(`${test.name} edge wrong fix: ${result.fix}`);
    continue;
  }

  pass();
}

if (failed > 0) {
  process.exitCode = 1;
  console.error(`FAIL: ${failed} browser engine cases (${passed} passed)`);
} else {
  console.log(`PASS: ${passed} browser engine cases`);
}
