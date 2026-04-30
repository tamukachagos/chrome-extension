const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const tests = [
  "tools/full-suite-runner.js",
  "tools/analyzer-regression-test.js",
  "tools/pattern-smoke-test.js",
  "tools/browser-engine-test.js"
];

let failures = 0;

for (const test of tests) {
  const testPath = path.join(rootDir, test);
  process.exitCode = 0;

  try {
    delete require.cache[require.resolve(testPath)];
    require(testPath);

    if (process.exitCode && process.exitCode !== 0) {
      failures += 1;
      process.stderr.write(`FAIL: ${test}\n`);
    }
  } catch (error) {
    failures += 1;
    process.stderr.write(`FAIL: ${test}\n`);
    process.stderr.write(`${error.stack || error.message}\n`);
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  process.stdout.write(`PASS: ${tests.length} test suites\n`);
}
