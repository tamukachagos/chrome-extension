#!/usr/bin/env node
/**
 * buildRules.js — compile training/rules_advanced.json into extension rule files
 *
 * Writes:
 *   rules/processed/final_rules.json   — all rules merged, sorted by priority+confidence
 *   rules/performance_rules.json       — performance category only
 *   rules/correctness_rules.json       — correctness category only
 *   rules/modeling_rules.json          — modeling + pq + vis + sec categories
 *
 * Run after editing training/rules_advanced.json, then reload the extension.
 * Also add to package.json scripts: "build:rules": "node scripts/buildRules.js"
 */

const fs   = require("fs");
const path = require("path");

const ROOT     = path.join(__dirname, "..");
const SRC      = path.join(ROOT, "training", "rules_advanced.json");
const OUT_DIR  = path.join(ROOT, "rules");
const PROC_DIR = path.join(OUT_DIR, "processed");

// ── Load source rules ─────────────────────────────────────────────────────────
const raw   = JSON.parse(fs.readFileSync(SRC, "utf8"));
const rules = Array.isArray(raw) ? raw : (raw.rules || Object.values(raw));

// ── Priority mapping ──────────────────────────────────────────────────────────
function getPriority(category) {
  const map = { correctness: 1, performance: 2, modeling: 3, security: 3, "power_query": 4, visual: 4 };
  return map[category] || 5;
}

// ── Normalize & enrich ────────────────────────────────────────────────────────
const normalized = rules.map((r, i) => ({
  id:              r.id || `RULE_${String(i + 1).padStart(3, "0")}`,
  priority:        r.priority || getPriority(r.category),
  pattern:         r.pattern || "",
  bad_dax:         r.bad_dax || r.bad_example || "",
  detection_logic: r.detection_logic || { functions: [], conditions: [], context: "" },
  fixed_dax:       r.fixed_dax || r.fix_template || "",
  category:        r.category || "general",
  confidence:      typeof r.confidence === "number" ? r.confidence : 0.8,
  fix_type:        r.fix_type || "needs_review",
  requires_llm:    r.requires_llm || false,
}));

// ── Sort: priority asc, confidence desc, id asc ───────────────────────────────
const sorted = [...normalized].sort((a, b) => {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  return String(a.id).localeCompare(String(b.id));
});

// ── Category buckets ──────────────────────────────────────────────────────────
const byCategory = sorted.reduce((acc, r) => {
  const cat = r.category;
  const bucket =
    cat === "performance"  ? "performance" :
    cat === "correctness"  ? "correctness" :
    "modeling";  // modeling, security, power_query, visual, general all go here
  acc[bucket] = acc[bucket] || [];
  acc[bucket].push(r);
  return acc;
}, {});

// ── Write files ───────────────────────────────────────────────────────────────
fs.mkdirSync(PROC_DIR, { recursive: true });

function write(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  const rel = path.relative(ROOT, filePath);
  console.log(`  wrote  ${rel}  (${data.length} rules)`);
}

write(path.join(PROC_DIR, "final_rules.json"),       sorted);
write(path.join(OUT_DIR,  "performance_rules.json"),  byCategory.performance || []);
write(path.join(OUT_DIR,  "correctness_rules.json"),  byCategory.correctness || []);
write(path.join(OUT_DIR,  "modeling_rules.json"),     byCategory.modeling    || []);

// ── Also write a compiled_rules.json as fallback ─────────────────────────────
write(path.join(PROC_DIR, "compiled_rules.json"), sorted);

console.log(`\n  Total rules in extension: ${sorted.length}`);
console.log("  Reload the Chrome extension to pick up new rules.\n");
