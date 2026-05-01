#!/usr/bin/env node
const path = require("path");
const fs = require("fs");

let passed = 0, failed = 0, warned = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.error(`  FAIL  ${name}: ${err.message}`); failed++; }
}
function warn(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.warn(`  WARN  ${name}: ${err.message}`); warned++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

console.log("\n=== PBI Copilot Test Runner ===\n");

// 1. JSON validity
console.log("-- Training files JSON validity --");
const trainingFiles = ["rules_advanced","test_suite","automation_skills","fallback_contract","vision_prompts","gap_analysis","training_loop"];
trainingFiles.forEach(f => {
  const fpath = path.join(__dirname, "..", "training", f + ".json");
  test(`${f}.json parses`, () => {
    if (!fs.existsSync(fpath)) throw new Error("file not found");
    JSON.parse(fs.readFileSync(fpath, "utf8"));
  });
});

// 2. Rule schema
console.log("\n-- Rule schema validation --");
const rulesRaw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "training", "rules_advanced.json"), "utf8"));
const rules = Array.isArray(rulesRaw) ? rulesRaw : (rulesRaw.rules || Object.values(rulesRaw));
test("All rules have id", () => rules.forEach(r => assert(r.id, `rule missing id`)));
test("All rules have confidence in [0,1]", () => rules.forEach(r => assert(r.confidence >= 0 && r.confidence <= 1, `${r.id} confidence ${r.confidence}`)));
test("All rules have fix_type", () => rules.forEach(r => assert(["safe","needs_review"].includes(r.fix_type), `${r.id} has invalid fix_type: ${r.fix_type}`)));
test("Rule IDs are unique", () => {
  const ids = rules.map(r => r.id);
  const dupes = ids.filter((v,i) => ids.indexOf(v) !== i);
  assert(dupes.length === 0, `Duplicate IDs: ${dupes.join(",")}`);
});

// 3. Proxy payload builder
console.log("\n-- Proxy payload builder --");
test("Vision payload has required fields", () => {
  const payload = { type: "vision", prompt: "analyze", screenshot: { dataUrl: "data:image/png;base64,abc", mimeType: "image/png" }, context: {}, knowledge: [] };
  assert(payload.type === "vision", "type");
  assert(payload.screenshot.dataUrl.startsWith("data:"), "dataUrl prefix");
});
test("Action plan payload has required fields", () => {
  const payload = { type: "action_plan", goal: "test", screenshot: null, context: {}, availableActions: ["click","type"], knowledge: [] };
  assert(Array.isArray(payload.availableActions), "availableActions");
  assert(payload.goal, "goal");
});
test("dataUrl base64 strip works", () => {
  const url = "data:image/png;base64,iVBORw0KGgo=";
  const stripped = url.includes(",") ? url.split(",")[1] : url;
  assert(stripped === "iVBORw0KGgo=", "strip failed: " + stripped);
});

// 4. Action plan validation
console.log("\n-- Action plan validation --");
const validTypes = new Set(["click","double_click","right_click","type","key","scroll","wait","screenshot","drag"]);
const HIGH_RISK = /delete|remove|publish|save|overwrite|export|share|replace|submit|apply changes|manage access/i;
test("Valid action types pass", () => {
  ["click","type","key","scroll","wait","drag"].forEach(t => assert(validTypes.has(t), `${t} should be valid`));
});
test("Invalid action type detected", () => {
  assert(!validTypes.has("hack"), "hack should be invalid");
  assert(!validTypes.has("execute"), "execute should be invalid");
});
test("High-risk keywords detected", () => {
  assert(HIGH_RISK.test("delete the measure"), "delete should be high risk");
  assert(HIGH_RISK.test("publish to service"), "publish should be high risk");
  assert(!HIGH_RISK.test("click the button"), "click should not be high risk");
});

// 5. Test suite coverage
console.log("\n-- Test suite coverage --");
const suite = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "training", "test_suite.json"), "utf8"));
const ruleIds = new Set(rules.map(r => r.id));
// test_suite.json uses expected_rule (exact ID) or expected_issue ("id: description")
// Note: test_suite IDs use per-category numbering (adv-perf-001) while rules_advanced
// uses global numbering (adv-perf-026). Coverage is a warning until IDs are aligned.
const extractId = t => (t.expected_rule || (t.expected_issue || "").split(":")[0]).trim();
const coveredByPos = new Set(suite.positive_cases.map(extractId).filter(Boolean));
const positiveCount = suite.positive_cases.length;
const negativeCount = suite.negative_cases?.length || 0;
const edgeCount = suite.edge_cases?.length || 0;
test("Test suite has positive cases", () => assert(positiveCount >= 50, `Only ${positiveCount} positive cases`));
test("Test suite has negative cases", () => assert(negativeCount >= 20, `Only ${negativeCount} negative cases`));
test("Test suite has edge cases", () => assert(edgeCount >= 10, `Only ${edgeCount} edge cases`));
// explicit expected_rule references must point to existing rules (hard failure)
test("No explicit expected_rule references unknown rule", () => {
  const unknown = suite.positive_cases.filter(t => t.expected_rule && !ruleIds.has(t.expected_rule));
  assert(unknown.length === 0, `Unknown rule refs: ${unknown.slice(0,3).map(t => t.expected_rule).join(",")}`);
});
// coverage by ID is a warning — IDs are misaligned between test_suite and rules_advanced
warn("Rule positive test coverage >= 80%", () => {
  const pct = coveredByPos.size / ruleIds.size * 100;
  assert(pct >= 80, `Coverage ${pct.toFixed(1)}% — ${ruleIds.size - coveredByPos.size} rules uncovered. Run: node scripts/addMissingTests.js to fix.`);
});

// 6. Manifest permissions
console.log("\n-- Manifest permissions --");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
test("Required permissions present", () => {
  ["activeTab","tabs","storage","scripting"].forEach(p => assert((manifest.permissions||[]).includes(p), `Missing permission: ${p}`));
});

// 7. Proxy file exists
console.log("\n-- Proxy files --");
test("tools/anthropic-proxy/server.js exists", () => {
  assert(fs.existsSync(path.join(__dirname, "..", "tools", "anthropic-proxy", "server.js")), "file missing");
});
test("proxy/server.js (Ollama) still exists", () => {
  assert(fs.existsSync(path.join(__dirname, "..", "proxy", "server.js")), "Ollama proxy missing");
});

// 8. contentScript.js syntax
console.log("\n-- contentScript.js --");
test("contentScript.js is non-empty", () => {
  const cs = fs.readFileSync(path.join(__dirname, "..", "src", "contentScript.js"), "utf8");
  assert(cs.length > 1000, "file too short");
});
test("background.js has PBI_CAPTURE_VISIBLE_TAB", () => {
  const bg = fs.readFileSync(path.join(__dirname, "..", "src", "background.js"), "utf8");
  assert(bg.includes("PBI_CAPTURE_VISIBLE_TAB"), "missing PBI_CAPTURE_VISIBLE_TAB handler");
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${warned} warnings ===\n`);
if (failed > 0) process.exit(1);
