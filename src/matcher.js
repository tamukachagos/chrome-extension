const { parseDAX } = require("./daxParser");

function scoreMatch(rule, dax, parsed = parseDAX(dax)) {
  const logic = rule.detection_logic || {};

  let score = 0;
  let total = 0;

  if (logic.primary_function) {
    total += 3;
    if (parsed.functions.includes(String(logic.primary_function).toUpperCase())) {
      score += 3;
    }
  }

  for (const fn of logic.secondary_functions || []) {
    total += 2;
    if (parsed.functions.includes(String(fn).toUpperCase())) {
      score += 2;
    }
  }

  for (const cond of logic.conditions || []) {
    total += 1;

    if (matchCondition(cond, parsed, dax)) {
      score += 1;
    }
  }

  return total === 0 ? 0 : score / total;
}

function matchCondition(cond, parsed, dax = "") {
  const key = String(cond || "").toLowerCase().replace(/\s+/g, "_");
  const source = String(dax || "");

  return (
    (cond === "row_context_required_false" && !parsed.hasIterator) ||
    (cond === "filter_iterates_fact_table" && parsed.hasFilter) ||
    (cond === "deep_nesting" && parsed.depth > 2) ||
    (key.includes("sumx_over_filtered_table") && /\bSUMX\s*\(\s*FILTER\s*\(/i.test(source)) ||
    (key.includes("sumx_expression_direct_column") && /\bSUMX\s*\(\s*FILTER\s*\([\s\S]+?\)\s*,\s*(?:'[^']+'|[\w ]+)\[[^\]]+\]\s*\)/i.test(source)) ||
    (key.includes("filter_simple_scalar_comparison") && /\bFILTER\s*\(\s*(?:'[^']+'|[\w ]+)\s*,[\s\S]*?(?:'[^']+'|[\w ]+)\[[^\]]+\]\s*(?:=|<>|<=|>=|<|>)\s*(?:[-\d.]+|"[^"]*"|'[^']*')/i.test(source))
  );
}

module.exports = {
  matchCondition,
  scoreMatch
};
