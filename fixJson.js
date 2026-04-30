const fs = require("fs");
const path = require("path");

function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function stripCodeFence(text) {
  const trimmed = stripBom(text).trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractJsonCandidate(text) {
  const cleaned = stripCodeFence(text);

  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch (_) {
    const firstArray = cleaned.indexOf("[");
    const firstObject = cleaned.indexOf("{");
    const starts = [firstArray, firstObject].filter((index) => index >= 0);

    if (starts.length === 0) return cleaned;

    const start = Math.min(...starts);
    const endChar = cleaned[start] === "[" ? "]" : "}";
    const end = cleaned.lastIndexOf(endChar);

    if (end <= start) return cleaned;
    return cleaned.slice(start, end + 1);
  }
}

function fixJsonString(str) {
  return extractJsonCandidate(str)
    .replace(/=\s*"([^"]*)"/g, '= \\"$1\\"')
    .replace(/\n/g, "")
    .replace(/\r/g, "");
}

function parseJsonText(text, source = "input") {
  const candidate = extractJsonCandidate(text);

  try {
    return JSON.parse(candidate);
  } catch (error) {
    try {
      return JSON.parse(fixJsonString(candidate));
    } catch (_) {
      throw new Error(`Invalid JSON in ${source}: ${error.message}`);
    }
  }
}

function toRuleArray(value, source = "input") {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rules)) return value.rules;
  if (Array.isArray(value?.data)) return value.data;
  throw new Error(`Expected a JSON array of rules in ${source}`);
}

function readJsonArray(filePath) {
  return toRuleArray(loadAndFix(filePath), filePath);
}

function loadAndFix(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return parseJsonText(content, filePath);
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (require.main === module) {
  const [, , inputPath, outputPath] = process.argv;

  if (!inputPath) {
    console.error("Usage: node scripts/fixJson.js <input.json> [output.json]");
    process.exit(1);
  }

  const rules = readJsonArray(path.resolve(inputPath));

  if (outputPath) {
    writeJsonFile(path.resolve(outputPath), rules);
  } else {
    process.stdout.write(`${JSON.stringify(rules, null, 2)}\n`);
  }
}

module.exports = {
  fixJsonString,
  loadAndFix,
  parseJsonText,
  readJsonArray,
  toRuleArray,
  writeJsonFile
};
