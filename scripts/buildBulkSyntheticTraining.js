#!/usr/bin/env node
/**
 * Bulk synthetic training corpus builder.
 *
 * Expands training/test_suite.json from the domain schemas in
 * training/synthetic_data_factory.json. This is intentionally deterministic and
 * idempotent so it can be run after factory edits without duplicating cases.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FACTORY_PATH = path.join(ROOT, "training", "synthetic_data_factory.json");
const SUITE_PATH = path.join(ROOT, "training", "test_suite.json");

const factory = JSON.parse(fs.readFileSync(FACTORY_PATH, "utf8"));
const suite = JSON.parse(fs.readFileSync(SUITE_PATH, "utf8"));

suite.positive_cases = (suite.positive_cases || []).filter((test) => test.source !== "bulk_synthetic");
suite.negative_cases = (suite.negative_cases || []).filter((test) => test.source !== "bulk_synthetic");
suite.edge_cases = (suite.edge_cases || []).filter((test) => test.source !== "bulk_synthetic");

const existing = {
  positive: new Set(suite.positive_cases.map((test) => test.name)),
  negative: new Set(suite.negative_cases.map((test) => test.name)),
  edge: new Set(suite.edge_cases.map((test) => test.name))
};

const added = { positive: 0, negative: 0, edge: 0 };

function add(kind, test) {
  if (existing[kind].has(test.name)) return;
  existing[kind].add(test.name);
  suite[`${kind}_cases`].push(test);
  added[kind] += 1;
}

function bracket(table, column) {
  return `${table}[${column}]`;
}

function firstTable(domain, type) {
  return (domain.tables || []).find((table) => table.type === type) || null;
}

function tableByName(domain, name) {
  return (domain.tables || []).find((table) => table.name === name) || null;
}

function columnLike(table, patterns, fallbackIndex = 0) {
  if (!table) return "Value";
  return table.columns.find((column) => patterns.some((pattern) => pattern.test(column))) ||
    table.columns[fallbackIndex] ||
    "Value";
}

function metricColumn(table) {
  if (!table) return "Value";
  const banned = [/id$/i, /key$/i, /date/i, /status/i, /type/i, /category/i, /name/i];
  const preferred = [/amount/i, /revenue/i, /salesamount/i, /cost/i, /mrr/i, /arr/i, /qty/i, /quantity/i, /minutes/i, /hours/i, /spend/i, /salary/i, /clicks/i, /sessions/i, /impressions/i];
  return table.columns.find((column) => preferred.some((pattern) => pattern.test(column)) && !banned.some((pattern) => pattern.test(column))) ||
    table.columns.find((column) => !banned.some((pattern) => pattern.test(column))) ||
    table.columns[0] ||
    "Value";
}

function filterColumn(table) {
  if (!table) return { column: "Value", condition: "Value = \"Active\"", clearTarget: "Value" };
  const preferred = table.columns.find((column) => /status|type|category|priority|region|country|segment|platform|channel/i.test(column));
  if (preferred) {
    return {
      column: preferred,
      condition: `${bracket(table.name, preferred)} = "Active"`,
      clearTarget: preferred
    };
  }

  const numeric = table.columns.find((column) => !/name|email|city|country|status|type|category/i.test(column));
  const column = numeric || table.columns[0] || "Value";
  return {
    column,
    condition: `${bracket(table.name, column)} > 0`,
    clearTarget: column
  };
}

function relationshipDimension(domain, fact) {
  const relation = (domain.relationships || []).find((rel) => rel.from.startsWith(`${fact.name}[`));
  if (!relation) return firstTable(domain, "dimension");
  const targetTable = relation.to.split("[")[0];
  return tableByName(domain, targetTable) || firstTable(domain, "dimension");
}

function uniqueValues(columns) {
  return [...new Set(columns.filter(Boolean))];
}

function measureName(domain, suffix) {
  return `${domain.domain.replace(/_/g, " ")} ${suffix}`;
}

function buildDomainCases(domain) {
  const fact = firstTable(domain, "fact");
  const dim = relationshipDimension(domain, fact || {});
  const date = tableByName(domain, "DimDate") || { name: "DimDate", columns: ["Date", "Year", "MonthName", "Month"] };
  if (!fact || !dim) return;

  const amount = metricColumn(fact);
  const key = columnLike(fact, [/id$/i, /key$/i], 0);
  const factFilter = filterColumn(fact);
  const dimKey = columnLike(dim, [/id$/i, /key$/i], 0);
  const dimName = columnLike(dim, [/name/i, /category/i, /segment/i, /region/i, /type/i], Math.min(1, dim.columns.length - 1));
  const dateColumn = date.columns.includes("Date") ? "Date" : date.columns[0];
  const yearColumn = date.columns.includes("Year") ? "Year" : date.columns[0];
  const measure = (domain.valid_measures || [])[0]?.name || "Total";

  const facts = uniqueValues((domain.tables || []).filter((table) => table.type === "fact").map((table) => table.name));
  const dimensions = uniqueValues((domain.tables || []).filter((table) => table.type === "dimension").map((table) => table.name));

  const positiveTemplates = [
    {
      suffix: "SUMX direct additive fact scan",
      input: `${measureName(domain, "Amount")} = SUMX(${fact.name}, ${bracket(fact.name, amount)})`,
      issue: "adv-perf-039: SUMX over a fact table for a directly additive column should be SUM",
      fix: `${measureName(domain, "Amount")} = SUM(${bracket(fact.name, amount)})`
    },
    {
      suffix: "COUNTROWS FILTER fact equality",
      input: `${measureName(domain, "Filtered Count")} = COUNTROWS(FILTER(${fact.name}, ${factFilter.condition}))`,
      issue: "adv-perf-069: COUNTROWS(FILTER(FactTable, condition)) should use CALCULATE(COUNTROWS(), condition)",
      fix: `${measureName(domain, "Filtered Count")} = CALCULATE(COUNTROWS(${fact.name}), ${factFilter.condition})`
    },
    {
      suffix: "FILTER ALL dimension equality",
      input: `${measureName(domain, "Filtered")} = CALCULATE([${measure}], FILTER(ALL(${dim.name}), ${bracket(dim.name, dimName)} = "Target"))`,
      issue: "adv-cor-001: FILTER(ALL(dim)) wrapping a single equality condition should use a direct column filter",
      fix: `${measureName(domain, "Filtered")} = CALCULATE([${measure}], ${bracket(dim.name, dimName)} = "Target")`
    },
    {
      suffix: "RANKX over fact table",
      input: `${measureName(domain, "Rank")} = RANKX(ALL(${fact.name}), [${measure}])`,
      issue: "adv-perf-077: RANKX over an entire fact table should rank over a dimension or aggregated table",
      fix: `${measureName(domain, "Rank")} = RANKX(ALLSELECTED(${bracket(dim.name, dimName)}), [${measure}], , DESC, Dense)`
    },
    {
      suffix: "CONCATENATEX missing order",
      input: `${measureName(domain, "List")} = CONCATENATEX(${dim.name}, ${bracket(dim.name, dimName)}, ", ")`,
      issue: "adv-cor-008: CONCATENATEX without ORDERBY returns nondeterministic output",
      fix: `${measureName(domain, "List")} = CONCATENATEX(${dim.name}, ${bracket(dim.name, dimName)}, ", ", ${bracket(dim.name, dimName)}, ASC)`
    },
    {
      suffix: "FORMAT numeric measure",
      input: `${measureName(domain, "Display")} = FORMAT([${measure}], "#,##0")`,
      issue: "adv-cor-010: FORMAT returns text and breaks numeric aggregation or sort",
      fix: "Use the Power BI format pane instead of FORMAT in the DAX measure"
    },
    {
      suffix: "DATEADD minus 365 days",
      input: `${measureName(domain, "PY")} = CALCULATE([${measure}], DATEADD(${bracket(date.name, dateColumn)}, -365, DAY))`,
      issue: "adv-perf-074: DATEADD with -365 DAY misses leap years; use SAMEPERIODLASTYEAR",
      fix: `${measureName(domain, "PY")} = CALCULATE([${measure}], SAMEPERIODLASTYEAR(${bracket(date.name, dateColumn)}))`
    },
    {
      suffix: "hardcoded year literal",
      input: `${measureName(domain, "2024")} = CALCULATE([${measure}], ${bracket(date.name, yearColumn)} = 2024)`,
      issue: "adv-model-076: Hardcoded year literal silently becomes wrong as the calendar changes",
      fix: `${measureName(domain, "CY")} = CALCULATE([${measure}], DATESYTD(${bracket(date.name, dateColumn)}))`
    },
    {
      suffix: "multiple OR same column",
      input: `${measureName(domain, "Multi Filter")} = CALCULATE([${measure}], ${bracket(dim.name, dimName)} = "A" || ${bracket(dim.name, dimName)} = "B" || ${bracket(dim.name, dimName)} = "C")`,
      issue: "adv-perf-075: Multiple OR conditions on the same column should use IN",
      fix: `${measureName(domain, "Multi Filter")} = CALCULATE([${measure}], ${bracket(dim.name, dimName)} IN {"A", "B", "C"})`
    },
    {
      suffix: "TOPN no tiebreaker",
      input: `${measureName(domain, "Top N")} = CALCULATE([${measure}], TOPN(5, ALL(${dim.name}), [${measure}], DESC))`,
      issue: "adv-cor-070: TOPN without a tiebreaker can include nondeterministic rows",
      fix: `${measureName(domain, "Top N")} = CALCULATE([${measure}], TOPN(5, ALL(${dim.name}), [${measure}], DESC, ${bracket(dim.name, dimKey)}, ASC))`
    },
    {
      suffix: "ALL fact table removes security context",
      input: `${measureName(domain, "Grand Total")} = CALCULATE([${measure}], ALL(${fact.name}))`,
      issue: "adv-perf-038: ALL on a fact table removes broad filters and can bypass intended security context",
      fix: `${measureName(domain, "Grand Total")} = CALCULATE([${measure}], REMOVEFILTERS(${bracket(fact.name, factFilter.clearTarget)}))`
    },
    {
      suffix: "REMOVEFILTERS full fact table",
      input: `${measureName(domain, "Unscoped Total")} = CALCULATE([${measure}], REMOVEFILTERS(${fact.name}))`,
      issue: "adv-model-075: REMOVEFILTERS(Table) clears all table filters; list only intended columns",
      fix: `${measureName(domain, "Unscoped Total")} = CALCULATE([${measure}], REMOVEFILTERS(${bracket(fact.name, factFilter.clearTarget)}))`
    }
  ];

  positiveTemplates.forEach((template) => add("positive", {
    name: `[bulk:${domain.domain}] ${template.suffix}`,
    input: template.input,
    expected_issue: template.issue,
    expected_fix: template.fix,
    domain: domain.domain,
    source: "bulk_synthetic"
  }));

  const negativeTemplates = [
    {
      suffix: "base SUM additive column",
      input: `${measureName(domain, "Amount")} = SUM(${bracket(fact.name, amount)})`,
      notes: "Direct additive measure"
    },
    {
      suffix: "safe DIVIDE measure",
      input: `${measureName(domain, "Ratio")} = DIVIDE(SUM(${bracket(fact.name, amount)}), DISTINCTCOUNT(${bracket(fact.name, key)}))`,
      notes: "DIVIDE handles zero denominators"
    },
    {
      suffix: "direct CALCULATE equality",
      input: `${measureName(domain, "Filtered")} = CALCULATE([${measure}], ${factFilter.condition})`,
      notes: "Direct filter argument avoids FILTER iterator"
    },
    {
      suffix: "SAMEPERIODLASTYEAR",
      input: `${measureName(domain, "PY")} = CALCULATE([${measure}], SAMEPERIODLASTYEAR(${bracket(date.name, dateColumn)}))`,
      notes: "Correct prior-year time intelligence"
    },
    {
      suffix: "TOPN with tiebreaker",
      input: `${measureName(domain, "Top N")} = CALCULATE([${measure}], TOPN(5, ALL(${dim.name}), [${measure}], DESC, ${bracket(dim.name, dimKey)}, ASC))`,
      notes: "Stable TOPN ordering"
    },
    {
      suffix: "CONCATENATEX ordered",
      input: `${measureName(domain, "List")} = CONCATENATEX(${dim.name}, ${bracket(dim.name, dimName)}, ", ", ${bracket(dim.name, dimName)}, ASC)`,
      notes: "Deterministic string aggregation"
    },
    {
      suffix: "RANKX over dimension",
      input: `${measureName(domain, "Rank")} = RANKX(ALLSELECTED(${bracket(dim.name, dimName)}), [${measure}], , DESC, Dense)`,
      notes: "Ranks visible dimension members"
    },
    {
      suffix: "IN filter list",
      input: `${measureName(domain, "Multi Filter")} = CALCULATE([${measure}], ${bracket(dim.name, dimName)} IN {"A", "B", "C"})`,
      notes: "Preferred multi-value column filter"
    }
  ];

  negativeTemplates.forEach((template) => add("negative", {
    name: `[bulk:${domain.domain}] valid: ${template.suffix}`,
    input: template.input,
    expected_issue: "none",
    notes: template.notes,
    domain: domain.domain,
    source: "bulk_synthetic"
  }));

  facts.slice(0, 3).forEach((leftFact, index) => {
    facts.slice(index + 1, index + 3).forEach((rightFact) => add("edge", {
      name: `[bulk:${domain.domain}] cross-fact visual ${leftFact} plus ${rightFact}`,
      input: `// Visual combines [${leftFact} metric] and [${rightFact} metric] by ${bracket(dim.name, dimName)}`,
      expected_issue: "adv-model-063: Cross-fact visuals sharing a dimension can produce blank rows or inflated totals without explicit bridge logic",
      expected_fix: "Use a shared conformed dimension, TREATAS, or split the metrics into separate visuals",
      domain: domain.domain,
      source: "bulk_synthetic"
    }));
  });

  dimensions.slice(0, 3).forEach((dimensionName) => add("edge", {
    name: `[bulk:${domain.domain}] high cardinality axis ${dimensionName}`,
    input: `// Bar chart axis: ${dimensionName}[${dimName}], values: [${measure}]`,
    expected_issue: "adv-model-069: High-cardinality axes make visual comparison unreadable",
    expected_fix: "Apply Top N, group remaining members as Other, or move details to drill-through",
    domain: domain.domain,
    source: "bulk_synthetic"
  }));

  add("edge", {
    name: `[bulk:${domain.domain}] MonthName text sort`,
    input: `// Line chart axis: ${bracket(date.name, "MonthName")}, values: [${measure}]`,
    expected_issue: "visual: MonthName text sorts alphabetically instead of calendar order",
    expected_fix: `Sort ${bracket(date.name, "MonthName")} by ${bracket(date.name, "Month")}`,
    domain: domain.domain,
    source: "bulk_synthetic"
  });
}

(factory.domains || []).forEach(buildDomainCases);

const tempSuitePath = `${SUITE_PATH}.tmp`;
fs.writeFileSync(tempSuitePath, `${JSON.stringify(suite, null, 2)}\n`, "utf8");
fs.renameSync(tempSuitePath, SUITE_PATH);

console.log("\n=== Bulk Synthetic Training Builder ===");
console.log(`  New positive cases added: ${added.positive}`);
console.log(`  New negative cases added: ${added.negative}`);
console.log(`  New edge cases added:     ${added.edge}`);
console.log(`  test_suite.json now has ${suite.positive_cases.length} pos / ${suite.negative_cases.length} neg / ${suite.edge_cases.length} edge`);
console.log("\nDone. Run: node scripts/testRunner.js\n");
