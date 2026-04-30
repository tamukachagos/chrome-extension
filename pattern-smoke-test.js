const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "src", "skills.js"), "utf8"), sandbox);

const engine = sandbox.window.PowerBISkillEngine;
const activeSkillIds = ["architect-mode", "dax-expert", "semantic-model", "performance"];

const tests = [
  ["Revenue = SUMX(Sales, Sales[Amount])", "SUMX over base column"],
  ['Sales Blue = CALCULATE(SUM(Sales[Amount]), FILTER(Sales, Sales[Color] = "Blue"))', "FILTER inside CALCULATE for simple equality"],
  ["Total Sales = CALCULATE(SUM(Sales[Amount]), ALL(Sales))", "Using ALL removes required filters"],
  ["Margin = (SUM(Sales[Revenue]) - SUM(Sales[Cost])) / SUM(Sales[Revenue])", "Repeated aggregation without VAR"],
  ["Order Count = COUNT(Sales)", "COUNT used on table instead of COUNTROWS"],
  ["Customers = COUNTROWS(DISTINCT(Sales[CustomerID]))", "Using DISTINCT instead of VALUES in aggregation"],
  ["Sales = CALCULATE(CALCULATE(SUM(Sales[Amount])))", "Nested CALCULATE calls"],
  ["Ratio = IF(SUM(Sales[A]) = 0, 0, SUM(Sales[B]) / SUM(Sales[A]))", "IF instead of DIVIDE"],
  ["Profit = Sales[Revenue] - Sales[Cost]", "Calculated column instead of measure"],
  ["Using bi-directional relationship between Sales and Products", "bi-directional relationship ambiguity"],
  ["Total = SUM(Sales[OrderID])", "SUM used on non-numeric column"],
  ['Sales = SUMX(FILTER(Sales, Sales[Region] = "US"), Sales[Amount])', "Iterator over FILTER for simple condition"],
  ['Sales = CALCULATE(SUM(Sales[Amount]), Sales[Category] = "A")', "Hardcoded values instead of dimension reference"],
  ["Rank = CALCULATE(COUNTROWS(Sales), FILTER(Sales, Sales[Amount] > EARLIER(Sales[Amount])))", "Using EARLIER in complex row operations"],
  ["Total = CALCULATE(SUM(Sales[Amount]), ALL(Sales)) remove filters", "Using ALL instead of REMOVEFILTERS"],
  ["Selected Product = VALUES(Product[Name])", "VALUES used where scalar expected"],
  ["Revenue = Sales[Amount]", "Missing aggregation in measure"],
  ['Sales = CALCULATE(SUM(Sales[Amount]), FILTER(Sales, Sales[Region] = "US")) keepfilters', "Using FILTER instead of KEEPFILTERS"],
  ['Sales = CALCULATE(SUM(Sales[Amount]), Sales[Region] = "US", Sales[Region] = "US")', "Redundant filters in CALCULATE"],
  ["Count = COUNTROWS(VALUES(Sales[OrderID]))", "Using COUNTROWS(VALUES()) instead of DISTINCTCOUNT"],
  ["YTD Sales = CALCULATE(SUM(Sales[Amount]), FILTER(ALL(Date), Date[Date] <= MAX(Date[Date])))", "Inefficient time intelligence using FILTER"],
  ["Selected Year = MAX(Date[Year])", "Using MAX instead of SELECTEDVALUE"],
  ['NewTable = SUMMARIZE(Sales, Sales[Region], "Total", SUM(Sales[Amount]))', "Using SUMMARIZE for aggregation instead of measure"],
  ['Table = ADDCOLUMNS(Sales, "Profit", Sales[Revenue] - Sales[Cost])', "Unnecessary ADDCOLUMNS for scalar calc"],
  ["Single flat table with repeated attributes", "non-star schema or repeated attributes in fact table"],
  ['Filtered Sales = CALCULATE(SUM(Sales[Amount]), ALL(Product))', "Incorrect filter context with CALCULATE and ALL"],
  ['Sales by Category = SUM(Sales[Amount])', "Missing relationship causing wrong results"],
  ['Ratio = SUM(Sales[Profit]) / SUM(Sales[Revenue])', "Manual division instead of DIVIDE"],
  ['Customer = DISTINCT(Sales[CustomerID])', "Incorrect DISTINCT usage for scalar"],
  ['Sales = CALCULATE(SUM(Sales[Amount]), Sales[Region] = "US", Sales[Region] = "EU")', "Multiple filters overriding unintentionally"],
  ['Sales = CALCULATE(SUM(Sales[Amount]), FILTER(Sales, Sales[Amount] > 100))', "Using FILTER incorrectly for scalar comparison"],
  ['calculated column Total = CALCULATE(SUM(Sales[Amount]))', "Missing context transition in calculated column"],
  ['Model with many-to-many between Sales and Products', "Ambiguous many-to-many relationship"],
  ['Sales YTD = CALCULATE(SUM(Sales[Amount]), FILTER(ALL(Date), Date[Date] <= TODAY()))', "Inefficient time intelligence using FILTER"],
  ['Total = SUMX(Sales, Sales[Amount])', "Using SUMX without row context need"],
  ['Sales = CALCULATE(SUM(Sales[Amount]))', "Using CALCULATE without filters repeatedly"],
  ['Flag = HASONEVALUE(Sales[Region])', "Using HASONEVALUE incorrectly"],
  ['Check = IF(Sales[Amount] = BLANK(), 0, 1)', "Incorrect logical comparison with BLANK"],
  ['Sales = CALCULATE(SUM(Sales[Amount]), Sales[Region] = "US" || Sales[Region] = "EU")', "Inefficient logical OR in CALCULATE"],
  ['Category = RELATED(Product[Category])', "Using RELATED without relationship"],
  ['Price = LOOKUPVALUE(Product[Price], Product[ID], Sales[ProductID])', "Using LOOKUPVALUE repeatedly in measure"],
  ['Total = CALCULATE(SUM(Sales[Amount]), ALLSELECTED(Sales))', "Using ALLSELECTED unnecessarily"],
  ['Measure = SUMX(VALUES(Sales[CustomerID]), [Total Sales])', "Using VALUES in row context repeatedly"],
  ['Sales = CALCULATE(SUM(Sales[Amount]), FILTER(Sales, TRUE()))', "Using FILTER on entire table unnecessarily"],
  ['Result = IF(A=1,"X",IF(A=2,"Y",IF(A=3,"Z","Other")))', "Complex nested IF instead of SWITCH"],
  ['Measure = SUMX(Sales, CALCULATE(SUM(Sales[Amount])))', "Repeated context transition in iterators"],
  ['Measure = COUNTROWS(VALUES(Sales[CustomerID])) + COUNTROWS(VALUES(Sales[CustomerID]))', "Using VALUES repeatedly in measure"],
  ['Table = CROSSJOIN(VALUES(Sales[Region]), VALUES(Product[Category]))', "Unnecessary CROSSJOIN usage"],
  ['Visual grouped by Sales[TransactionID]', "Large cardinality column used in grouping"]
];

function extractRule(output) {
  return JSON.parse(output.slice(output.indexOf("{"), output.indexOf("\n}\n") + 2));
}

let failures = 0;

for (const [prompt, expectedPattern] of tests) {
  const output = engine.composeDeterministicAnswer({
    prompt,
    context: {},
    knowledge: [],
    activeSkillIds
  }).text;
  const rule = extractRule(output);

  if (rule.pattern !== expectedPattern || rule.requires_llm !== false) {
    failures += 1;
    console.error(`FAIL: ${expectedPattern}`);
    console.error(`  got: ${rule.pattern}`);
    console.error(`  requires_llm: ${rule.requires_llm}`);
  }
}

if (failures) {
  process.exitCode = 1;
} else {
  console.log(`PASS: ${tests.length} deterministic patterns`);
}
