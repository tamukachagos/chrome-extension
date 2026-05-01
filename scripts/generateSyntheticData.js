#!/usr/bin/env node
/**
 * Synthetic Training Data Generator for PBI Copilot
 *
 * Reads synthetic_data_factory.json and expands:
 *   1. test_suite.json  — new positive, negative, and edge cases
 *   2. rules_advanced.json — new rules for patterns not yet covered
 *
 * Safe to run multiple times — deduplicates by name/id before writing.
 */

const fs   = require("fs");
const path = require("path");

const ROOT     = path.join(__dirname, "..");
const FACTORY  = path.join(ROOT, "training", "synthetic_data_factory.json");
const RULES    = path.join(ROOT, "training", "rules_advanced.json");
const SUITE    = path.join(ROOT, "training", "test_suite.json");

// ── Load existing data ────────────────────────────────────────────────────────

const factory = JSON.parse(fs.readFileSync(FACTORY, "utf8"));
const rulesRaw = JSON.parse(fs.readFileSync(RULES, "utf8"));
const suite    = JSON.parse(fs.readFileSync(SUITE, "utf8"));

const existingRules = Array.isArray(rulesRaw) ? rulesRaw : (rulesRaw.rules || Object.values(rulesRaw));
const existingRuleIds = new Set(existingRules.map(r => r.id));

const existingPosNames  = new Set(suite.positive_cases.map(t => t.name));
const existingNegNames  = new Set((suite.negative_cases || []).map(t => t.name));
const existingEdgeNames = new Set((suite.edge_cases || []).map(t => t.name));

let newRules = [];
let newPos   = [];
let newNeg   = [];
let newEdge  = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function addRule(rule) {
  if (!existingRuleIds.has(rule.id)) {
    existingRuleIds.add(rule.id);
    newRules.push(rule);
  }
}

function addPos(tc) {
  if (!existingPosNames.has(tc.name)) {
    existingPosNames.add(tc.name);
    newPos.push(tc);
  }
}

function addNeg(tc) {
  if (!existingNegNames.has(tc.name)) {
    existingNegNames.add(tc.name);
    newNeg.push(tc);
  }
}

function addEdge(tc) {
  if (!existingEdgeNames.has(tc.name)) {
    existingEdgeNames.add(tc.name);
    newEdge.push(tc);
  }
}

// ── 1. Rules derived from synthetic_data_factory modeling & visual scenarios ─

// These are referenced by the factory but missing from rules_advanced
addRule({
  id: "adv-model-063",
  pattern: "Two fact tables sharing a dimension — cross-filter produces unexpected BLANK rows when dimension value has no match in both facts",
  bad_dax: "// FactUsage and FactSubscriptions both connect to DimAccount — filtering by account may give BLANK for accounts present in one fact but not the other",
  detection_logic: {
    functions: ["CALCULATE", "CROSSFILTER"],
    conditions: [
      "two or more fact tables share a single dimension table",
      "a measure from one fact is placed in the same visual as a measure from the other fact",
      "no TREATAS or USERELATIONSHIP bridges the two facts"
    ],
    context: "multi-fact_model"
  },
  fixed_dax: "// Use TREATAS to apply shared dimension context explicitly:\nMetric = CALCULATE([MRR], TREATAS(VALUES(DimAccount[AccountID]), FactUsage[AccountID]))",
  category: "modeling",
  confidence: 0.81,
  fix_type: "needs_review",
  requires_llm: true
});

addRule({
  id: "adv-model-066",
  pattern: "Role-playing dimension with only one active relationship — measures using inactive relationship require USERELATIONSHIP in every measure",
  bad_dax: "Shipments To = COUNTROWS(FactShipments)  -- uses active OriginKey relationship, ignores DestinationKey",
  detection_logic: {
    functions: ["USERELATIONSHIP"],
    conditions: [
      "table has two foreign keys pointing to the same dimension",
      "one relationship is inactive",
      "measure does not use USERELATIONSHIP for the inactive path"
    ],
    context: "role_playing_dimension"
  },
  fixed_dax: "Shipments To = CALCULATE(COUNTROWS(FactShipments), USERELATIONSHIP(FactShipments[DestinationKey], DimLocation[LocationKey]))",
  category: "modeling",
  confidence: 0.85,
  fix_type: "needs_review",
  requires_llm: false
});

addRule({
  id: "adv-model-067",
  pattern: "Snapshot fact table summed without date filter — periodic snapshot values inflate when summed across all snapshot dates",
  bad_dax: "Total Stock = SUM(FactInventory[OnHandQty])  -- sums across all daily snapshots, not just latest",
  detection_logic: {
    functions: ["SUM", "SUMX"],
    conditions: [
      "fact table grain is 'one row per entity per day' (snapshot)",
      "measure sums a stock/balance/headcount column without date filter",
      "result appears inflated when no date slicer is applied"
    ],
    context: "semi_additive_snapshot_fact"
  },
  fixed_dax: "Total Stock = CALCULATE(SUM(FactInventory[OnHandQty]), LASTDATE(DimDate[Date]))",
  category: "correctness",
  confidence: 0.88,
  fix_type: "needs_review",
  requires_llm: true
});

addRule({
  id: "adv-model-068",
  pattern: "Fan trap — many-to-many between two fact tables via shared dimension causes overcounting",
  bad_dax: "// DimBudget connected to DimAccount; FactGL connected to DimAccount — joining both in a visual can double-count rows",
  detection_logic: {
    functions: ["SUMMARIZECOLUMNS", "CROSSFILTER"],
    conditions: [
      "two tables that are both 'fact-like' are both connected to the same dimension",
      "a visual or measure spans both tables",
      "no bridge table or TREATAS isolates the join path"
    ],
    context: "many_to_many_via_shared_dimension"
  },
  fixed_dax: "// Use TREATAS or a dedicated bridge table to control filter propagation:\nBudget in Context = CALCULATE([Budget Amount], TREATAS(VALUES(FactGL[AccountKey]), DimBudget[AccountKey]))",
  category: "modeling",
  confidence: 0.79,
  fix_type: "needs_review",
  requires_llm: true
});

addRule({
  id: "adv-perf-069",
  pattern: "COUNTROWS(FILTER(FactTable, condition)) — use CALCULATE(COUNTROWS(), condition) instead",
  bad_dax: "Churn Count = COUNTROWS(FILTER(FactSubscriptions, FactSubscriptions[Status] = \"Churned\"))",
  detection_logic: {
    functions: ["COUNTROWS", "FILTER"],
    conditions: [
      "COUNTROWS wraps a FILTER on a fact table",
      "the condition inside FILTER is a simple equality or comparison",
      "no table-level iterator semantics are required"
    ],
    context: "measure_or_calculated_column"
  },
  fixed_dax: "Churn Count = CALCULATE(COUNTROWS(FactSubscriptions), FactSubscriptions[Status] = \"Churned\")",
  category: "performance",
  confidence: 0.95,
  fix_type: "safe",
  requires_llm: false
});

addRule({
  id: "adv-cor-070",
  pattern: "TOPN without tiebreaker second sort column — tied values produce nondeterministic row inclusion",
  bad_dax: "Top 3 Plans = CALCULATE([MRR], TOPN(3, ALL(DimPlan), [MRR], DESC))",
  detection_logic: {
    functions: ["TOPN"],
    conditions: [
      "TOPN has exactly 3 arguments (N, table, expression)",
      "no secondary sort column is provided",
      "result is used in a CALCULATE filter or SUMX — inclusion affects numeric result"
    ],
    context: "topn_filter_measure"
  },
  fixed_dax: "Top 3 Plans = CALCULATE([MRR], TOPN(3, ALL(DimPlan), [MRR], DESC, DimPlan[PlanKey], ASC))",
  category: "correctness",
  confidence: 0.87,
  fix_type: "needs_review",
  requires_llm: false
});

addRule({
  id: "adv-cor-071",
  pattern: "USERNAME() used in RLS — deprecated in Power BI Service, silently returns UPN in some tenants and empty in others",
  bad_dax: "[RLS Filter] = FILTER(DimEmployee, DimEmployee[Email] = USERNAME())",
  detection_logic: {
    functions: ["USERNAME"],
    conditions: [
      "USERNAME() appears in an RLS expression or measure",
      "not wrapped with USERPRINCIPALNAME() fallback",
      "target field is an email address"
    ],
    context: "rls_row_level_security"
  },
  fixed_dax: "[RLS Filter] = FILTER(DimEmployee, LOWER(DimEmployee[Email]) = LOWER(USERPRINCIPALNAME()))",
  category: "correctness",
  confidence: 0.96,
  fix_type: "safe",
  requires_llm: false
});

addRule({
  id: "adv-cor-072",
  pattern: "RELATED() called directly in a measure body — requires row context; fails with 'RELATED can only be used in row context' error",
  bad_dax: "Over Band = COUNTROWS(FILTER(FactHeadcount, FactHeadcount[Salary] > RELATED(DimJobLevel[SalaryMax])))",
  detection_logic: {
    functions: ["RELATED"],
    conditions: [
      "RELATED is used inside FILTER iterating a fact table from a measure",
      "the relationship exists but RELATED is being used in filter predicate without SUMX/AVERAGEX wrapper"
    ],
    context: "measure_with_filter_iterator"
  },
  fixed_dax: "Over Band = COUNTROWS(FILTER(FactHeadcount, FactHeadcount[Salary] > RELATED(DimJobLevel[SalaryMax])))\n-- Note: RELATED is valid here since FILTER provides row context over FactHeadcount.\n-- Fix: ensure the relationship from FactHeadcount to DimJobLevel is active.",
  category: "correctness",
  confidence: 0.83,
  fix_type: "needs_review",
  requires_llm: true
});

addRule({
  id: "adv-perf-073",
  pattern: "LOOKUPVALUE inside SUMX when a direct relationship would allow RELATED — 10-100x slower",
  bad_dax: "USD Amount = SUMX(FactGL, FactGL[Amount] * LOOKUPVALUE(DimExchange[Rate], DimExchange[Currency], FactGL[Currency]))",
  detection_logic: {
    functions: ["LOOKUPVALUE", "SUMX"],
    conditions: [
      "LOOKUPVALUE appears inside a row iterator (SUMX, AVERAGEX, etc.)",
      "the lookup key matches a column that could be used as a relationship key",
      "a direct relationship could replace the lookup"
    ],
    context: "iterator_with_lookup"
  },
  fixed_dax: "// Add relationship from FactGL[Currency] to DimExchange[Currency], then:\nUSD Amount = SUMX(FactGL, FactGL[Amount] * RELATED(DimExchange[Rate]))",
  category: "performance",
  confidence: 0.89,
  fix_type: "needs_review",
  requires_llm: false
});

addRule({
  id: "adv-perf-074",
  pattern: "DATEADD with -365 DAY for prior year — misses leap years, produces wrong date range",
  bad_dax: "MRR PY = CALCULATE([MRR], DATEADD(DimDate[Date], -365, DAY))",
  detection_logic: {
    functions: ["DATEADD"],
    conditions: [
      "DATEADD offset is -365 or 365",
      "interval is DAY",
      "intent is to compare same period in prior year"
    ],
    context: "prior_year_comparison"
  },
  fixed_dax: "MRR PY = CALCULATE([MRR], SAMEPERIODLASTYEAR(DimDate[Date]))",
  category: "performance",
  confidence: 0.92,
  fix_type: "safe",
  requires_llm: false
});

addRule({
  id: "adv-perf-075",
  pattern: "Multiple OR conditions on same column — IN operator is faster and more readable",
  bad_dax: "Social Spend = CALCULATE([CTR], DimChannel[Platform] = \"Facebook\" || DimChannel[Platform] = \"Instagram\" || DimChannel[Platform] = \"Twitter\")",
  detection_logic: {
    functions: ["CALCULATE"],
    conditions: [
      "three or more OR conditions in the same CALCULATE filter",
      "all OR branches test the same column against different literal values",
      "IN operator would express the same logic more efficiently"
    ],
    context: "multi_value_filter"
  },
  fixed_dax: "Social Spend = CALCULATE([CTR], DimChannel[Platform] IN {\"Facebook\", \"Instagram\", \"Twitter\"})",
  category: "performance",
  confidence: 0.93,
  fix_type: "safe",
  requires_llm: false
});

addRule({
  id: "adv-model-076",
  pattern: "Hardcoded year literal in measure — will silently return wrong results when calendar year changes",
  bad_dax: "Revenue 2024 = CALCULATE([Revenue], DimDate[Year] = 2024)",
  detection_logic: {
    functions: ["CALCULATE"],
    conditions: [
      "a numeric year literal (e.g. 2023, 2024) is used as a filter argument",
      "the literal is a hardcoded constant, not derived from a parameter or slicer",
      "measure name or comment implies it is a 'current year' measure"
    ],
    context: "current_year_measure"
  },
  fixed_dax: "Revenue CY = CALCULATE([Revenue], DATESYTD(DimDate[Date]))",
  category: "modeling",
  confidence: 0.91,
  fix_type: "needs_review",
  requires_llm: false
});

addRule({
  id: "adv-perf-077",
  pattern: "RANKX over an entire fact table — should rank over a dimension or aggregated table",
  bad_dax: "Sales Rank = RANKX(ALL(FactCampaigns), [ROAS])",
  detection_logic: {
    functions: ["RANKX", "ALL"],
    conditions: [
      "RANKX first argument is ALL() of a fact table (high row count)",
      "ranking over the fact table produces one rank per fact row, not per dimension member"
    ],
    context: "ranking_measure"
  },
  fixed_dax: "Sales Rank = RANKX(ALLSELECTED(DimChannel[ChannelName]), [ROAS], , DESC, Dense)",
  category: "performance",
  confidence: 0.88,
  fix_type: "needs_review",
  requires_llm: false
});

addRule({
  id: "adv-cor-078",
  pattern: "SWITCH with duplicate condition value — second branch with same value is unreachable",
  bad_dax: "Work Category = SWITCH(FactWorkOrders[WorkType], \"EM\", \"Emergency\", \"PM\", \"Preventive\", \"EM\", \"Emergency2\", \"Unknown\")",
  detection_logic: {
    functions: ["SWITCH"],
    conditions: [
      "SWITCH first argument is not TRUE()",
      "two or more case values are identical strings or numbers",
      "the second occurrence of the duplicate case can never be reached"
    ],
    context: "switch_lookup_measure_or_column"
  },
  fixed_dax: "Work Category = SWITCH(FactWorkOrders[WorkType], \"EM\", \"Emergency\", \"PM\", \"Preventive\", \"CM\", \"Corrective\", \"Unknown\")",
  category: "correctness",
  confidence: 0.97,
  fix_type: "safe",
  requires_llm: false
});

addRule({
  id: "adv-model-079",
  pattern: "TODAY() in a calculated column — column evaluated at refresh time, stale between refreshes",
  bad_dax: "Asset Age Years = DATEDIFF(DimAsset[InstalledDate], TODAY(), YEAR)",
  detection_logic: {
    functions: ["TODAY", "NOW"],
    conditions: [
      "TODAY() or NOW() used in a calculated column definition",
      "column stores age, duration, or days-since value",
      "the value becomes incorrect between dataset refreshes"
    ],
    context: "calculated_column"
  },
  fixed_dax: "// Move to a measure:\nAsset Age Years = DATEDIFF(MAX(DimAsset[InstalledDate]), TODAY(), YEAR)",
  category: "modeling",
  confidence: 0.95,
  fix_type: "needs_review",
  requires_llm: false
});

// ── 2. Positive test cases from bad_measures in all domains ──────────────────

factory.domains.forEach(domain => {
  (domain.bad_measures || []).forEach(bm => {
    addPos({
      name: `[${domain.domain}] ${bm.name}`,
      input: bm.dax,
      expected_issue: `${bm.expected_rule}: ${bm.issue}`,
      expected_fix: `See fix_template for ${bm.expected_rule}`,
      domain: domain.domain
    });
  });

  // Positive cases from modeling_scenarios
  (domain.modeling_scenarios || []).forEach(ms => {
    if (ms.expected_rule) {
      addPos({
        name: `[${domain.domain}] modeling: ${ms.scenario}`,
        input: ms.scenario,
        expected_issue: `${ms.expected_rule}: ${ms.issue}`,
        expected_fix: ms.fix,
        domain: domain.domain
      });
    }
  });
});

// Power Query scenarios → positive cases
(factory.power_query_scenarios || []).forEach(pq => {
  addPos({
    name: `[pq] ${pq.scenario}`,
    input: pq.code_pattern,
    expected_issue: `${pq.expected_rule}: ${pq.issue}`,
    expected_fix: pq.fix,
    domain: "power_query"
  });
});

// ── 3. Negative test cases from valid_measures (should NOT trigger any rule) ─

factory.domains.forEach(domain => {
  (domain.valid_measures || []).slice(0, 4).forEach(vm => {
    addNeg({
      name: `[${domain.domain}] valid: ${vm.name}`,
      input: vm.dax,
      expected_issue: "none",
      notes: `Correct pattern: ${vm.purpose}`,
      domain: domain.domain
    });
  });
});

// ── 4. Edge cases ─────────────────────────────────────────────────────────────

// Edge: empty string in SWITCH
addEdge({
  name: "SWITCH with empty string case",
  input: "Label = SWITCH(Sales[Status], \"\", \"Blank Status\", \"Active\", \"Active\", \"Unknown\")",
  expected_issue: "adv-cor-078: Empty string is a valid case value but often unintentional; verify data quality",
  expected_fix: "Add data quality check; use ISBLANK() separately"
});

// Edge: DIVIDE by zero measure used as denominator
addEdge({
  name: "DIVIDE result used as denominator without zero guard",
  input: "Ratio = [Total Sales] / [Conversion Rate]",
  expected_issue: "adv-cor-003: Division by measure that can return BLANK or zero",
  expected_fix: "Ratio = DIVIDE([Total Sales], [Conversion Rate])"
});

// Edge: time intelligence on non-marked date table
addEdge({
  name: "DATESYTD on column from non-marked date table",
  input: "YTD Bad = CALCULATE([Revenue], DATESYTD(Orders[OrderDate]))",
  expected_issue: "adv-perf-050: Date argument from fact table, not from marked Date table — time intelligence may misbehave",
  expected_fix: "CALCULATE([Revenue], DATESYTD('Date'[Date]))"
});

// Edge: ALLSELECTED with no slicer in scope
addEdge({
  name: "ALLSELECTED produces ALL behavior when no slicer is active",
  input: "Pct = DIVIDE([Sales], CALCULATE([Sales], ALLSELECTED(Product[Category])))",
  expected_issue: "adv-cor-004: ALLSELECTED returns ALL when called from DAX Studio or when no slicer exists",
  expected_fix: "Add ISINSCOPE guard or document that behavior is expected in no-slicer context"
});

// Edge: Snapshot fact summed with partial date range selected
addEdge({
  name: "Headcount summed across multiple snapshot months",
  input: "HC Total = SUM(FactHeadcount[Salary])",
  expected_issue: "adv-model-067: Snapshot fact — summing salary across all months inflates by month count",
  expected_fix: "HC Total = CALCULATE(SUM(FactHeadcount[Salary]), LASTDATE(DimDate[Date]))"
});

// Edge: CONCATENATEX with very large table
addEdge({
  name: "CONCATENATEX over full fact table — may return truncated or blank result",
  input: "All Items = CONCATENATEX(FactSales, FactSales[SalesID], \", \")",
  expected_issue: "adv-cor-007/adv-perf: CONCATENATEX over millions of rows will timeout or be truncated by Power BI",
  expected_fix: "Limit with TOPN or aggregate before concatenating"
});

// Edge: Inactive relationship not activated in measure
addEdge({
  name: "Measure referencing inactive relationship without USERELATIONSHIP",
  input: "Deliveries by Destination = COUNTROWS(FactShipments)",
  expected_issue: "adv-model-066: DestinationKey→DimLocation is inactive; measure uses OriginKey relationship instead",
  expected_fix: "CALCULATE(COUNTROWS(FactShipments), USERELATIONSHIP(FactShipments[DestinationKey], DimLocation[LocationKey]))"
});

// Edge: RELATED in non-iterator measure (fails at runtime)
addEdge({
  name: "RELATED called at measure top level — runtime error",
  input: "Cat = RELATED(DimProduct[Category])",
  expected_issue: "adv-cor-072: RELATED requires row context — fails at measure top level",
  expected_fix: "SUMX(FactSales, RELATED(DimProduct[Category]))  -- only if you need row-level iteration"
});

// Edge: USERNAME vs USERPRINCIPALNAME in cloud
addEdge({
  name: "USERNAME() in Power BI cloud RLS — returns empty in some tenants",
  input: "[RLS] = DimEmployee[Email] = USERNAME()",
  expected_issue: "adv-cor-071: USERNAME() deprecated in Power BI Service",
  expected_fix: "[RLS] = LOWER(DimEmployee[Email]) = LOWER(USERPRINCIPALNAME())"
});

// Edge: ALL on full fact table inside CALCULATE used in RLS context
addEdge({
  name: "ALL(FactSales) removes RLS row-level security filters",
  input: "Market Total = CALCULATE([Revenue], ALL(FactSales))",
  expected_issue: "adv-perf-038: ALL on a fact table removes all filters including RLS — security bypass risk",
  expected_fix: "CALCULATE([Revenue], REMOVEFILTERS(FactSales[Region]))"
});

// Domain-specific visual edge cases
addEdge({
  name: "MonthName sorted alphabetically — visual shows Apr before Jan",
  input: "// Line chart axis: DimDate[MonthName], values: [Total Sales]",
  expected_issue: "visual: MonthName is text — sorts alphabetically (Apr, Aug, Dec...) not by month number",
  expected_fix: "Sort MonthName by Month (integer) column in DimDate model view"
});

addEdge({
  name: "MRR and ARR on same y-axis — MRR line invisible at scale",
  input: "// Area chart: axis DimDate[Date], values [MRR] and [ARR]",
  expected_issue: "visual: ARR = MRR * 12 — ARR dominates scale, MRR line appears flat at bottom",
  expected_fix: "Put ARR on secondary axis or show in separate visual"
});

// ── 5. Additional positive cases from NEW rules ───────────────────────────────

addPos({
  name: "COUNTROWS(FILTER(fact, condition)) — slow pattern",
  input: "Active Subs = COUNTROWS(FILTER(FactSubscriptions, FactSubscriptions[Status] = \"Active\"))",
  expected_issue: "adv-perf-069: COUNTROWS(FILTER(fact)) — use CALCULATE(COUNTROWS(), condition)",
  expected_fix: "CALCULATE(COUNTROWS(FactSubscriptions), FactSubscriptions[Status] = \"Active\")"
});

addPos({
  name: "Multiple OR conditions — use IN operator",
  input: "EU Sales = CALCULATE([Revenue], DimTerritory[Region] = \"DE\" || DimTerritory[Region] = \"FR\" || DimTerritory[Region] = \"UK\" || DimTerritory[Region] = \"IT\")",
  expected_issue: "adv-perf-075: Four OR conditions on same column — use IN {\"DE\",\"FR\",\"UK\",\"IT\"}",
  expected_fix: "CALCULATE([Revenue], DimTerritory[Region] IN {\"DE\", \"FR\", \"UK\", \"IT\"})"
});

addPos({
  name: "RANKX over fact table — should rank over dimension",
  input: "Order Rank = RANKX(ALL(FactSales), [Total Sales])",
  expected_issue: "adv-perf-077: RANKX over FactSales (5M rows) — rank over DimCustomer or DimProduct instead",
  expected_fix: "RANKX(ALLSELECTED(DimCustomer[CustomerName]), [Total Sales], , DESC, Dense)"
});

addPos({
  name: "SWITCH duplicate case value",
  input: "Priority Label = SWITCH(FactWorkOrders[Priority], \"P1\", \"Critical\", \"P2\", \"High\", \"P1\", \"Urgent\", \"Normal\")",
  expected_issue: "adv-cor-078: 'P1' appears twice — second branch 'Urgent' can never be reached",
  expected_fix: "Remove duplicate 'P1' branch; consolidate to single case value"
});

addPos({
  name: "TODAY() in calculated column — stale between refreshes",
  input: "Days Since Hire = DATEDIFF(DimEmployee[HireDate], TODAY(), DAY)",
  expected_issue: "adv-model-079: TODAY() in calculated column is frozen at refresh — becomes stale immediately after",
  expected_fix: "Move to a measure: Days Since Hire = DATEDIFF(MAX(DimEmployee[HireDate]), TODAY(), DAY)"
});

addPos({
  name: "DATEADD -365 DAY for prior year",
  input: "ARR PY = CALCULATE([ARR], DATEADD(DimDate[Date], -365, DAY))",
  expected_issue: "adv-perf-074: DATEADD -365 DAY ignores leap years — use SAMEPERIODLASTYEAR",
  expected_fix: "CALCULATE([ARR], SAMEPERIODLASTYEAR(DimDate[Date]))"
});

addPos({
  name: "Hardcoded year 2023 in measure",
  input: "Budget 2023 = CALCULATE([Budget Amount], DimDate[Year] = 2023)",
  expected_issue: "adv-model-076: Year literal 2023 — measure becomes wrong after 2023",
  expected_fix: "CALCULATE([Budget Amount], DATESYTD(DimDate[Date]))"
});

addPos({
  name: "USERNAME() in RLS filter",
  input: "[RLS] = FactHeadcount[ManagerEmail] = USERNAME()",
  expected_issue: "adv-cor-071: USERNAME() deprecated in Power BI Service — use USERPRINCIPALNAME()",
  expected_fix: "[RLS] = LOWER(FactHeadcount[ManagerEmail]) = LOWER(USERPRINCIPALNAME())"
});

addPos({
  name: "LOOKUPVALUE inside SUMX when relationship exists",
  input: "FX Amount = SUMX(FactGL, FactGL[Amount] * LOOKUPVALUE(DimExchange[Rate], DimExchange[Currency], FactGL[Currency]))",
  expected_issue: "adv-perf-073: LOOKUPVALUE inside SUMX — add relationship and use RELATED instead",
  expected_fix: "SUMX(FactGL, FactGL[Amount] * RELATED(DimExchange[Rate]))"
});

addPos({
  name: "CONCATENATEX without ORDERBY — nondeterministic list",
  input: "Manager Names = CONCATENATEX(FILTER(DimEmployee, DimEmployee[IsManager] = TRUE()), DimEmployee[FullName], \", \")",
  expected_issue: "adv-cor-007: CONCATENATEX without ORDERBY — name order varies between queries",
  expected_fix: "CONCATENATEX(FILTER(DimEmployee, DimEmployee[IsManager] = TRUE()), DimEmployee[FullName], \", \", DimEmployee[FullName], ASC)"
});

// ── 6. Additional negative cases from all domains' valid measures ─────────────

const moreCorrct = [
  { name: "Correct SAMEPERIODLASTYEAR usage", input: "Sales PY = CALCULATE([Total Sales], SAMEPERIODLASTYEAR(DimDate[Date]))", notes: "Correct time intelligence function" },
  { name: "Correct DIVIDE usage", input: "Gross Margin % = DIVIDE([Gross Profit], [Revenue])", notes: "DIVIDE handles zero denominator" },
  { name: "Correct DATESYTD usage", input: "Sales YTD = CALCULATE([Total Sales], DATESYTD(DimDate[Date]))", notes: "Date argument from marked Date table" },
  { name: "Correct IN operator filter", input: "EU Revenue = CALCULATE([Revenue], DimTerritory[Region] IN {\"DE\",\"FR\",\"UK\"})", notes: "Uses IN instead of chained OR" },
  { name: "Correct CALCULATE with column filter", input: "Active Accounts = CALCULATE([MRR], FactSubscriptions[Status] = \"Active\")", notes: "Direct column filter, no FILTER(ALL())" },
  { name: "Correct USERPRINCIPALNAME in RLS", input: "[RLS] = LOWER(DimEmployee[Email]) = LOWER(USERPRINCIPALNAME())", notes: "Case-insensitive UPN comparison" },
  { name: "Correct TOPN with tiebreaker", input: "Top 5 = CALCULATE([Revenue], TOPN(5, ALL(DimCustomer), [Revenue], DESC, DimCustomer[CustomerKey], ASC))", notes: "Tiebreaker column prevents nondeterminism" },
  { name: "Correct CONCATENATEX with ORDERBY", input: "Regions = CONCATENATEX(VALUES(DimTerritory[Region]), DimTerritory[Region], \", \", DimTerritory[Region], ASC)", notes: "Deterministic order" },
  { name: "Correct CALCULATE with COUNTROWS and filter", input: "Churned Count = CALCULATE(COUNTROWS(FactSubscriptions), FactSubscriptions[Status] = \"Churned\")", notes: "Preferred over COUNTROWS(FILTER(...))" },
  { name: "Correct USERELATIONSHIP for inactive path", input: "Dest Shipments = CALCULATE(COUNTROWS(FactShipments), USERELATIONSHIP(FactShipments[DestinationKey], DimLocation[LocationKey]))", notes: "Correctly activates inactive relationship" },
  { name: "Correct snapshot fact with LASTDATE", input: "Current Stock = CALCULATE(SUM(FactInventory[OnHandQty]), LASTDATE(DimDate[Date]))", notes: "Snapshot fact filtered to single date" },
  { name: "Correct SWITCH with no duplicate cases", input: "Category Label = SWITCH(DimProduct[Tier], \"A\", \"Premium\", \"B\", \"Standard\", \"C\", \"Basic\", \"Unknown\")", notes: "All case values unique" }
];

moreCorrct.forEach(tc => addNeg({ ...tc, expected_issue: "none" }));

// ── Write output ──────────────────────────────────────────────────────────────

// Update rules_advanced.json
const updatedRules = existingRules.concat(newRules);
fs.writeFileSync(RULES, JSON.stringify(updatedRules, null, 2), "utf8");

// Update test_suite.json
suite.positive_cases = suite.positive_cases.concat(newPos);
suite.negative_cases = (suite.negative_cases || []).concat(newNeg);
suite.edge_cases     = (suite.edge_cases || []).concat(newEdge);
fs.writeFileSync(SUITE, JSON.stringify(suite, null, 2), "utf8");

// Summary
console.log("\n=== Synthetic Data Generator ===");
console.log(`  New rules added:          ${newRules.length}`);
console.log(`  New positive cases added: ${newPos.length}`);
console.log(`  New negative cases added: ${newNeg.length}`);
console.log(`  New edge cases added:     ${newEdge.length}`);
console.log(`\n  rules_advanced.json now has ${updatedRules.length} rules`);
console.log(`  test_suite.json: ${suite.positive_cases.length} pos / ${suite.negative_cases.length} neg / ${suite.edge_cases.length} edge`);
console.log("\nDone. Run: node scripts/testRunner.js\n");
