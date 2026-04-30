const daxInput = document.getElementById("daxInput");
const output = document.getElementById("output");
const analyzeBtn = document.getElementById("analyzeBtn");
const clearBtn = document.getElementById("clearBtn");

const MATCH_THRESHOLD = 0.75;
const LLM_THRESHOLD = 0.6;
let rules = [];

function extractFunctions(dax) {
  const regex = /\b[A-Z][A-Z0-9_]*\s*\(/gi;
  const matches = String(dax || "").match(regex) || [];
  return matches.map((match) => match.replace("(", "").trim().toUpperCase());
}

function extractColumns(dax) {
  const regex = /(?:'[^']+'|[A-Za-z0-9_]+)\[[^\]]+\]/g;
  return String(dax || "").match(regex) || [];
}

function extractTables(columns) {
  return [...new Set((columns || []).map((column) => column.split("[")[0].replace(/^'|'$/g, "")))];
}

function getNestingDepth(dax) {
  let max = 0;
  let current = 0;

  for (const char of String(dax || "")) {
    if (char === "(") current++;
    if (char === ")") current--;
    if (current > max) max = current;
  }

  return max;
}

function parseDAX(dax) {
  const functions = extractFunctions(dax);
  const columns = extractColumns(dax);
  const tables = extractTables(columns);

  return {
    source: String(dax || ""),
    functions,
    columns,
    tables,
    filterCondition: extractFilterConditions(dax),
    hasIterator: functions.some((fn) => fn.endsWith("X")),
    hasFilter: functions.includes("FILTER"),
    depth: getNestingDepth(dax)
  };
}

function getPriority(category) {
  if (category === "correctness") return 1;
  if (category === "performance") return 2;
  return 3;
}

function hasFunctionCall(dax, fn) {
  const parsed = typeof dax === "object" ? dax : parseDAX(dax);
  return parsed.functions.includes(String(fn || "").toUpperCase());
}

function normalizeRuleText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function getRuleFunctions(rule) {
  const logic = rule.detection_logic || {};
  const legacyFunctions = Array.isArray(logic.functions) ? logic.functions : [];
  const normalizedFunctions = [
    logic.primary_function,
    ...(Array.isArray(logic.secondary_functions) ? logic.secondary_functions : [])
  ];

  return [...normalizedFunctions, ...legacyFunctions].filter(Boolean);
}

function getFunctionVariants(rule) {
  const logic = rule.detection_logic || {};
  return Array.isArray(logic.function_variants) ? logic.function_variants : [];
}

function variantFunctions(variant) {
  return [
    variant.primary_function,
    ...(Array.isArray(variant.secondary_functions) ? variant.secondary_functions : [])
  ].filter(Boolean);
}

function matchesRuleFunctions(dax, rule) {
  const variants = getFunctionVariants(rule);
  if (variants.length > 0) {
    return variants.some((variant) => {
      const functions = variantFunctions(variant);
      return functions.length > 0 && functions.every((fn) => hasFunctionCall(dax, fn));
    });
  }

  const functions = getRuleFunctions(rule);
  return functions.length > 0 && functions.every((fn) => hasFunctionCall(dax, fn));
}

function matchesRule(dax, rule) {
  if (window.PowerBIDaxEngine?.matchesRule) {
    return window.PowerBIDaxEngine.matchesRule(dax, rule);
  }

  return scoreMatch(rule, dax) >= MATCH_THRESHOLD;
}

function formatResult(result) {
  if (!result.rule && result.issue) {
    return {
      issue: result.issue,
      fix: result.fix,
      fix_type: result.fix_type,
      category: result.category,
      explanation: result.explanation,
      match_score: Number((result.confidence || 0).toFixed(4)),
      final_score: Number((result.confidence || 0).toFixed(4)),
      requires_llm: (result.confidence || 0) < LLM_THRESHOLD
    };
  }

  const rule = result.rule || result;
  const matchScore = typeof result.matchScore === "number" ? result.matchScore : scoreMatch(rule, daxInput.value);
  const finalScore = typeof result.finalScore === "number" ? result.finalScore : matchScore * getRuleConfidence(rule);
  const fix = applyTemplate(rule, result.parsed);

  return {
    issue: rule.pattern,
    fix: fix.fix,
    fix_type: fix.fix_type,
    rule_fix: rule.fixed_dax,
    category: rule.category,
    explanation: explainRule(rule, result.parsed),
    parsed: result.parsed,
    match_score: Number(matchScore.toFixed(4)),
    final_score: Number(finalScore.toFixed(4)),
    requires_llm: typeof result.requiresLLM === "boolean" ? result.requiresLLM : finalScore < LLM_THRESHOLD
  };
}

function applyTemplate(rule, parsed) {
  if (window.PowerBIDaxEngine?.applyTemplate) {
    return window.PowerBIDaxEngine.applyTemplate(rule, parsed);
  }

  const source = parsed?.source || rule.bad_dax || "";
  const pattern = String(rule.pattern || "");
  const columns = parsed?.columns || [];
  const filterCondition = parsed?.filterCondition || extractFilterConditions(source);
  const sumxFilterTemplate = buildSumxFilterTemplate(source, filterCondition);

  if (isExactRuleExample(rule, source)) return fixResult(rule.fixed_dax, "safe");
  if (sumxFilterTemplate) return fixResult(sumxFilterTemplate, "safe");
  if (pattern.includes("SUMX") && filterCondition && columns.length) {
    return fixResult(`CALCULATE(SUM(${getSumxExpressionColumn(source) || columns[0]}), ${filterCondition})`, "needs_review");
  }
  if (pattern.includes("SUMX") && isSafeSumxToSum(parsed, source)) return fixResult(`SUM(${columns[0]})`, "safe");
  if (pattern.includes("Division")) {
    const divideTemplate = buildDivideTemplate(source);
    if (divideTemplate) return fixResult(divideTemplate, "safe");
    return fixResult(`DIVIDE(${columns[0] || "numerator"}, ${columns[1] || "denominator"})`, "needs_review");
  }
  if (pattern.includes("scalar expected") && columns.length) return fixResult(`SELECTEDVALUE(${columns[0]})`, "safe");

  const calculateFilterTemplate = buildCalculateFilterTemplate(source, filterCondition);
  if (pattern.includes("FILTER") && calculateFilterTemplate) return fixResult(calculateFilterTemplate, "safe");
  if (pattern.includes("FILTER") && columns.length) return fixResult(`CALCULATE(SUM(${columns[0]}))`, "needs_review");

  return fixResult(rule.fixed_dax, "needs_review");
}

function fixResult(fix, fixType = "needs_review") {
  return {
    fix,
    fix_type: fixType
  };
}

function isExactRuleExample(rule, source) {
  return Boolean(rule.bad_dax && normalizeRuleText(rule.bad_dax) === normalizeRuleText(source));
}

function buildSumxFilterTemplate(source, filterCondition = extractFilterConditions(source)) {
  const match = String(source || "").match(/\bSUMX\s*\(\s*FILTER\s*\(/i);
  if (!match) return null;
  const filterOpenParenIndex = match.index + match[0].lastIndexOf("(");
  const filterCloseParenIndex = findMatchingParen(source, filterOpenParenIndex);
  if (filterCloseParenIndex < 0) return null;
  const filterArgs = splitTopLevelArgs(source.slice(filterOpenParenIndex + 1, filterCloseParenIndex));
  if (filterArgs.length < 2) return null;
  if (!filterCondition) return null;
  const expressionMatch = source.slice(filterCloseParenIndex + 1).match(/^\s*,\s*((?:'[^']+'|[\w ]+)\[[^\]]+\])\s*\)/);
  if (!expressionMatch) return null;
  return `CALCULATE(SUM(${expressionMatch[1].trim()}), ${filterCondition})`;
}

function buildCalculateFilterTemplate(source, filterCondition = extractFilterConditions(source)) {
  const filterMatch = String(source || "").match(/\bFILTER\s*\(/i);
  if (!filterMatch) return null;
  const filterOpenParenIndex = filterMatch.index + filterMatch[0].lastIndexOf("(");
  const filterCloseParenIndex = findMatchingParen(source, filterOpenParenIndex);
  if (filterCloseParenIndex < 0) return null;
  const filterArgs = splitTopLevelArgs(source.slice(filterOpenParenIndex + 1, filterCloseParenIndex));
  if (filterArgs.length < 2) return null;
  if (!filterCondition) return null;
  const firstColumn = (String(source || "").match(/(?:'[^']+'|[\w ]+)\[[^\]]+\]/) || [])[0];
  if (!firstColumn) return null;
  return `CALCULATE(SUM(${firstColumn}), ${filterCondition})`;
}

function getSumxExpressionColumn(source) {
  const match = String(source || "").match(/\bSUMX\s*\(\s*FILTER\s*\(/i);
  if (!match) return null;
  const filterOpenParenIndex = match.index + match[0].lastIndexOf("(");
  const filterCloseParenIndex = findMatchingParen(source, filterOpenParenIndex);
  if (filterCloseParenIndex < 0) return null;
  const expressionMatch = source.slice(filterCloseParenIndex + 1).match(/^\s*,\s*((?:'[^']+'|[\w ]+)\[[^\]]+\])\s*\)/);
  return expressionMatch ? expressionMatch[1].trim() : null;
}

function buildDivideTemplate(source) {
  const measure = splitMeasureDefinition(source);
  const division = splitTopLevelDivision(measure.expression);
  if (!division) return null;
  const fixedExpression = `DIVIDE(${division.numerator}, ${division.denominator})`;
  return measure.name ? `${measure.name} = ${fixedExpression}` : fixedExpression;
}

function splitMeasureDefinition(source) {
  const text = String(source || "").trim();
  const equalsIndex = findTopLevelChar(text, "=");
  if (equalsIndex < 0) return { name: "", expression: text };
  return {
    name: text.slice(0, equalsIndex).trim(),
    expression: text.slice(equalsIndex + 1).trim()
  };
}

function splitTopLevelDivision(expression) {
  const slashIndex = findTopLevelChar(expression, "/");
  if (slashIndex < 0) return null;
  const numerator = expression.slice(0, slashIndex).trim();
  const denominator = expression.slice(slashIndex + 1).trim();
  if (!numerator || !denominator) return null;
  return { numerator, denominator };
}

function findTopLevelChar(text, target) {
  let depth = 0;
  let quote = "";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    if ((char === "\"" || char === "'") && previous !== "\\") {
      quote = quote === char ? "" : quote || char;
      continue;
    }
    if (quote) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === target && depth === 0) return index;
  }

  return -1;
}

function isSafeSumxToSum(parsed, source = parsed?.source || "") {
  return Boolean(parsed?.columns?.length === 1 && !String(source || "").includes("*"));
}

function extractFilterConditions(dax) {
  const source = String(dax || "");
  const filterMatch = source.match(/\bFILTER\s*\(/i);
  if (!filterMatch) return null;
  const filterOpenParenIndex = filterMatch.index + filterMatch[0].lastIndexOf("(");
  const filterCloseParenIndex = findMatchingParen(source, filterOpenParenIndex);
  if (filterCloseParenIndex < 0) return null;
  const filterArgs = splitTopLevelArgs(source.slice(filterOpenParenIndex + 1, filterCloseParenIndex));
  if (filterArgs.length < 2) return null;
  return filterArgs.slice(1).join(", ").trim();
}

function findMatchingParen(text, openIndex) {
  let depth = 0;
  let quote = "";

  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    if ((char === "\"" || char === "'") && previous !== "\\") {
      quote = quote === char ? "" : quote || char;
      continue;
    }
    if (quote) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}

function splitTopLevelArgs(text) {
  const args = [];
  let start = 0;
  let depth = 0;
  let quote = "";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];
    if ((char === "\"" || char === "'") && previous !== "\\") {
      quote = quote === char ? "" : quote || char;
      continue;
    }
    if (quote) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      args.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }

  args.push(text.slice(start).trim());
  return args.filter(Boolean);
}

function explainRule(rule, parsed) {
  if (window.PowerBIDaxEngine?.explainRule) {
    return window.PowerBIDaxEngine.explainRule(rule, parsed);
  }

  const logic = rule.detection_logic || {};
  const explanation = [];
  const conditionExplanations = {
    row_context_required_false: "Iterator is used where row context is not required.",
    filter_iterates_fact_table: "FILTER is iterating over a full fact table, which is inefficient.",
    division_operator_used: "Division is used without safe handling for divide-by-zero.",
    scalar_required: "A scalar value is expected, but a table expression is returned.",
    manual_time_filter: "Manual time filtering is used instead of built-in time intelligence.",
    sumx_over_filtered_table: "SUMX is iterating over a filtered table expression.",
    sumx_expression_direct_column: "The SUMX expression is a direct additive column.",
    filter_simple_scalar_comparison: "The FILTER predicate is a simple scalar comparison that can be pushed into CALCULATE."
  };

  if (logic.primary_function) {
    explanation.push(`Uses ${logic.primary_function}, which is involved in this pattern.`);
  }

  if (logic.secondary_functions?.length) {
    explanation.push(`Also involves: ${logic.secondary_functions.join(", ")}.`);
  }

  for (const cond of logic.conditions || []) {
    if (conditionExplanations[cond]) explanation.push(conditionExplanations[cond]);
  }

  if (parsed?.hasIterator && !explanation.some((text) => text.includes("Iterator"))) {
    explanation.push("Iterator function detected in the parsed DAX.");
  }

  return explanation.join(" ");
}

function scoreMatch(rule, dax) {
  if (window.PowerBIDaxEngine?.scoreMatch) {
    return window.PowerBIDaxEngine.scoreMatch(rule, dax);
  }

  const parsed = parseDAX(dax);
  return scoreMatchParsed(rule, dax, parsed);
}

function scoreMatchParsed(rule, dax, parsed) {
  const normalizedDax = normalizeRuleText(dax);
  const normalizedBadDax = normalizeRuleText(rule.bad_dax);

  if (normalizedBadDax && (normalizedDax === normalizedBadDax || normalizedDax.includes(normalizedBadDax))) {
    return 1;
  }

  const logic = rule.detection_logic || {};
  const functionScore = scoreFunctionMatch(logic, dax, parsed);
  let score = functionScore.score;
  let total = functionScore.total;

  for (const cond of logic.conditions || []) {
    total += 1;
    if (matchCondition(cond, dax, parsed)) score += 1;
  }

  return total === 0 ? 0 : score / total;
}

function scoreFunctionMatch(logic, dax, parsed = parseDAX(dax)) {
  const variants = Array.isArray(logic.function_variants) ? logic.function_variants : [];
  if (variants.length > 0) {
    return variants
      .map((variant) => scoreFunctionList(parsed, variant.primary_function, variant.secondary_functions || []))
      .sort((a, b) => (b.total === 0 ? 0 : b.score / b.total) - (a.total === 0 ? 0 : a.score / a.total))[0] || { score: 0, total: 0 };
  }

  return scoreFunctionList(parsed, logic.primary_function, logic.secondary_functions || []);
}

function scoreFunctionList(parsed, primaryFunction, secondaryFunctions = []) {
  let score = 0;
  let total = 0;

  if (primaryFunction) {
    total += 3;
    if (hasFunctionCall(parsed, primaryFunction)) score += 3;
  }

  for (const fn of secondaryFunctions || []) {
    total += 2;
    if (hasFunctionCall(parsed, fn)) score += 2;
  }

  return { score, total };
}

function matchCondition(cond, dax, parsed = parseDAX(dax)) {
  if (window.PowerBIDaxEngine?.matchCondition) {
    return window.PowerBIDaxEngine.matchCondition(cond, dax, parsed);
  }

  const key = normalizeRuleText(cond).replace(/\s+/g, "_");
  const source = String(dax || "");
  const upper = source.toUpperCase();

  if (key === "row_context_required_false") return !parsed.hasIterator;
  if (key === "filter_iterates_fact_table") return parsed.hasFilter;
  if (key === "deep_nesting") return parsed.depth > 2;
  if (key.includes("division")) return /(^|[^/])\/([^/]|$)/.test(source);
  if (key.includes("no_zero_handling")) return /(^|[^/])\/([^/]|$)/.test(source) && !hasFunctionCall(source, "DIVIDE");
  if (key.includes("blank")) return /BLANK\s*\(/i.test(source) || /=\s*BLANK\s*\(/i.test(source);
  if (key.includes("or_operator")) return /\|\|/.test(source);
  if (key.includes("same_column_multi_value") || key.includes("conflicting_values")) return /\bIN\s*\{/i.test(source) || hasRepeatedFilterColumn(source);
  if (key.includes("same_column_filtered_multiple_times")) return hasRepeatedFilterColumn(source);
  if (key.includes("filter_arguments_count_zero")) return /^.*=\s*CALCULATE\s*\(\s*[^,]+?\s*\)\s*$/i.test(source);
  if (key.includes("context_transition_required_false")) return hasFunctionCall(source, "CALCULATE") && !/,/.test(source.slice(source.toUpperCase().indexOf("CALCULATE")));
  if (key.includes("allselected")) return hasFunctionCall(source, "ALLSELECTED");
  if (key.includes("all_scope")) return hasFunctionCall(source, "ALL");
  if (key.includes("removefilters")) return hasFunctionCall(source, "REMOVEFILTERS");
  if (key.includes("manual_time") || key.includes("ytd")) return hasFunctionCall(source, "FILTER") && (hasFunctionCall(source, "ALL") || hasFunctionCall(source, "TODAY"));
  if (key.includes("sumx_over_filtered_table")) return /\bSUMX\s*\(\s*FILTER\s*\(/i.test(source);
  if (key.includes("sumx_expression_direct_column")) return /\bSUMX\s*\(\s*FILTER\s*\([\s\S]+?\)\s*,\s*(?:'[^']+'|[\w ]+)\[[^\]]+\]\s*\)/i.test(source);
  if (key.includes("filter_simple_scalar_comparison")) return /\bFILTER\s*\(\s*(?:'[^']+'|[\w ]+)\s*,[\s\S]*?(?:'[^']+'|[\w ]+)\[[^\]]+\]\s*(?:=|<>|<=|>=|<|>)\s*(?:[-\d.]+|"[^"]*"|'[^']*')/i.test(source);
  if (key.includes("simple_scalar_comparison") || key.includes("threshold")) return /[<>=]=?\s*[-\d"]/.test(source);
  if (key.includes("filter_iterates")) return hasFunctionCall(source, "FILTER");
  if (key.includes("direct_column") || key.includes("row_context_required_false")) return /SUMX\s*\(\s*'?[\w ]+'?\s*,\s*'?[\w ]+'?\[[^\]]+\]\s*\)/i.test(source);
  if (key.includes("raw_column_reference_returned") || key.includes("has_aggregation_false")) return /=\s*'?[\w ]+'?\[[^\]]+\]\s*$/i.test(source) && !/[A-Z][A-Z0-9]*\s*\(/i.test(source.split("=")[1] || "");
  if (key.includes("artifact_type_measure")) return /=/.test(source);
  if (key.includes("argument_type_table")) return /\bCOUNT\s*\(\s*'?[\w ]+'?\s*\)/i.test(source);
  if (key.includes("scalar_required")) return hasFunctionCall(source, "VALUES") || hasFunctionCall(source, "DISTINCT") || hasFunctionCall(source, "MAX");
  if (key.includes("table_function_returned") || key.includes("multi_value_table_function")) return hasFunctionCall(source, "VALUES") || hasFunctionCall(source, "DISTINCT");
  if (key.includes("single_selection_expected")) return hasFunctionCall(source, "MAX") || hasFunctionCall(source, "MIN");
  if (key.includes("column_name_matches_id_or_key")) return /\[(?:[^\]]*ID|[^\]]*Key)\]/i.test(source);
  if (key.includes("non_numeric") || key.includes("identifier")) return /\[(?:[^\]]*ID|[^\]]*Key)\]/i.test(source);
  if (key.includes("relationship") || key.includes("bridge") || key.includes("model")) return /relationship|bridge|many-to-many|model/i.test(source);
  if (key.includes("lookup")) return hasFunctionCall(source, "LOOKUPVALUE") || hasFunctionCall(source, "RELATED");

  return conditionKeywordMatch(cond, dax);
}

function conditionKeywordMatch(cond, dax) {
  const keyword = String(cond || "").split("_")[0].toLowerCase().trim();
  return Boolean(keyword && String(dax || "").toLowerCase().includes(keyword));
}

function hasRepeatedFilterColumn(dax) {
  const matches = String(dax || "").match(/'?[\w ]+'?\[[^\]]+\]\s*=/g) || [];
  const normalized = matches.map((match) => match.replace(/\s*=$/, "").toUpperCase());
  return new Set(normalized).size < normalized.length;
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
  }
  return response.json();
}

function analyzeDAX(dax) {
  if (window.PowerBIDaxEngine?.analyzeRuleMatches) {
    window.PowerBIDaxEngine.setRules(rules);
    return window.PowerBIDaxEngine.analyzeRuleMatches(dax);
  }

  const parsed = parseDAX(dax);
  const results = rules.map((rule) => {
    const matchScore = scoreMatchParsed(rule, dax, parsed);
    const finalScore = matchScore * getRuleConfidence(rule);

    return {
      rule,
      parsed,
      matchScore,
      finalScore,
      exactMatch: isExactRuleExample(rule, dax),
      requiresLLM: finalScore < LLM_THRESHOLD
    };
  });

  return results
    .filter((result) => result.finalScore > LLM_THRESHOLD)
    .sort((a, b) => {
      if (a.exactMatch !== b.exactMatch) return a.exactMatch ? -1 : 1;
      return b.finalScore - a.finalScore;
    });
}

function getRuleConfidence(rule) {
  return typeof rule.confidence === "number" ? rule.confidence : 0.8;
}

async function loadRules() {
  try {
    let processedRules = await fetchJson("rules/processed/final_rules.json");
    if (!Array.isArray(processedRules) || processedRules.length === 0) {
      processedRules = await fetchJson("rules/processed/compiled_rules.json");
    }
    if (Array.isArray(processedRules) && processedRules.length > 0) {
      rules = processedRules.map((rule, i) => ({
        id: rule.id || `RULE_${i + 1}`,
        priority: rule.priority || getPriority(rule.category),
        ...rule
      }));
      return;
    }
  } catch (_) {
    // Fall back to legacy rule packs while processed output is being generated.
  }

  const [performanceRules, correctnessRules] = await Promise.all([
    fetchJson("rules/performance_rules.json"),
    fetchJson("rules/correctness_rules.json")
  ]);

  rules = [...performanceRules, ...correctnessRules].map((rule, i) => ({
    id: rule.id || `RULE_${i + 1}`,
    priority: getPriority(rule.category),
    ...rule
  }));
}

analyzeBtn.onclick = () => {
  const results = analyzeDAX(daxInput.value).map(formatResult);
  output.innerText = JSON.stringify(results, null, 2);
};

clearBtn.onclick = () => {
  daxInput.value = "";
  output.innerText = "[]";
  daxInput.focus();
};

loadRules()
  .then(() => {
    output.innerText = JSON.stringify(analyzeDAX(daxInput.value).map(formatResult), null, 2);
  })
  .catch((error) => {
    output.innerText = JSON.stringify({ error: error.message }, null, 2);
  });
