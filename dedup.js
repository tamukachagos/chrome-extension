function getPriority(category) {
  if (category === "correctness") return 1;
  if (category === "performance") return 2;
  return 3;
}

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeString(str = "") {
  return String(str || "").toLowerCase().trim();
}

function normalizeArray(arr = []) {
  return arr
    .map((x) => normalizeString(x))
    .filter(Boolean)
    .sort();
}

const MAX_CONDITIONS = 5;
const IMPLEMENTATION_SPECIFIC_MARKERS = [
  "called_on",
  "first_argument",
  "second_argument",
  "upper_bound",
  "nested_inside",
  "generated_at_query_time",
  "evaluated_at_query_time",
  "same_userelationship",
  "currentgroup",
  "naturalinnerjoin",
  "naturalleftouterjoin",
  "allselected",
  "allexcept",
  "removefilters",
  "pathcontains",
  "selectedvalue",
  "userelationship",
  "crossfilter",
  "runtime_",
  "_available"
];

function mergeArrays(a = [], b = []) {
  return Array.from(new Set([...a, ...b]));
}

function mergeStrings(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  return `${a} | ${b}`;
}

function signatureText(value) {
  return normalizeSpace(value)
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/[^a-z0-9_\[\]\(\),.=<>! ]/g, "");
}

function conditionKey(condition) {
  return signatureText(condition).replace(/\s+/g, "_");
}

function conditionKeys(conditions = []) {
  return conditions.map(conditionKey).filter(Boolean);
}

function isImplementationSpecificCondition(condition) {
  const key = conditionKey(condition);
  return IMPLEMENTATION_SPECIFIC_MARKERS.some((marker) => key.includes(marker));
}

function hasOverlappingConditions(ruleA, ruleB) {
  const keysA = new Set(conditionKeys(ruleA.detection_logic?.conditions));
  return conditionKeys(ruleB.detection_logic?.conditions).some((key) => keysA.has(key));
}

function removeRedundantConditions(conditions = []) {
  const unique = mergeArrays([], conditions).filter(Boolean);

  return unique.filter((condition) => {
    const key = conditionKey(condition);
    if (!key) return false;

    return !unique.some((other) => {
      const otherKey = conditionKey(other);
      return otherKey && otherKey !== key && key.includes(otherKey) && otherKey.length >= 8;
    });
  });
}

function pruneConditions(conditions = [], preferredA = [], preferredB = []) {
  const candidates = removeRedundantConditions(conditions);
  if (candidates.length <= MAX_CONDITIONS) return candidates;
  const generalCandidates = candidates.filter((condition) => !isImplementationSpecificCondition(condition));
  const rankedCandidates = generalCandidates.length > 0 ? generalCandidates : candidates;

  const overlapKeys = new Set(
    conditionKeys(preferredA).filter((key) => conditionKeys(preferredB).includes(key))
  );

  return rankedCandidates
    .sort((a, b) => {
      const aOverlap = overlapKeys.has(conditionKey(a)) ? 0 : 1;
      const bOverlap = overlapKeys.has(conditionKey(b)) ? 0 : 1;
      if (aOverlap !== bOverlap) return aOverlap - bOverlap;

      const aSpecific = isImplementationSpecificCondition(a) ? 1 : 0;
      const bSpecific = isImplementationSpecificCondition(b) ? 1 : 0;
      if (aSpecific !== bSpecific) return aSpecific - bSpecific;

      return conditionGeneralityScore(b) - conditionGeneralityScore(a);
    })
    .slice(0, MAX_CONDITIONS);
}

function conditionGeneralityScore(condition) {
  const key = conditionKey(condition);
  const tokenCount = key.split("_").filter(Boolean).length;
  const implementationPenalty = isImplementationSpecificCondition(condition) ? 8 : 0;
  const lengthPenalty = Math.max(0, key.length - 34) / 8;
  return 20 - tokenCount - implementationPenalty - lengthPenalty;
}

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean)));
}

function normalizeDetectionLogic(rawLogic = {}) {
  const legacyFunctions = Array.isArray(rawLogic.functions) ? rawLogic.functions : [];
  const primary = rawLogic.primary_function || legacyFunctions[0] || "";
  const secondary = rawLogic.secondary_functions || legacyFunctions.slice(1);

  return {
    primary_function: String(primary || "").trim(),
    secondary_functions: uniq(secondary || []),
    conditions: pruneConditions(uniq(rawLogic.conditions || [])),
    context: normalizeSpace(rawLogic.context || "")
  };
}

function isRuleImplementable(rule) {
  const logic = rule.detection_logic || {};
  return Boolean(
    rule.pattern &&
      rule.fixed_dax &&
      (logic.primary_function || logic.secondary_functions.length || logic.conditions.length || rule.bad_dax)
  );
}

function estimateConfidence(rawRule, detectionLogic) {
  if (typeof rawRule.confidence === "number") return rawRule.confidence;
  if (rawRule.bad_dax && detectionLogic.primary_function && detectionLogic.conditions.length > 0) return 0.92;
  if (rawRule.bad_dax && detectionLogic.primary_function) return 0.88;
  if (rawRule.bad_dax && detectionLogic.conditions.length > 0) return 0.84;
  return 0.72;
}

function normalizeRule(rawRule, index) {
  const category = ["correctness", "performance", "modeling"].includes(rawRule.category)
    ? rawRule.category
    : "modeling";
  const detectionLogic = normalizeDetectionLogic(rawRule.detection_logic);

  return {
    id: rawRule.id || `RULE_${String(index + 1).padStart(3, "0")}`,
    pattern: normalizeSpace(rawRule.pattern),
    bad_dax: normalizeSpace(rawRule.bad_dax),
    detection_logic: detectionLogic,
    fixed_dax: normalizeSpace(rawRule.fixed_dax),
    category,
    priority: getPriority(category),
    confidence: Number(estimateConfidence(rawRule, detectionLogic).toFixed(2)),
    type: category === "modeling" ? "advisory" : "auto_fix"
  };
}

function detectionSignature(rule) {
  const logic = rule.detection_logic;
  return [
    rule.category,
    logic.primary_function.toLowerCase(),
    logic.secondary_functions.map((fn) => fn.toLowerCase()).sort().join(","),
    logic.conditions.map(signatureText).sort().join(","),
    signatureText(logic.context)
  ].join("|");
}

function getDedupKey(rule) {
  const primary = normalizeString(rule.detection_logic?.primary_function);
  const secondary = normalizeArray(rule.detection_logic?.secondary_functions);
  const conditions = normalizeArray(rule.detection_logic?.conditions);
  const context = normalizeString(rule.detection_logic?.context);
  const category = normalizeString(rule.category);
  const patternFallback = normalizeString(rule.pattern);

  return [
    primary,
    ...secondary,
    ...conditions,
    context,
    category,
    patternFallback
  ].join("|");
}

function getConceptKey(rule) {
  return [
    rule.detection_logic?.primary_function,
    rule.category,
    rule.detection_logic?.context
  ]
    .map((x) => normalizeString(x))
    .join("|");
}

function stripMeasureName(value) {
  const text = normalizeSpace(value);
  const equalsIndex = text.indexOf("=");
  return equalsIndex >= 0 ? text.slice(equalsIndex + 1).trim() : text;
}

function getLogicalOutcomeKey(rule) {
  return [
    rule.category,
    signatureText(stripMeasureName(rule.fixed_dax))
  ].join("|");
}

function samePrimaryFunction(ruleA, ruleB) {
  const primaryA = normalizeString(ruleA.detection_logic?.primary_function);
  const primaryB = normalizeString(ruleB.detection_logic?.primary_function);
  return Boolean(primaryA && primaryB && primaryA === primaryB);
}

function sameLogicalOutcome(ruleA, ruleB) {
  const outcomeA = getLogicalOutcomeKey(ruleA);
  const outcomeB = getLogicalOutcomeKey(ruleB);
  return Boolean(outcomeA && outcomeB && outcomeA === outcomeB);
}

function shouldMergeRules(ruleA, ruleB) {
  if (ruleA.category !== ruleB.category) return false;
  if (!hasOverlappingConditions(ruleA, ruleB)) return false;
  return samePrimaryFunction(ruleA, ruleB) || sameLogicalOutcome(ruleA, ruleB);
}

function hasStrongConceptKey(rule) {
  return Boolean(rule.detection_logic?.primary_function && rule.detection_logic?.context);
}

function ruleSignature(rule) {
  const badDax = signatureText(rule.bad_dax);
  if (badDax) return `${rule.category}|bad|${badDax}`;
  return `${rule.category}|detect|${getDedupKey(rule) || detectionSignature(rule)}`;
}

function scoreRule(rule) {
  return (
    rule.confidence * 100 +
    rule.detection_logic.conditions.length * 3 +
    rule.detection_logic.secondary_functions.length * 2 +
    (rule.bad_dax ? 2 : 0) +
    (rule.fixed_dax ? 1 : 0)
  );
}

function generalityScore(rule) {
  const logic = rule.detection_logic || {};
  const conditionCount = Array.isArray(logic.conditions) ? logic.conditions.length : 0;
  const secondaryCount = Array.isArray(logic.secondary_functions) ? logic.secondary_functions.length : 0;
  return 100 - conditionCount - secondaryCount;
}

function getCompressionKey(rule) {
  return hasStrongConceptKey(rule) ? getConceptKey(rule) : ruleSignature(rule);
}

function functionSetKey(rule) {
  const logic = rule.detection_logic || {};
  return [
    normalizeString(logic.primary_function),
    ...normalizeArray(logic.secondary_functions)
  ].join("|");
}

function getFunctionVariant(rule) {
  const logic = rule.detection_logic || {};
  return {
    primary_function: logic.primary_function || "",
    secondary_functions: Array.isArray(logic.secondary_functions) ? logic.secondary_functions : []
  };
}

function getFunctionVariants(group) {
  const variants = [];
  const seen = new Set();

  for (const rule of group) {
    const variant = getFunctionVariant(rule);
    const key = [
      normalizeString(variant.primary_function),
      ...normalizeArray(variant.secondary_functions)
    ].join("|");

    if (key && !seen.has(key)) {
      seen.add(key);
      variants.push(variant);
    }
  }

  return variants;
}

function variantKey(variant) {
  return [
    normalizeString(variant.primary_function),
    ...normalizeArray(variant.secondary_functions)
  ].join("|");
}

function mergeFunctionVariants(ruleA, ruleB) {
  const logicA = ruleA.detection_logic || {};
  const logicB = ruleB.detection_logic || {};
  const variants = [
    ...(Array.isArray(logicA.function_variants) ? logicA.function_variants : []),
    ...(Array.isArray(logicB.function_variants) ? logicB.function_variants : [])
  ];

  if (functionSetKey(ruleA) !== functionSetKey(ruleB)) {
    variants.push(getFunctionVariant(ruleA), getFunctionVariant(ruleB));
  }

  const seen = new Set();
  return variants.filter((variant) => {
    const key = variantKey(variant);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickBestRule(group) {
  return group.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (generalityScore(b) !== generalityScore(a)) return generalityScore(b) - generalityScore(a);
    return scoreRule(b) - scoreRule(a);
  })[0];
}

function mergeRules(ruleA, ruleB) {
  const logicA = ruleA.detection_logic || {};
  const logicB = ruleB.detection_logic || {};
  const functionVariants = mergeFunctionVariants(ruleA, ruleB);

  return {
    ...ruleA,
    pattern:
      String(ruleA.pattern || "").length >= String(ruleB.pattern || "").length
        ? ruleA.pattern
        : ruleB.pattern,
    detection_logic: {
      primary_function:
        logicA.primary_function ||
        logicB.primary_function ||
        "",
      secondary_functions: mergeArrays(
        logicA.secondary_functions,
        logicB.secondary_functions
      ),
      ...(functionVariants.length > 1 ? { function_variants: functionVariants } : {}),
      conditions: pruneConditions(
        mergeArrays(
          logicA.conditions,
          logicB.conditions
        ),
        logicA.conditions,
        logicB.conditions
      ),
      context: mergeStrings(
        logicA.context,
        logicB.context
      )
    },
    confidence: Math.max(ruleA.confidence || 0, ruleB.confidence || 0),
    priority: Math.min(ruleA.priority || getPriority(ruleA.category), ruleB.priority || getPriority(ruleB.category)),
    category: ruleA.category
  };
}

function mergeRuleGroup(group) {
  const best = pickBestRule(group);
  return group.reduce(
    (merged, rule) => mergeRules(merged, rule),
    { ...best, detection_logic: { ...best.detection_logic } }
  );
}

function compressRules(rules) {
  return mergeRuleGroups(rules);
}

function mergeRuleGroups(rules) {
  const merged = [];

  for (const rule of rules) {
    const index = merged.findIndex((candidate) => shouldMergeRules(candidate, rule));

    if (index === -1) {
      merged.push(rule);
    } else {
      merged[index] = mergeRules(merged[index], rule);
    }
  }

  return merged;
}

function dedupeRules(rules) {
  const selected = [];

  for (const rule of rules) {
    const exactKey = ruleSignature(rule);
    const dedupKey = getDedupKey(rule);
    const patternKey = `${rule.category}|${signatureText(rule.pattern)}`;
    const existingIndex = selected.findIndex((candidate) => {
      const candidateExactKey = ruleSignature(candidate);
      const candidateDedupKey = getDedupKey(candidate);
      const candidatePatternKey = `${candidate.category}|${signatureText(candidate.pattern)}`;
      return (
        candidateExactKey === exactKey ||
        candidateDedupKey === dedupKey ||
        candidatePatternKey === patternKey
      );
    });

    if (existingIndex === -1) {
      selected.push(rule);
    } else if (scoreRule(rule) > scoreRule(selected[existingIndex])) {
      selected[existingIndex] = rule;
    }
  }

  return selected;
}

function deduplicate(rules) {
  return dedupeRules(rules.map(normalizeRule));
}

function compileRuleSet(rawRules) {
  let rules = rawRules.map(normalizeRule).filter(isRuleImplementable);
  rules = dedupeRules(rules);
  rules = mergeRuleGroups(rules);

  const compiled = rules.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.pattern.localeCompare(b.pattern);
  });

  return compiled.map((rule, index) => ({
    ...rule,
    id: `RULE_${String(index + 1).padStart(3, "0")}`
  }));
}

if (require.main === module) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    const rules = JSON.parse(input);
    process.stdout.write(`${JSON.stringify(compileRuleSet(rules), null, 2)}\n`);
  });
}

module.exports = {
  compileRuleSet,
  compressRules,
  conditionKey,
  conditionKeys,
  deduplicate,
  dedupeRules,
  functionSetKey,
  getFunctionVariants,
  getFunctionVariant,
  getCompressionKey,
  getConceptKey,
  getDedupKey,
  getLogicalOutcomeKey,
  getPriority,
  generalityScore,
  hasOverlappingConditions,
  hasStrongConceptKey,
  isImplementationSpecificCondition,
  mergeArrays,
  mergeFunctionVariants,
  mergeRuleGroups,
  mergeRuleGroup,
  mergeRules,
  mergeStrings,
  conditionGeneralityScore,
  pruneConditions,
  sameLogicalOutcome,
  samePrimaryFunction,
  shouldMergeRules,
  normalizeArray,
  variantKey,
  normalizeRule
};
