const readline = require("readline");
const { parseDAX } = require("./scripts/daxParser");
const { explainRule } = require("./scripts/explanationEngine");
const { applyTemplate } = require("./scripts/fixEngine");

const MATCH_THRESHOLD = 0.75;
const LLM_THRESHOLD = 0.6;
const rules = loadRules();

function matchesRule(dax, rule) {
  return scoreMatch(rule, dax) >= MATCH_THRESHOLD;
}

function loadRules() {
  try {
    return require("./rules/processed/final_rules.json");
  } catch (_) {
    try {
      return require("./rules/processed/compiled_rules.json");
    } catch (__) {
      const performanceRules = require("./rules/performance_rules.json");
      const correctnessRules = require("./rules/correctness_rules.json");
      return [...performanceRules, ...correctnessRules];
    }
  }
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

function scoreMatch(rule, dax) {
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
  let conditionScore = 0;
  let conditionTotal = 0;

  for (const cond of logic.conditions || []) {
    total += 1;
    if (matchCondition(cond, dax, parsed)) {
      score += 1;
      conditionScore += 1;
    }
    conditionTotal += 1;
  }

  if (conditionTotal > 0 && conditionScore === 0) {
    return 0;
  }
  if (conditionTotal > 1 && conditionScore / conditionTotal < 0.5) {
    return 0;
  }
  if (
    logic.primary_function === "SUM" &&
    (logic.conditions || []).some((condition) => normalizeRuleText(condition).includes("division")) &&
    conditionScore === conditionTotal
  ) {
    return 1;
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
  const key = normalizeRuleText(cond).replace(/\s+/g, "_");
  const source = String(dax || "");

  if (key === "row_context_required_false") return isDirectColumnSumx(source);
  if (key === "filter_iterates_fact_table") return filterIteratesFactTable(source);
  if (key === "deep_nesting") return parsed.depth > 2;
  if (key.includes("division")) return /(^|[^/])\/([^/]|$)/.test(source);
  if (key.includes("no_zero_handling")) return /(^|[^/])\/([^/]|$)/.test(source) && !hasFunctionCall(source, "DIVIDE");
  if (key.includes("denominator_is_expression")) return hasTopLevelDivision(source);
  if (key.includes("blank")) return /=\s*BLANK\s*\(/i.test(source);
  if (key.includes("or_operator")) return hasSameColumnOrFilter(source);
  if (key.includes("same_column_multi_value")) return hasSameColumnOrFilter(source) || hasConflictingFilterColumn(source);
  if (key.includes("conflicting_values")) return hasConflictingFilterColumn(source);
  if (key.includes("same_column_filtered_multiple_times")) return hasRepeatedFilterColumn(source);
  if (key.includes("duplicate_same_column_same_value")) return hasDuplicateFilterColumn(source);
  if (key.includes("filter_arguments_count_zero")) return calculateArgCount(source) === 1 && !/\bCALCULATE\s*\(\s*CALCULATE\s*\(/i.test(source);
  if (key.includes("context_transition_required_false")) return calculateArgCount(source) === 1 && !/\bCALCULATE\s*\(\s*CALCULATE\s*\(/i.test(source) && !/^\s*VAR\b/i.test(getExpression(source));
  if (key.includes("allselected_scope_fact_table")) return hasTableScopedFunctionCall(source, "ALLSELECTED", isLikelyFactTable);
  if (key.includes("grand_total_intended")) return hasTableScopedFunctionCall(source, "ALLSELECTED", isLikelyFactTable) && /\b(grand|total)\b/i.test(getMeasureName(source));
  if (key.includes("all_scope_fact_table")) return hasTableScopedFunctionCall(source, "ALL", isLikelyFactTable);
  if (key.includes("all_scope_dimension_table")) return hasTableScopedFunctionCall(source, "ALL", isLikelyDimensionTable);
  if (key.includes("measure_context_unexpected_total")) return hasTableScopedFunctionCall(source, "ALL", isLikelyFactTable);
  if (key.includes("dimension_affects_measure")) return hasTableScopedFunctionCall(source, "ALL", isLikelyDimensionTable);
  if (key.includes("all_called_on_entire_dimension_table")) return hasTableScopedFunctionCall(source, "ALL", isLikelyDimensionTable);
  if (key.includes("rank_display_uses_single_column")) return /\bRANKX\s*\(\s*ALL\s*\(\s*(?:Customer|Product|Date|Region|Category|Segment)\s*\)/i.test(source);
  if (key.includes("removefilters_scope_entire_dimension_table")) return hasTableScopedFunctionCall(source, "REMOVEFILTERS", isLikelyDimensionTable);
  if (key.includes("only_one_column_needs_clearance")) return hasTableScopedFunctionCall(source, "REMOVEFILTERS", isLikelyDimensionTable) && !/\bREMOVEFILTERS\s*\(\s*(?:'[^']+'|[\w ]+)\[[^\]]+\]\s*\)/i.test(source);
  if (key.includes("manual_time") || key.includes("ytd")) return hasManualTimeFilter(source);
  if (key === "date_table_available") return /(?:'Date'|Date)\[/i.test(source);
  if (key.includes("marked_date_table_available")) return /\b(?:Sales|Fact|Orders?)\[[^\]]*Date[^\]]*\]/i.test(source);
  if (key.includes("nested_function") || key.includes("nested_calculate")) return /\bCALCULATE\s*\(\s*CALCULATE\s*\(/i.test(source);
  if (key.includes("filter_condition_true") || key.includes("condition_true")) return /\bFILTER\s*\(\s*(?:'[^']+'|[\w ]+)\s*,\s*TRUE\s*\(\s*\)\s*\)/i.test(source);
  if (key.includes("sumx_over_filtered_table")) return /\bSUMX\s*\(\s*FILTER\s*\(/i.test(source);
  if (key.includes("sumx_expression_direct_column")) return hasSumxFilterDirectColumn(source);
  if (key.includes("filter_simple_scalar_comparison")) return filterHasSimpleColumnPredicate(source);
  if (key.includes("filter_simple_equality")) return filterHasSimpleColumnEquality(source);
  if (key.includes("simple_scalar_comparison") || key.includes("threshold")) return filterHasInequalityColumnPredicate(source);
  if (key.includes("filter_iterates")) return filterIteratesFactTable(source);
  if (key.includes("direct_column") || key.includes("expression_type_direct_column")) return isDirectColumnSumx(source);
  if (key.includes("raw_column_reference_returned") || key.includes("has_aggregation_false")) return /=\s*'?[\w ]+'?\[[^\]]+\]\s*$/i.test(source) && !/[A-Z][A-Z0-9]*\s*\(/i.test(source.split("=")[1] || "");
  if (key.includes("artifact_type_measure")) return /=/.test(source);
  if (key.includes("argument_type_table")) return /\bCOUNT\s*\(\s*'?[\w ]+'?\s*\)/i.test(source);
  if (key.includes("countrows_values_pattern")) return /\bCOUNTROWS\s*\(\s*VALUES\s*\(\s*(?:'[^']+'|[\w ]+)\[[^\]]+\]\s*\)\s*\)/i.test(source);
  if (key.includes("manual_division_with_zero_check")) return /\bIF\s*\([\s\S]*=\s*0\s*,\s*0\s*,[\s\S]*\/[\s\S]*\)/i.test(source) && !hasFunctionCall(source, "DIVIDE");
  if (key.includes("scalar_required")) return hasScalarTableFunctionMisuse(source) || hasSelectedValueCandidate(source);
  if (key.includes("table_function_returned") || key.includes("multi_value_table_function")) return hasScalarTableFunctionMisuse(source);
  if (key.includes("single_selection_expected")) return hasExactScalarAggregateReturn(source, ["MAX", "MIN"]);
  if (key.includes("column_used_as_label_or_parameter")) return hasExactScalarAggregateReturn(source, ["MAX", "MIN"]) && /\b(selected|current|label|year|month|name|parameter)\b/i.test(getMeasureName(source));
  if (key.includes("column_name_matches_id_or_key")) return /\[(?:[^\]]*ID|[^\]]*Key)\]/i.test(source);
  if (key.includes("non_numeric") || key.includes("identifier")) return /\[(?:[^\]]*ID|[^\]]*Key)\]/i.test(source);
  if (key.includes("earlier_used")) return hasFunctionCall(source, "EARLIER");
  if (key.includes("rank_pattern")) return hasFunctionCall(source, "EARLIER") && /\bCOUNTROWS\s*\(/i.test(source) && /\s>\s*EARLIER\s*\(/i.test(source);
  if (key.includes("result_used_as_scalar")) return hasExactFunctionReturn(source, "LASTDATE");
  if (key.includes("argument_is_fact_date_column")) return hasExactFunctionReturn(source, "LASTDATE") && /\b(?:Sales|Fact|Orders?)\[[^\]]*Date[^\]]*\]/i.test(source);
  if (key.includes("same_measure_reference_repeated")) return hasRepeatedMeasureReference(source);
  if (key.includes("no_var_cache")) return hasRepeatedMeasureReference(source) && !/\bVAR\b/i.test(source);
  if (key.includes("relationship_activation_inside_row_iterator")) return /\bSUMX\s*\([\s\S]*\bUSERELATIONSHIP\s*\(/i.test(source);
  if (key.includes("expression_is_additive") || key.includes("scalar_additive_result")) return /(?:SUMX\s*\(|SUM\s*\()/i.test(source) && /\[[^\]]*(Amount|Sales|Revenue|Cost|Profit|Qty|Quantity)[^\]]*\]/i.test(source);
  if (key.includes("table_materialization_unnecessary")) return /\bSUMX\s*\(\s*CALCULATETABLE\s*\(/i.test(source);
  if (key.includes("crossfilter_direction_is_both")) return /\bCROSSFILTER\s*\([^)]*,\s*BOTH\s*\)/i.test(source);
  if (key.includes("relationship_override_inside_measure")) return /\bCROSSFILTER\s*\([^)]*,\s*BOTH\s*\)/i.test(source);
  if (key.includes("relationship_type_many_to_many")) return /\bmany[-\s]?to[-\s]?many\b|\bm:m\b/i.test(source);
  if (key.includes("no_bridge_table")) return /\bmany[-\s]?to[-\s]?many\b|\bm:m\b/i.test(source) && !/\bbridge\b/i.test(source);
  if (key.includes("relationship_exists_false")) return /\b(no|missing|without)\s+(active\s+)?relationship\b/i.test(source);
  if (key.includes("lookup_column_from_related_table")) return hasFunctionCall(source, "RELATED") && /\b(no|missing|without)\s+(active\s+)?relationship\b/i.test(source);
  if (key.includes("lookup_key_not_unique") || key.includes("multiple_matches_possible")) return hasFunctionCall(source, "LOOKUPVALUE") && lookupValueArgCount(source) <= 3;
  if (key.includes("row_by_row_membership_test")) return hasFunctionCall(source, "CONTAINS") && hasFunctionCall(source, "FILTER");
  if (key.includes("relationship_key_columns_detected")) return hasFunctionCall(source, "CONTAINS") && /\[[^\]]*(ID|Key)[^\]]*\]/i.test(source);
  if (key.includes("virtual_relationship_between_dimension_and_fact")) return hasFunctionCall(source, "INTERSECT") && hasFunctionCall(source, "VALUES") && referencesLikelyFactAndDimension(source);
  if (key.includes("physical_relationship_possible")) return hasFunctionCall(source, "INTERSECT") && /\[[^\]]*(ID|Key)[^\]]*\]/i.test(source);
  if (key.includes("set_operation_between_fact_tables")) return hasFunctionCall(source, "INTERSECT") && hasFunctionCall(source, "VALUES") && (source.match(/\b(?:Sales|Returns|Fact|Orders?)\[/gi) || []).length >= 2;
  if (key.includes("bridge_or_dimension_available")) return hasFunctionCall(source, "INTERSECT");
  if (key.includes("same_fact_table_filtered_multiple_times")) return hasFunctionCall(source, "UNION") && repeatedFilterTable(source);
  if (key.includes("filters_can_be_combined")) return hasFunctionCall(source, "UNION") && repeatedFilterTable(source);

  return false;
}

function hasRepeatedFilterColumn(dax) {
  if (hasFunctionCall(dax, "FILTER")) return false;
  const matches = String(dax || "").match(/'?[\w ]+'?\[[^\]]+\]\s*=/g) || [];
  const normalized = matches.map((match) => match.replace(/\s*=$/, "").toUpperCase());
  return new Set(normalized).size < normalized.length;
}

function hasDuplicateFilterColumn(dax) {
  if (hasFunctionCall(dax, "FILTER")) return false;
  const comparisons = extractDirectColumnComparisons(dax);
  const seen = new Set();

  for (const comparison of comparisons) {
    const key = `${comparison.column}=${comparison.value}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }

  return false;
}

function hasConflictingFilterColumn(dax) {
  if (hasFunctionCall(dax, "FILTER")) return false;
  const comparisons = extractDirectColumnComparisons(dax);
  const valuesByColumn = new Map();

  for (const comparison of comparisons) {
    if (!valuesByColumn.has(comparison.column)) valuesByColumn.set(comparison.column, new Set());
    valuesByColumn.get(comparison.column).add(comparison.value);
  }

  return [...valuesByColumn.values()].some((values) => values.size > 1);
}

function hasSameColumnOrFilter(dax) {
  const source = String(dax || "");
  if (!/\|\|/.test(source)) return false;
  if (hasFunctionCall(source, "FILTER")) return false;

  const comparisons = extractDirectColumnComparisons(source);
  if (comparisons.length < 2) return false;

  return comparisons.some((comparison, index) =>
    comparisons.findIndex((candidate) => candidate.column === comparison.column) !== index
  );
}

function extractDirectColumnComparisons(dax) {
  return [...String(dax || "").matchAll(/((?:'[^']+'|[\w ]+)\[[^\]]+\])\s*=\s*("[^"]*"|'[^']*'|[A-Za-z0-9_.-]+)/gi)]
    .map((match) => ({
      column: normalizeIdentifier(match[1]),
      value: match[2].trim()
    }));
}

function calculateArgCount(dax) {
  const args = getFirstFunctionArgs(dax, "CALCULATE");
  return args ? args.length : 0;
}

function hasManualTimeFilter(dax) {
  const source = String(dax || "");
  if (!hasFunctionCall(source, "FILTER") || !hasFunctionCall(source, "ALL")) return false;
  return /(?:'Date'|Date)\[[^\]]*Date[^\]]*\]\s*<=\s*(?:MAX\s*\(|TODAY\s*\()/i.test(source);
}

function filterIteratesFactTable(dax) {
  const filterArgs = getFirstFunctionArgs(dax, "FILTER");
  if (!filterArgs || filterArgs.length < 2) return false;
  return isLikelyFactTable(cleanTableName(filterArgs[0]));
}

function filterHasSimpleColumnPredicate(dax) {
  const filterArgs = getFirstFunctionArgs(dax, "FILTER");
  if (!filterArgs || filterArgs.length < 2) return false;

  const table = cleanTableName(filterArgs[0]);
  const predicate = filterArgs.slice(1).join(", ");
  if (!isLikelyFactTable(table)) return false;
  if (/\[[^\]]+\]\s*(?:=|<>|<=|>=|<|>)\s*[-\d.]+/i.test(predicate)) return true;
  if (/\[[^\]]+\]\s*(?:=|<>|<=|>=|<|>)\s*"[^"]*"/i.test(predicate)) return true;
  if (/\[[^\]]+\]\s*(?:=|<>|<=|>=|<|>)\s*'[^']*'/i.test(predicate)) return true;
  return false;
}

function filterHasInequalityColumnPredicate(dax) {
  const filterArgs = getFirstFunctionArgs(dax, "FILTER");
  if (!filterArgs || filterArgs.length < 2) return false;

  const table = cleanTableName(filterArgs[0]);
  const predicate = filterArgs.slice(1).join(", ");
  if (!isLikelyFactTable(table)) return false;
  return /\[[^\]]+\]\s*(?:<>|<=|>=|<|>)\s*(?:[-\d.]+|"[^"]*"|'[^']*')/i.test(predicate);
}

function filterHasSimpleColumnEquality(dax) {
  const filterArgs = getFirstFunctionArgs(dax, "FILTER");
  if (!filterArgs || filterArgs.length < 2) return false;

  const table = cleanTableName(filterArgs[0]);
  const predicate = filterArgs.slice(1).join(", ");
  if (!isLikelyFactTable(table)) return false;
  return /\[[^\]]+\]\s*=\s*(?:"[^"]*"|'[^']*'|[A-Za-z0-9_.-]+)/i.test(predicate) && !/[<>]|\|\||&&/.test(predicate);
}

function hasSumxFilterDirectColumn(dax) {
  return Boolean(getSumxFilterExpressionColumn(dax));
}

function getSumxFilterExpressionColumn(dax) {
  const source = String(dax || "");
  const match = source.match(/\bSUMX\s*\(\s*FILTER\s*\(/i);
  if (!match) return null;

  const filterOpenParenIndex = match.index + match[0].lastIndexOf("(");
  const filterCloseParenIndex = findMatchingParen(source, filterOpenParenIndex);
  if (filterCloseParenIndex < 0) return null;

  const afterFilter = source.slice(filterCloseParenIndex + 1);
  const expressionMatch = afterFilter.match(/^\s*,\s*((?:'[^']+'|[\w ]+)\[[^\]]+\])\s*\)/);
  return expressionMatch ? expressionMatch[1].trim() : null;
}

function isDirectColumnSumx(dax) {
  const args = getFirstFunctionArgs(dax, "SUMX");
  if (!args || args.length !== 2) return false;
  return isBareTable(args[0]) && isBareColumn(args[1]) && !/[+\-*/]/.test(args[1]);
}

function hasScalarTableFunctionMisuse(dax) {
  return hasExactFunctionReturn(dax, "VALUES") ||
    hasExactFunctionReturn(dax, "DISTINCT") ||
    hasIfHasOneValueValuesPattern(dax);
}

function hasSelectedValueCandidate(dax) {
  return hasExactScalarAggregateReturn(dax, ["MAX", "MIN"]);
}

function hasExactScalarAggregateReturn(dax, functions) {
  return functions.some((fn) => hasExactFunctionReturn(dax, fn));
}

function hasExactFunctionReturn(dax, fn) {
  const expression = getExpression(dax);
  const args = getExactFunctionArgs(expression, fn);
  return Boolean(args && args.length === 1 && isBareColumn(args[0]));
}

function hasIfHasOneValueValuesPattern(dax) {
  const expression = getExpression(dax);
  const args = getExactFunctionArgs(expression, "IF");
  if (!args || args.length < 2) return false;
  return hasFunctionCall(args[0], "HASONEVALUE") && hasExactFunctionReturn(args[1], "VALUES");
}

function hasRepeatedMeasureReference(dax) {
  const matches = String(dax || "").match(/\[[^\]]+\]/g) || [];
  const normalized = matches
    .filter((match) => !/^\[[^\]]*(ID|Key|Amount|Revenue|Cost|Date|Status|Region|Quantity|Price)[^\]]*\]$/i.test(match))
    .map((match) => match.toUpperCase());
  return normalized.some((match, index) => normalized.indexOf(match) !== index);
}

function lookupValueArgCount(dax) {
  const args = getFirstFunctionArgs(dax, "LOOKUPVALUE");
  return args ? args.length : 0;
}

function hasTableScopedFunctionCall(dax, fn, tablePredicate) {
  if (String(fn || "").toUpperCase() === "ALL" && hasManualTimeFilter(dax)) return false;

  return getFunctionArgSets(dax, fn).some((args) => {
    if (args.length !== 1) return false;
    if (/\[[^\]]+\]/.test(args[0])) return false;
    return tablePredicate(cleanTableName(args[0]));
  });
}

function isLikelyFactTable(table) {
  return /\b(fact|sales|sale|orders?|transactions?|web|returns?)\b/i.test(cleanTableName(table));
}

function isLikelyDimensionTable(table) {
  const clean = cleanTableName(table);
  return Boolean(clean) && !isLikelyFactTable(clean);
}

function cleanTableName(value) {
  return String(value || "").trim().replace(/^'|'$/g, "");
}

function isBareColumn(value) {
  return /^(?:'[^']+'|[\w ]+)\[[^\]]+\]$/.test(String(value || "").trim());
}

function isBareTable(value) {
  return /^(?:'[^']+'|[\w ]+)$/.test(String(value || "").trim());
}

function referencesLikelyFactAndDimension(dax) {
  const columns = String(dax || "").match(/(?:'[^']+'|[\w ]+)\[[^\]]+\]/g) || [];
  const tables = columns.map((column) => cleanTableName(column.split("[")[0]));
  return tables.some(isLikelyFactTable) && tables.some(isLikelyDimensionTable);
}

function repeatedFilterTable(dax) {
  const tables = getFunctionArgSets(dax, "FILTER")
    .map((args) => cleanTableName(args[0]))
    .filter(Boolean);
  return tables.some((table, index) => tables.indexOf(table) !== index);
}

function normalizeIdentifier(value) {
  return String(value || "").replace(/\s+/g, "").replace(/^'|'(?=\[)/g, "").toUpperCase();
}

function getMeasureName(dax) {
  const text = String(dax || "").trim();
  const equalsIndex = findTopLevelChar(text, "=");
  return equalsIndex >= 0 ? text.slice(0, equalsIndex).trim() : "";
}

function getExpression(dax) {
  const text = String(dax || "").trim();
  const equalsIndex = findTopLevelChar(text, "=");
  return equalsIndex >= 0 ? text.slice(equalsIndex + 1).trim() : text;
}

function hasTopLevelDivision(dax) {
  return findTopLevelChar(getExpression(dax), "/") >= 0;
}

function getExactFunctionArgs(expression, fn) {
  const text = String(expression || "").trim();
  const match = text.match(new RegExp(`^${escapeRegExp(fn)}\\s*\\(`, "i"));
  if (!match) return null;

  const openIndex = match[0].lastIndexOf("(");
  const closeIndex = findMatchingParen(text, openIndex);
  if (closeIndex !== text.length - 1) return null;
  return splitTopLevelArgs(text.slice(openIndex + 1, closeIndex));
}

function getFirstFunctionArgs(dax, fn) {
  const sets = getFunctionArgSets(dax, fn);
  return sets[0] || null;
}

function getFunctionArgSets(dax, fn) {
  const source = String(dax || "");
  const regex = new RegExp(`\\b${escapeRegExp(fn)}\\s*\\(`, "ig");
  const results = [];
  let match;

  while ((match = regex.exec(source))) {
    const openIndex = match.index + match[0].lastIndexOf("(");
    const closeIndex = findMatchingParen(source, openIndex);
    if (closeIndex < 0) continue;
    results.push(splitTopLevelArgs(source.slice(openIndex + 1, closeIndex)));
    regex.lastIndex = closeIndex + 1;
  }

  return results;
}

function findTopLevelChar(text, target) {
  let depth = 0;
  let quote = "";

  for (let index = 0; index < String(text || "").length; index += 1) {
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

function findMatchingParen(text, openIndex) {
  let depth = 0;
  let quote = "";

  for (let index = openIndex; index < String(text || "").length; index += 1) {
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

  for (let index = 0; index < String(text || "").length; index += 1) {
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

  args.push(String(text || "").slice(start).trim());
  return args.filter(Boolean);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasFunctionCall(dax, fn) {
  const parsed = typeof dax === "object" ? dax : parseDAX(dax);
  return parsed.functions.includes(String(fn || "").toUpperCase());
}

function analyzeDAX(dax) {
  const parsed = parseDAX(dax);
  const results = rules.map((rule) => {
    const matchScore = scoreMatchParsed(rule, dax, parsed);
    const confidence = matchScore * getRuleConfidence(rule);
    const fix = applyTemplate(rule, parsed);

    return {
      issue: rule.pattern,
      explanation: explainRule(rule, parsed),
      fix: fix.fix,
      fix_type: fix.fix_type,
      exactMatch: isExactRuleExample(rule, dax),
      confidence
    };
  });

  return results
    .filter((result) => result.confidence > LLM_THRESHOLD)
    .sort((a, b) => {
      if (a.exactMatch !== b.exactMatch) return a.exactMatch ? -1 : 1;
      return b.confidence - a.confidence;
    });
}

function getRuleConfidence(rule) {
  return typeof rule.confidence === "number" ? rule.confidence : 0.8;
}

function formatAnalysisResult(result) {
  return {
    issue: result.issue,
    explanation: result.explanation,
    fix: result.fix,
    fix_type: result.fix_type,
    confidence: Number(result.confidence.toFixed(4))
  };
}

function isExactRuleExample(rule, dax) {
  return Boolean(rule.bad_dax && normalizeRuleText(rule.bad_dax) === normalizeRuleText(dax));
}

function printResults(dax) {
  const results = analyzeDAX(dax).map(formatAnalysisResult);
  console.log(JSON.stringify(results, null, 2));
}

const argDax = process.argv.slice(2).join(" ").trim();

if (require.main === module) {
  if (argDax) {
    printResults(argDax);
  } else {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question("Enter DAX: ", (dax) => {
      printResults(dax);
      rl.close();
    });
  }
}

module.exports = {
  analyzeDAX,
  formatAnalysisResult,
  matchesRule,
  scoreMatch
};
