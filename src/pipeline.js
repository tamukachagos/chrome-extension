const fs = require("fs");
const path = require("path");
const { readJsonArray, writeJsonFile } = require("./fixJson");
const { compileRuleSet } = require("./dedup");

const rootDir = path.resolve(__dirname, "..");
const rulesDir = path.join(rootDir, "rules");
const rawDir = path.join(rulesDir, "raw");
const processedDir = path.join(rulesDir, "processed");
const finalRulesFile = path.join(processedDir, "final_rules.json");
const compiledRulesFile = path.join(processedDir, "compiled_rules.json");

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => path.join(dir, name));
}

function getInputFiles() {
  const rawFiles = listJsonFiles(rawDir);
  if (rawFiles.length > 0) return rawFiles;

  return [
    path.join(rulesDir, "performance_rules.json"),
    path.join(rulesDir, "correctness_rules.json")
  ].filter((filePath) => fs.existsSync(filePath));
}

function loadRawRules(files) {
  return files.flatMap((filePath) => readJsonArray(filePath));
}

function writeOutputs(compiledRules) {
  writeJsonFile(finalRulesFile, compiledRules);
  writeJsonFile(compiledRulesFile, compiledRules);

  for (const category of ["correctness", "performance", "modeling"]) {
    const categoryRules = compiledRules.filter((rule) => rule.category === category);
    writeJsonFile(path.join(processedDir, `${category}_rules.json`), categoryRules);
  }
}

function runPipeline() {
  const inputFiles = getInputFiles();
  const rawRules = loadRawRules(inputFiles);
  const compiledRules = compileRuleSet(rawRules);
  writeOutputs(compiledRules);

  return {
    input_files: inputFiles.map((filePath) => path.relative(rootDir, filePath).replace(/\\/g, "/")),
    input_rules: rawRules.length,
    output_rules: compiledRules.length,
    output_file: "rules/processed/final_rules.json",
    compatibility_file: "rules/processed/compiled_rules.json"
  };
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(runPipeline(), null, 2)}\n`);
}

module.exports = {
  runPipeline
};
