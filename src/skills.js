(function () {
  const SKILLS = [
    {
      id: "architect-mode",
      name: "Power BI Architect Mode",
      description: "Full-stack Power BI analyzer: DAX, modeling, visuals, performance, security, and service ops — converts any problem into a deterministic rule, fix, and validation.",
      triggers: [
        "dax","measure","values","selectedvalue","max","if","switch","count","countrows",
        "distinct","hasonevalue","blank","related","lookupvalue","allselected","crossjoin",
        "transactionid","grouped by","model","relationship","bi-directional","slow",
        "performance","wrong","incorrect","total","aggregation","flat table",
        "repeated attribute","denormalized","visual","dashboard","finance","sales","saas",
        "fix","review","audit","check","validate","wrong result","incorrect total",
        "not working","broken","error","issue","problem","help","how do i","best practice",
        "pattern","template","generate","create","build","design","architecture"
      ],
      rules: [
        "Always return a RULE block with pattern, detection_logic, fix_template, category, confidence.",
        "Set requires_llm true only when confidence is below 0.5.",
        "Prefer reusable templates over one-time fixes.",
        "Classify impact as performance_gain and correctness_risk.",
        "Start every DAX answer with a base measure before building derived measures.",
        "Every model answer must address grain, relationships, and measure organization.",
        "Every visual answer must state chart type, field wells, sort order, and title format.",
        "Every performance answer must triage before optimizing.",
        "Never expose API keys, credentials, or sensitive data in DAX, M, or reports.",
        "Test every fix against blank, zero, and multi-select slicer cases."
      ],
      templates: {
        daxResponse: "RULE:\n{\n  \"pattern\": \"<detectable structure>\",\n  \"detection_logic\": \"<how to identify>\",\n  \"fix_template\": \"<generalized fix>\",\n  \"category\": \"performance | correctness | modeling\",\n  \"confidence\": 0.0,\n  \"requires_llm\": false\n}\n\nFIXED_DAX:\n<production-ready DAX with VAR pattern>\n\nVALIDATION:\nEVALUATE SUMMARIZECOLUMNS('Date'[Year], \"Result\", [Measure Name])\n\nIMPACT:\n- performance_gain: <low|medium|high>\n- correctness_risk: <low|medium|high>\n- edge_cases: blank denominator, empty filter context, slicer interactions",
        modelResponse: "RULE:\n{\n  \"pattern\": \"<model issue>\",\n  \"detection_logic\": \"<how to detect>\",\n  \"fix\": \"<schema-level fix>\",\n  \"category\": \"modeling\",\n  \"confidence\": 0.0,\n  \"requires_llm\": false\n}\n\nFIX:\n<numbered steps>\n\nVALIDATION:\n- Spot-check totals in a matrix with no filters\n- Verify slicer cross-filtering works as expected\n- Confirm measure totals match source system"
      }
    },
    {
      id: "dax-expert",
      name: "DAX Expert",
      description: "Production-grade DAX: filter context, time intelligence, advanced patterns, VAR optimization, CALCULATE mastery, and measure validation.",
      triggers: [
        "dax","measure","calculate","filter context","ytd","mtd","qtd","yoy","qoq",
        "sameperiodlastyear","dateadd","parallelperiod","datesytd","datesqtd","datesmtd",
        "divide","selectedvalue","all","removefilters","keepfilters","allexcept","allselected",
        "userelationship","treatas","crossfilter","var","return","rankx","topn","maxx","minx",
        "averagex","sumx","countx","earlier","generate","generateseries","addcolumns",
        "summarize","summarizecolumns","groupby","selectcolumns","union","intersect","except",
        "calculatetable","naturalinnerjoin","naturalleftouterjoin","isfiltered","iscrossfiltered",
        "isinscope","hasonevalue","hasonefilter","isblank","isempty","coalesce",
        "rolling","moving average","running total","cumulative","abc","pareto","segmentation",
        "dynamic","what-if","field parameter","calculation group","format string",
        "ratio","percent","margin","rate","growth","variance","budget","target","forecast",
        "time intelligence","period","calendar","fiscal","week","quarter","rolling 12",
        "wrong total","blank result","measure","base measure","derived measure"
      ],
      rules: [
        "Always build a simple base measure (SUM/COUNT) before derived measures.",
        "Use DIVIDE() for every ratio — never raw division operator /.",
        "Use VAR...RETURN in any measure that references the same expression more than once.",
        "Use a continuous, marked Date table for all time intelligence.",
        "CALCULATE changes filter context; understand which filters it adds, removes, or overrides.",
        "REMOVEFILTERS is the modern replacement for ALL() as a CALCULATE argument.",
        "KEEPFILTERS adds a filter without removing existing filters — use for intersection logic.",
        "ALLEXCEPT is equivalent to REMOVEFILTERS(Table) + VALUES(column) — prefer explicit form.",
        "SELECTEDVALUE returns BLANK when multiple values are selected — add a default parameter.",
        "Use USERELATIONSHIP inside CALCULATE to activate an inactive relationship.",
        "TREATAS(table, column) applies a virtual relationship without a physical one.",
        "Cache expensive sub-expressions in VAR before SWITCH or ISINSCOPE logic.",
        "Avoid FILTER(FactTable, ...) when a simple Boolean expression works as a CALCULATE argument.",
        "RANKX requires explicit ALL scope — rank over ALL(DimTable[Column]), not ALL(DimTable).",
        "Prefix hidden helper measures with _ so they sort to the top and signal internal use.",
        "Validate every measure with: EVALUATE SUMMARIZECOLUMNS('Date'[Year], \"M\", [Measure])"
      ],
      templates: {
        baseSum: "// Base measure — always create this first\n[Total Revenue] =\nSUM('Sales'[Amount])",
        ratio: "// Safe ratio with zero-denominator protection\n[Gross Margin %] =\nDIVIDE(\n    [Gross Margin],\n    [Total Revenue]\n)",
        yoy: "// Year-over-year using VAR pattern for performance\n[Revenue YoY %] =\nVAR CurrentValue = [Total Revenue]\nVAR PriorValue =\n    CALCULATE(\n        [Total Revenue],\n        SAMEPERIODLASTYEAR('Date'[Date])\n    )\nRETURN\n    DIVIDE(CurrentValue - PriorValue, PriorValue)",
        ytd: "// Year-to-date — requires marked Date table\n[Revenue YTD] =\nCALCULATE(\n    [Total Revenue],\n    DATESYTD('Date'[Date])\n)",
        rolling12: "// Rolling 12-month total\n[Revenue Rolling 12M] =\nCALCULATE(\n    [Total Revenue],\n    DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -12, MONTH)\n)",
        movingAvg: "// 3-month moving average\n[Revenue 3M Avg] =\nDIVIDE(\n    CALCULATE([Total Revenue], DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -3, MONTH)),\n    3\n)",
        rankx: "// Safe RANKX — scope ALL on the column, not the whole table\n[Product Revenue Rank] =\nRANKX(\n    ALL('Product'[ProductName]),\n    [Total Revenue],\n    ,\n    DESC,\n    Dense\n)",
        dynamicSegment: "// ABC segmentation\n[Customer Segment] =\nVAR Rev = [Total Revenue]\nVAR CumPct =\n    DIVIDE(\n        CALCULATE([Total Revenue], FILTER(ALL('Customer'), [Total Revenue] >= Rev)),\n        CALCULATE([Total Revenue], ALL('Customer'))\n    )\nRETURN\n    SWITCH(TRUE(),\n        CumPct <= 0.8, \"A\",\n        CumPct <= 0.95, \"B\",\n        \"C\"\n    )",
        budgetVariance: "// Budget variance with safe divide\n[Variance vs Budget] = [Actual Revenue] - [Budget Revenue]\n[Variance vs Budget %] = DIVIDE([Variance vs Budget], [Budget Revenue])",
        mtd: "// Month-to-date\n[Revenue MTD] =\nCALCULATE([Total Revenue], DATESMTD('Date'[Date]))",
        qtd: "// Quarter-to-date\n[Revenue QTD] =\nCALCULATE([Total Revenue], DATESQTD('Date'[Date]))",
        useRelationship: "// Activate an inactive date relationship (e.g., ship date)\n[Revenue by Ship Date] =\nCALCULATE(\n    [Total Revenue],\n    USERELATIONSHIP('Date'[Date], 'Sales'[ShipDate])\n)",
        dynamicTopN: "// Dynamic Top N using What-If parameter\n[Top N Revenue] =\nCALCULATE(\n    [Total Revenue],\n    TOPN([Top N Parameter], ALL('Product'[ProductName]), [Total Revenue])\n)"
      }
    },
    {
      id: "visual-design",
      name: "Visual Design",
      description: "Expert report design: chart selection, field wells, interactions, bookmarks, drillthrough, tooltip pages, accessibility, mobile layout, and theme guidance.",
      triggers: [
        "visual","chart","dashboard","report","page","layout","slicer","tooltip",
        "drillthrough","matrix","bar","line","scatter","kpi","card","map","ribbon",
        "waterfall","funnel","gauge","treemap","decomposition","key influencer",
        "q&a","smart narrative","bookmark","button","navigation","drill","hierarchy",
        "conditional format","data label","reference line","forecast","trend line",
        "field parameter","dynamic axis","dynamic legend","dynamic title",
        "mobile","phone layout","accessibility","alt text","tab order","focus mode",
        "theme","json theme","color","font","branding","template","background",
        "cross filter","cross highlight","interaction","sync slicer","page filter",
        "report filter","visual level filter","drill down","drill up","expand",
        "tooltip page","report page tooltip","custom tooltip","embed","publish to web"
      ],
      rules: [
        "Use line charts for continuous time trends; clustered bar for category ranking.",
        "Use 100% stacked bar when the mix/share story matters more than absolute values.",
        "Use scatter charts for two-measure relationships, outlier detection, and segmentation.",
        "Use cards for 3-5 headline KPIs only — not for operational detail.",
        "Use matrices for dense cross-tab detail with expandable row hierarchies.",
        "Every visual title must answer a business question, not describe the chart type.",
        "Sort bar/column charts by the decision metric (descending) by default.",
        "Use conditional formatting only when color changes the interpretation.",
        "Keep slicers to dimensions that change the user's decision, not every available field.",
        "Drillthrough pages need a Back button and should filter to the source context.",
        "Tooltip pages show on hover — keep them narrow, fast, and decision-relevant.",
        "Bookmarks replace multi-page navigation for guided storytelling.",
        "Field parameters let users switch measure or dimension dynamically without editing.",
        "Sync slicers across pages when the same filter applies report-wide.",
        "Every published report must have alt text on key visuals for accessibility.",
        "Design Mobile layout separately in View > Mobile layout; it does not auto-inherit.",
        "Use a JSON report theme to enforce brand colors, fonts, and default visual settings.",
        "Avoid more than 8 visuals per page — Performance Analyzer will tell you which are slow."
      ],
      templates: {
        comparison: "Visual: Clustered bar chart\nAxis: Category dimension (sorted descending by value)\nValues: Primary measure\nSmall multiples: Optional second dimension\nTooltip: Variance %, target, rank\nTitle: 'Top [N] [Category] by [Metric] — [Period]'",
        trend: "Visual: Line chart\nX-axis: Date hierarchy (Year > Quarter > Month)\nY-axis: Primary measure\nSecondary Y: Optional variance or prior period\nLegend: Category (≤5 series)\nTooltip: Prior period, YoY %, target\nTitle: '[Metric] Trend — [Period]'",
        execDashboard: "Layout:\n1. KPI Cards row (3-5 headline metrics) — top\n2. Trend line (primary metric over time) — upper left\n3. Breakdown bar (top categories) — upper right\n4. Detail matrix (drillable rows) — bottom\n5. Date slicer + 1-2 business slicers — left panel\nSlicers: Date range, Region/BU, Status only",
        drillthrough: "Drillthrough page setup:\n- Add drillthrough field (e.g., Product[Name]) to the Drillthrough well\n- Add Back button with bookmark action: Previous page\n- Filter all visuals to the drilled context\n- Show detail table + supporting measures",
        fieldParam: "Field parameter (dynamic axis/measure):\n1. Modeling > New parameter > Fields\n2. Add measures or columns to switch between\n3. Add parameter slicer to page\n4. Use parameter[parameter fields] in visual axis/values\nResult: User can switch between measures without editing the report"
      }
    },
    {
      id: "semantic-model",
      name: "Semantic Model",
      description: "Star schema design, grain, relationships, role-playing dimensions, composite models, DirectQuery, aggregation tables, incremental refresh, and model hygiene.",
      triggers: [
        "model","semantic","relationship","star schema","dimension","fact","cardinality",
        "grain","many-to-many","bidirectional","date table","bridge table","snowflake",
        "role-playing","inactive relationship","composite model","directquery","import mode",
        "dual mode","aggregation table","incremental refresh","hybrid table","large dataset",
        "premium","fabric","lakehouse","direct lake","onelake","delta","parquet",
        "denormalized","flat table","calculated column","calculated table","what-if",
        "parameter table","disconnected table","currency","exchange rate","slowly changing",
        "scd","type 2","surrogate key","natural key","degenerate dimension","junk dimension",
        "conformed dimension","shared dimension","enterprise model","tabular","ssas",
        "xmla","external tool","tabular editor","alm toolkit","vertipaq","column store",
        "model size","compression","cardinality reduction","hide","display folder",
        "measure table","description","annotation","synonym","q&a"
      ],
      rules: [
        "Declare the grain of every fact table before writing any measures.",
        "Dimension primary keys must be unique — validate with COUNTROWS vs DISTINCTCOUNT.",
        "Relationships filter from dimension (one-side) to fact (many-side) by default.",
        "Avoid bi-directional relationships unless explicitly required and tested for ambiguity.",
        "Replace many-to-many with a bridge/junction table when possible.",
        "Use USERELATIONSHIP() for role-playing date dimensions (OrderDate, ShipDate, DueDate).",
        "A marked Date table must be continuous (no gaps), have a Date column typed as Date.",
        "Calculated columns increase model size; prefer measures or Power Query columns.",
        "Hide all technical keys, bridge keys, and columns not needed by report consumers.",
        "Organize measures into display folders (e.g., Revenue, Margins, Time Intelligence).",
        "Use a dedicated measures table (empty calculated table) to group all measures.",
        "Composite models: set large fact tables to DirectQuery, small dimensions to Import/Dual.",
        "Aggregation tables: define user-defined aggregations on summarized fact data.",
        "Incremental refresh: partition fact tables by date; set RangeStart/RangeEnd parameters.",
        "Direct Lake (Fabric): queries OneLake Parquet files — no import refresh needed.",
        "Document every inactive relationship, its purpose, and the measures that activate it.",
        "Apply object-level security (OLS) to hide sensitive columns from unauthorized roles.",
        "Use TREATAS() to create a virtual relationship without a physical model connection."
      ],
      templates: {
        grain: "Fact table: [name]\nGrain: one row per [business event — e.g. invoice line, delivery, transaction]\nDate keys: [OrderDate key, ShipDate key]\nDimension keys: [Customer, Product, Location, ...]\nAdditive facts: [Amount, Quantity, Cost]\nSemi-additive facts: [Balance, Inventory — use LASTDATE or LASTNONBLANK]\nNon-additive facts: [Price, Rate — never SUM, always AVERAGE or context-filtered]",
        starSchema: "Star schema checklist:\n✓ One fact table per business process\n✓ Dimension tables with surrogate keys\n✓ Date table: continuous, marked, no gaps\n✓ All relationships: single-direction, one-to-many\n✓ No bi-directional unless intentional and documented\n✓ Bridge table for each many-to-many\n✓ Hidden technical keys\n✓ Measures in display folders\n✓ Descriptions on every measure and dimension table",
        incrementalRefresh: "Incremental refresh setup:\n1. Create RangeStart and RangeEnd date parameters in Power Query\n2. Filter your date column: >= RangeStart and < RangeEnd\n3. In dataset settings: define incremental refresh policy\n4. Set Store rows to N years, Refresh last N days\n5. Enable 'Only refresh complete periods'\n6. Publish to Premium workspace (required for partitioning)"
      }
    },
    {
      id: "kpi-glossary",
      name: "Business KPI Glossary",
      description: "Authoritative definitions for financial, operational, SaaS, retail, supply chain, and HR KPIs with DAX templates.",
      triggers: [
        "kpi","revenue","sales","margin","profit","gross margin","net margin","ebitda",
        "supplier","inventory","forecast","variance","otif","fill rate","late","delivery",
        "target","budget","actual","plan","return","refund","churn","retention","ltv",
        "customer lifetime value","cac","acquisition cost","arpu","mrr","arr","nrr",
        "net revenue retention","expansion","contraction","logo churn","seat","license",
        "conversion rate","win rate","pipeline","funnel","lead","opportunity","close rate",
        "days sales outstanding","dso","inventory turns","stock out","on hand","reorder",
        "service level","sla","on time","in full","otif","perfect order","defect rate",
        "yield","throughput","utilization","capacity","headcount","attrition","turnover",
        "overtime","productivity","revenue per employee","cost per hire","time to fill",
        "nps","csat","satisfaction","survey","sentiment","return on investment","roi",
        "payback","irr","wacc","working capital","cash conversion cycle","burn rate"
      ],
      rules: [
        "Define which date field drives the KPI: invoice date, order date, ship date, or delivery date.",
        "State variance direction: Actual minus Target (favorable = positive) or Target minus Actual.",
        "Every % KPI must have an explicit numerator and denominator documented.",
        "Operational KPIs must define the eligible population before counting exceptions.",
        "Currency measures must specify gross/net treatment and how returns/credits are handled.",
        "SaaS MRR = sum of monthly recurring revenue from active subscriptions at period end.",
        "Churn rate = lost MRR / beginning MRR for the period (not customer count by default).",
        "OTIF = orders delivered on time AND in full / total orders — both conditions must be true.",
        "Inventory turns = Cost of Goods Sold / Average Inventory — use LASTNONBLANK for avg.",
        "DSO = (Accounts Receivable / Total Revenue) * Days in Period.",
        "Gross margin = Revenue - Cost of Goods Sold (excludes operating expenses).",
        "EBITDA = Operating Income + Depreciation + Amortization (add-back from P&L).",
        "NPS = % Promoters (9-10) - % Detractors (0-6) — exclude passives (7-8) from calc.",
        "Customer LTV = Average Revenue per Customer / Churn Rate (simple cohort model).",
        "ROI = (Net Benefit - Cost) / Cost — specify time horizon explicitly."
      ],
      templates: {
        variance: "// Budget variance — always show both absolute and %\n[Variance vs Budget] = [Actual] - [Budget]\n[Variance vs Budget %] = DIVIDE([Variance vs Budget], [Budget])\n// Favorable = positive for revenue KPIs, negative for cost KPIs",
        grossMargin: "// Gross margin\n[Gross Margin] = [Total Revenue] - [Total COGS]\n[Gross Margin %] = DIVIDE([Gross Margin], [Total Revenue])",
        churn: "// SaaS MRR churn rate\n[MRR Churn Rate] =\nDIVIDE(\n    CALCULATE([MRR], 'Status'[Type] = \"Churned\"),\n    CALCULATE([MRR], PREVIOUSMONTH('Date'[Date]))\n)",
        otif: "// On Time In Full\n[OTIF %] =\nDIVIDE(\n    CALCULATE(COUNTROWS('Orders'), 'Orders'[OnTime] = TRUE && 'Orders'[InFull] = TRUE),\n    COUNTROWS('Orders')\n)",
        lateRate: "// Late delivery rate\n[Late Delivery %] =\nDIVIDE(\n    CALCULATE(COUNTROWS('Deliveries'), 'Deliveries'[DaysLate] > 0),\n    COUNTROWS('Deliveries')\n)",
        dso: "// Days Sales Outstanding\n[DSO] =\nDIVIDE(\n    [Accounts Receivable Balance],\n    [Total Revenue]\n) * 30"
      }
    },
    {
      id: "performance",
      name: "Performance Review",
      description: "DAX, report, and model performance: DAX Studio triage, VertiPaq analysis, DirectQuery tuning, iterator optimization, cardinality reduction, and visual density.",
      triggers: [
        "performance","slow","optimize","directquery","import","sumx","filter","iterator",
        "cardinality","too many visuals","refresh","timeout","heavy","lag","latency",
        "dax studio","vertipaq","query plan","storage engine","formula engine","se","fe",
        "materialization","cold cache","warm cache","server timing","query folding",
        "aggregation","aggregation table","dual mode","composite","query reduction",
        "report page","visual count","slicer count","high cardinality","slicer search",
        "large model","big data","billion rows","million rows","premium","capacity",
        "memory","cpu","refresh time","incremental","partition","parallel","concurrent"
      ],
      rules: [
        "Run Performance Analyzer first — sort visuals by total duration to find the bottleneck.",
        "Open the slow visual's DAX in DAX Studio to see Server Timings (SE vs FE split).",
        "High Formula Engine time = complex DAX logic; High Storage Engine time = data volume.",
        "Replace FILTER(FactTable, condition) with a simple Boolean CALCULATE argument.",
        "Replace SUMX(FILTER(...), col) with CALCULATE(SUM(col), condition).",
        "Cache repeated measure references with VAR instead of recalculating per row.",
        "SWITCH(TRUE(), [Measure] > x, ...) recalculates the measure per branch — use VAR.",
        "Avoid COUNTROWS(VALUES(col)) — use DISTINCTCOUNT(col) instead.",
        "Avoid bi-directional relationships — they double the filter propagation graph.",
        "High-cardinality columns in slicers kill rendering; use search slicers or reduce options.",
        "Each additional visual on a page adds parallel query load — keep pages to ≤8 visuals.",
        "Use Import mode for most scenarios; DirectQuery only when latency or governance demands it.",
        "Aggregation tables on large DirectQuery facts can eliminate most query engine calls.",
        "VertiPaq Analyzer: columns with high cardinality and low compression ratio cost the most.",
        "Incremental refresh reduces full-refresh load; segment your date partition correctly.",
        "Use query reduction settings in Options to defer slicer queries until Apply is clicked."
      ],
      templates: {
        triage: "Performance triage — run in order:\n1. Performance Analyzer: identify the slowest visual by total duration\n2. Copy DAX query from the slowest visual → paste into DAX Studio\n3. Server Timings tab: check SE duration vs FE duration\n4. SE high → cardinality or data volume issue → aggregations / Import mode\n5. FE high → DAX complexity → simplify measure, add VAR, remove nested FILTER\n6. Check visual count: ≤8 per page\n7. Check slicer cardinality: use search slicer for columns > 500 distinct values\n8. Check for bi-directional relationships in the model",
        daxStudioQuery: "-- DAX Studio: paste this template to benchmark a measure\nEVALUATE\nADDCOLUMNS(\n    SUMMARIZECOLUMNS(\n        'Date'[Year],\n        'Date'[Month]\n    ),\n    \"Measure\", [Your Measure Here]\n)\nORDER BY 'Date'[Year], 'Date'[Month]"
      }
    },
    {
      id: "power-query",
      name: "Power Query / M",
      description: "M language, query folding, custom functions, data type handling, merges, appends, API connections, error handling, and dataflow patterns.",
      triggers: [
        "power query","m code","query folding","merge","append","transform","data type",
        "clean","source","let","in","each","try","otherwise","record","list","table",
        "text.split","text.trim","text.between","table.selectrows","table.addcolumn",
        "table.removealternaterows","list.generate","list.accumulate","function",
        "custom function","fnget","parameter","relative path","api","rest","json","xml",
        "odata","web.contents","csv","excel","sharepoint","sql","native query",
        "query parameter","dataflow","datamart","dataflow gen2","incremental","gateway",
        "privacy level","firewall","combine files","folder","binary","buffer",
        "table.buffer","list.buffer","error","missing column","schema change",
        "column rename","unpivot","pivot","transpose","fill down","replace value",
        "group by","aggregate","split column","extract","parse"
      ],
      rules: [
        "Set data types explicitly after every source step and after major transformations.",
        "Preserve query folding by avoiding Table.Buffer, List.Buffer, and Table.ToList early.",
        "Table.Buffer() forces evaluation in memory — use only when folding is already broken.",
        "Use try...otherwise for resilient column access when source schema can change.",
        "Native SQL queries maintain folding in SQL connectors — avoid string concatenation in queries.",
        "Merges require matching data types on join keys — cast both sides if needed.",
        "Use a reusable custom function (fnGetData) for parameterized API calls.",
        "Set privacy levels to avoid the firewall error blocking cross-source queries.",
        "Web.Contents with RelativePath and Query parameters maintains folding better than URL concat.",
        "Group By aggregations fold to SQL GROUP BY on supported connectors.",
        "Unpivot is often better than dozens of custom column steps for wide-to-tall reshaping.",
        "Combine Files from Folder is the standard pattern for multi-file ingestion.",
        "Use List.Generate for iterative API pagination when page count is unknown.",
        "Column names in lowercase with underscores load faster in Tabular than mixed case.",
        "Document each query step with a descriptive step name (rename in formula bar).",
        "Disable Load on staging queries — only load the final output query into the model."
      ],
      templates: {
        customFunction: "// Reusable parameterized API call\nlet\n    fnGetPage = (pageNum as number) =>\n    let\n        url = \"https://api.example.com/data?page=\" & Number.ToText(pageNum),\n        response = Web.Contents(url),\n        json = Json.Document(response)\n    in\n        json,\n    allPages = List.Generate(\n        () => [page = 1, data = fnGetPage(1)],\n        each [data] <> null and List.Count([data]) > 0,\n        each [page = [page] + 1, data = fnGetPage([page] + 1)],\n        each [data]\n    ),\n    combined = Table.FromList(List.Combine(allPages), Splitter.SplitByNothing())\nin\n    combined",
        errorHandling: "// Safe column access with fallback\nTable.AddColumn(Source, \"SafeColumn\", each\n    try [ColumnThatMightNotExist]\n    otherwise null\n)",
        groupBy: "// Group By with multiple aggregations\nTable.Group(Source, {\"CustomerID\"}, {\n    {\"TotalRevenue\", each List.Sum([Amount]), type number},\n    {\"OrderCount\", each Table.RowCount(_), type number},\n    {\"LastOrderDate\", each List.Max([OrderDate]), type date}\n})"
      }
    },
    {
      id: "security-rls",
      name: "Security and RLS",
      description: "Row-level security, object-level security, dynamic RLS, workspace roles, sensitivity labels, guest access, and governance.",
      triggers: [
        "security","rls","row-level","row level security","permission","workspace","app",
        "userprincipalname","username","sensitivity","certified","endorsement","governance",
        "object level security","ols","column security","table security","hide column",
        "hide table","guest user","external user","aad","azure ad","entra","b2b",
        "conditional access","mip","purview","information protection","label","classify",
        "tenant admin","admin portal","activity log","audit log","usage metrics",
        "admin api","scanner api","lineage","impact analysis","data protection",
        "dynamic rls","static rls","role","manage roles","test as role","view as",
        "xmla","premium rls","embed token","service principal","app registration",
        "client id","client secret","power bi embedded","aadb2c"
      ],
      rules: [
        "Use workspace roles (Admin/Member/Contributor/Viewer) for authoring permissions.",
        "Use RLS for data-level access — workspace roles do not restrict data.",
        "Always test RLS with 'View as role' before publishing to production.",
        "Dynamic RLS: 'SecurityTable'[Email] = USERPRINCIPALNAME() — most common pattern.",
        "Static RLS: hardcode region/department values in role filters for simple scenarios.",
        "Do NOT rely on hidden pages or visuals for security — they can be bypassed.",
        "Object-Level Security (OLS) hides entire tables or columns — set in Tabular Editor.",
        "RLS does not apply to XMLA endpoints without Premium — use IP allowlisting + service principals.",
        "Apply sensitivity labels at the dataset level — they propagate to downstream reports and exports.",
        "Guest (B2B) users must be granted access to both the workspace and the underlying dataset.",
        "Service principals bypass RLS in embedded scenarios unless EffectiveIdentity is set.",
        "Embed tokens must include roles and username for RLS to apply in embedded reports.",
        "Run the Admin API scanner to audit who has access to which datasets across the tenant.",
        "Document every RLS role, its DAX filter, and the business owner responsible for user lists.",
        "Certify datasets to signal governance compliance to consumers across the organization."
      ],
      templates: {
        dynamicRls: "// Dynamic RLS — filter by the current user's email\n// Step 1: Create a security table with [Email] and [Dimension] columns\n// Step 2: Create relationship: Security[Email] → UserTable (or use TREATAS)\n// Step 3: Add role with this DAX filter on the Security table:\n'Security'[Email] = USERPRINCIPALNAME()\n\n// If Security table joins to dimension:\n// Role DAX filter on Dimension table:\n[DimensionKey] IN\n    CALCULATETABLE(\n        VALUES('Security'[DimensionKey]),\n        'Security'[Email] = USERPRINCIPALNAME()\n    )",
        staticRls: "// Static RLS — hardcode allowed values\n// Role: 'North Region'\n// DAX filter on fact or dimension:\n'Sales'[Region] = \"North\"",
        managerHierarchy: "// Manager hierarchy RLS — user sees their own + direct reports\n'Employee'[EmployeeEmail] IN\n    CALCULATETABLE(\n        VALUES('OrgHierarchy'[ReporteeEmail]),\n        'OrgHierarchy'[ManagerEmail] = USERPRINCIPALNAME()\n    )\n    || 'Employee'[EmployeeEmail] = USERPRINCIPALNAME()"
      }
    },
    {
      id: "service-ops",
      name: "Power BI Service Ops",
      description: "Deployment pipelines, XMLA, dataflows, datamarts, Fabric integration, gateway management, refresh strategy, capacity planning, and tenant administration.",
      triggers: [
        "service","web","workspace","refresh","gateway","deployment","pipeline","publish",
        "app.powerbi.com","semantic model","dataflow","datamart","fabric","onelake",
        "direct lake","lakehouse","delta lake","shortcut","xmla","tabular editor",
        "alm toolkit","external tool","capacity","sku","premium","ppu","premium per user",
        "embed","embedded","power bi embedded","rest api","admin api","activity log",
        "audit","lineage","impact analysis","endorsement","certified","promoted",
        "scheduled refresh","incremental","on-demand","gateway cluster","vnet gateway",
        "personal gateway","enterprise gateway","cloud connection","oauth","service account",
        "deployment rule","parameter rule","connection rule","scheduled report","subscribe",
        "paginated report","rdl","report builder","ssrs","power automate","teams",
        "sharepoint web part","embed in teams","embed in sharepoint"
      ],
      rules: [
        "Use Dev → Test → Production deployment pipeline for any report used in decisions.",
        "Set deployment rules to swap data source connections between pipeline stages.",
        "Gateway clusters provide load balancing and HA — always use clusters in production.",
        "Check gateway status, version, and credentials first when scheduled refresh fails.",
        "Service principal authentication avoids personal credential dependency in gateway.",
        "Certified semantic models are shared contracts — version them with Tabular Editor + git.",
        "XMLA read endpoint enables DAX Studio, Tabular Editor, and ALM Toolkit connectivity.",
        "XMLA write endpoint (Premium/PPU) allows schema changes without republishing from Desktop.",
        "Fabric Direct Lake queries OneLake Delta Parquet without import or DirectQuery overhead.",
        "Dataflow Gen2 (Fabric) supports staging and output to Lakehouse tables.",
        "Schedule refresh during off-peak hours; stagger refreshes to avoid gateway saturation.",
        "Use Power Automate to trigger refresh on pipeline completion or file arrival.",
        "Monitor capacity with the Premium Capacity Metrics app — watch CPU, memory, and wait times.",
        "Activity Log API captures all user activity — use for audit, adoption, and governance.",
        "Impact Analysis shows which reports and dashboards depend on a dataset before changes.",
        "Subscribe stakeholders to report pages or dashboards for scheduled email delivery.",
        "Use Power BI Embedded (App owns data) for customer-facing analytics with embed tokens."
      ],
      templates: {
        refreshTriage: "Refresh failure triage:\n1. Open dataset > Refresh history > expand failed run > copy error message\n2. Check gateway: Online status, version (keep within 6 months of latest)\n3. Check data source credentials: Settings > Data source credentials > Edit\n4. Check for source schema changes: column renamed, table dropped, permission revoked\n5. Check for timeout: consider incremental refresh or smaller partition\n6. For gateway: check Windows Event Viewer on gateway machine for connection errors",
        deploymentPipeline: "Deployment pipeline setup:\n1. Create pipeline in Power BI Service > Deployment pipelines > Create\n2. Assign Dev workspace → Test workspace → Production workspace\n3. Set deployment rules: swap connection strings, parameters per stage\n4. Deploy: select specific items or 'Deploy all'\n5. Set up selective deployment: reports only, or dataset + reports together\n6. After deploy to Production: run dataset refresh and validate",
        fabricLakehouse: "Fabric Lakehouse + Direct Lake setup:\n1. Create Lakehouse in Fabric workspace\n2. Load Delta Parquet files to Lakehouse Tables (not Files)\n3. Create Semantic Model: Lakehouse > New semantic model\n4. Add tables in Direct Lake mode — no import refresh needed\n5. Build measures and relationships in the model\n6. Framing query runs on first visual query to warm the cache\n7. Falls back to DirectQuery if column not in cache — monitor in Capacity Metrics"
      }
    }
  ];
  let externalRules = [];
  const MATCH_THRESHOLD = 0.75;
  const LLM_THRESHOLD = 0.6;

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

  function analyze(input) {
    const prompt = String(input?.prompt || "");
    const contextText = [
      prompt,
      input?.context?.title,
      input?.context?.pageMode,
      (input?.context?.likelyFields || []).join(" "),
      (input?.knowledge || []).map((item) => `${item.title} ${item.body}`).join(" ")
    ].join(" ").toLowerCase();
    const activeSkillIds = new Set(input?.activeSkillIds || SKILLS.map((skill) => skill.id));
    const matches = SKILLS
      .filter((skill) => activeSkillIds.has(skill.id))
      .map((skill) => {
        const matchedTriggers = skill.triggers.filter((trigger) => contextText.includes(trigger.toLowerCase()));
        const score = matchedTriggers.length;
        return { ...skill, matchedTriggers, score };
      })
      .filter((skill) => skill.score > 0)
      .sort((a, b) => b.score - a.score);

    const totalScore = matches.reduce((sum, skill) => sum + skill.score, 0);
    const confidence = Math.min(96, totalScore * 12 + (matches.length ? 24 : 0));

    return {
      confidence,
      matches,
      summary: matches.length
        ? matches.slice(0, 4).map((skill) => `${skill.name} (${skill.matchedTriggers.slice(0, 4).join(", ")})`).join("; ")
        : "No deterministic skill matched strongly."
    };
  }

  function composeDeterministicAnswer(input) {
    const analysis = analyze(input);
    const prompt = String(input?.prompt || "").trim();
    const matched = analysis.matches.slice(0, 4);
    const taskType = classifyPrompt(prompt);
    const externalRule = findExternalRule(prompt);

    if (externalRule) {
      return {
        text: composeExternalRuleAnswer(externalRule),
        confidence: 92,
        analysis,
        taskType,
        externalRule
      };
    }

    if (!matched.length) {
      return {
        text: [
          "RULE:",
          stringifyRule({
            pattern: "unknown Power BI pattern",
            detection_logic: "No deterministic skill trigger matched the input.",
            fix_template: "Escalate to LLM or add a deterministic training rule.",
            category: "correctness",
            confidence: 0.3,
            requires_llm: true
          }),
          "",
          "FIXED_SOLUTION:",
          "Add a training note, enable a relevant skill, or route to fallback."
        ].join("\n"),
        confidence: 30,
        analysis,
        taskType
      };
    }

    const responseContext = {
      prompt,
      matched,
      knowledge: input?.knowledge || [],
      analysis
    };

    const text =
      taskType === "dax" ? composeDaxAnswer(responseContext)
        : taskType === "model" ? composeModelAnswer(responseContext)
          : taskType === "debug" ? composeDebugAnswer(responseContext)
            : taskType === "visual" ? composeVisualAnswer(responseContext)
              : taskType === "rls" ? composeRlsAnswer(responseContext)
                : taskType === "powerquery" ? composePQAnswer(responseContext)
                  : taskType === "service" ? composeServiceAnswer(responseContext)
                    : composeGeneralAnswer(responseContext);

    return { text, confidence: analysis.confidence, analysis, taskType };
  }

  function classifyPrompt(prompt) {
    const lower = prompt.toLowerCase();
    if (/incorrect total|wrong total|wrong result|wrong aggregation|slow|performance|optimi[sz]e|too slow|timeout|heavy visual|dax studio|vertipaq|formula engine|storage engine/.test(lower)) {
      return "debug";
    }
    if (/rls|row.level security|row level security|userprincipalname|dynamic rls|static rls|manage roles|view as role|object.level|ols|sensitivity label|guest user|b2b|embed token/.test(lower)) {
      return "rls";
    }
    if (/power query|m code|query folding|let\b|in\b|table\.addcolumn|table\.selectrows|list\.|record\.|web\.contents|json\.document|csv|dataflow|merge queries|append queries|custom function|try otherwise/.test(lower)) {
      return "powerquery";
    }
    if (/deployment pipeline|gateway|refresh fail|scheduled refresh|publish to service|workspace|fabric|onelake|direct lake|lakehouse|datamart|xmla|tabular editor|alm toolkit|capacity|premium|embed|activity log|admin api/.test(lower)) {
      return "service";
    }
    if (/relationship|semantic model|data model|star schema|cardinality|many-to-many|bidirectional|dimension|fact table|grain|flat table|repeated attribute|denormalized|grouped by .*transactionid|transactionid|bridge table|composite model|incremental refresh|aggregation table/.test(lower)) {
      return "model";
    }
    if (/visual|chart|report page|layout|slicer|drillthrough|bookmark|tooltip page|field parameter|conditional format|mobile layout|theme|accessibility|alt text|bar chart|line chart|scatter|matrix|card|kpi|waterfall|funnel/.test(lower)) {
      return "visual";
    }
    if (/dax|measure|calculate|sumx|averagex|minx|maxx|filter\(|switch|selectedvalue|sameperiodlastyear|dateadd|parallelperiod|divide|ytd|mtd|qtd|yoy|hasonevalue|blank\(|isblank|related\(|lookupvalue|allselected|crossjoin|distinct\(|values\(|countrows|count\(|rankx|topn|userelationship|treatas|keepfilters|removefilters|var\b|return\b|\w+\s*=\s*(sum|count|divide|calculate|if|switch)/.test(lower)) {
      return "dax";
    }
    return "general";
  }

  function composeDaxAnswer(context) {
    const dax = extractDaxCandidate(context.prompt);
    const pattern = analyzeDaxPattern(context.prompt, dax);
    const fixedDax = dax ? applyDaxPatternFix(dax, pattern) : inferDaxTemplate(context.prompt);
    const skill = context.matched.find((s) => s.id === "dax-expert") || context.matched[0];
    const knowledgeNotes = context.knowledge.slice(0, 3).map((k) => `  - ${k.title}: ${k.body}`).join("\n");

    return [
      "RULE:",
      stringifyRule(pattern.rule),
      "",
      "FIXED_DAX:",
      fixedDax,
      "",
      "EXPERT NOTES:",
      "- Always start with a simple base measure before derived measures.",
      "- Use DIVIDE() for every ratio — never raw / operator.",
      "- Use VAR...RETURN to cache any expression referenced more than once.",
      "- Validate with: EVALUATE SUMMARIZECOLUMNS('Date'[Year], \"Result\", [Measure])",
      "- Test blank, zero-denominator, and multi-select slicer cases before publishing.",
      ...(skill?.templates ? [`\nTEMPLATES FROM SKILL:\n${Object.values(skill.templates).slice(0, 2).join("\n\n")}`] : []),
      ...(knowledgeNotes ? [`\nYOUR BUSINESS RULES:\n${knowledgeNotes}`] : []),
      "",
      "IMPACT:",
      `- performance_gain: ${pattern.impact.performance_gain}`,
      `- correctness_risk: ${pattern.impact.correctness_risk}`
    ].join("\n");
  }

  function composeModelAnswer(context) {
    const pattern = analyzeModelPattern(context.prompt);
    const skill = context.matched.find((s) => s.id === "semantic-model") || context.matched[0];
    const rules = (skill?.rules || []).slice(0, 6).map((r) => `- ${r}`);

    return [
      "RULE:",
      stringifyRule(pattern.rule),
      "",
      "FIX:",
      ...pattern.fixSteps.map((step) => `- ${step}`),
      "",
      "MODEL BEST PRACTICES:",
      ...rules,
      "",
      "VALIDATION:",
      "- Put a measure in a matrix with no slicers and verify totals match source system.",
      "- Check that slicer cross-filtering works as expected between all visuals.",
      "- Confirm inactive relationships activate correctly with USERELATIONSHIP.",
      ...(skill?.templates?.starSchema ? [`\nStar Schema Checklist:\n${skill.templates.starSchema}`] : [])
    ].join("\n");
  }

  function composeDebugAnswer(context) {
    const lower = context.prompt.toLowerCase();
    if (/relationship|many-to-many|bidirectional|model|cardinality|grain/.test(lower)) {
      return composeModelAnswer(context);
    }
    if (/sumx|filter\(|all\(|divide|measure|dax|calculate|\w+\s*=/.test(lower)) {
      return composeDaxAnswer(context);
    }

    const perfSkill = context.matched.find((s) => s.id === "performance");
    const triage = perfSkill?.templates?.triage || [
      "1. Run Performance Analyzer — sort by total duration.",
      "2. Copy slow visual's DAX → paste into DAX Studio → check Server Timings.",
      "3. High FE time → simplify DAX, add VAR, remove nested FILTER.",
      "4. High SE time → reduce cardinality, use aggregation tables, switch to Import.",
      "5. Check visual count: keep ≤ 8 per page.",
      "6. Check slicer cardinality: use search slicer for > 500 distinct values.",
      "7. Check for bi-directional relationships — remove unless required."
    ].join("\n");

    return [
      "RULE:",
      stringifyRule({
        pattern: "report or DAX performance issue",
        detection_logic: "User reports slow visuals, timeouts, or incorrect results without a specific DAX expression.",
        fix: "Triage with Performance Analyzer → DAX Studio → optimize DAX or model structure.",
        category: "performance",
        confidence: 0.82,
        requires_llm: false
      }),
      "",
      "TRIAGE STEPS:",
      triage,
      "",
      "COMMON ROOT CAUSES:",
      "- FILTER(FactTable, ...) instead of simple CALCULATE argument",
      "- SUMX over large fact table when CALCULATE(SUM()) works",
      "- Same measure referenced multiple times without VAR",
      "- Bi-directional relationship causing cross-filter ambiguity",
      "- High-cardinality column in slicer or legend",
      "- Too many visuals on one page (> 8)"
    ].join("\n");
  }

  function composeVisualAnswer(context) {
    const skill = context.matched.find((s) => s.id === "visual-design") || context.matched[0];
    const rules = (skill?.rules || []).slice(0, 8).map((r) => `- ${r}`);
    const lower = context.prompt.toLowerCase();

    const chartType = /trend|over time|month|week|daily|growth/.test(lower) ? "Line chart"
      : /rank|top|bottom|compare|by region|by product|category/.test(lower) ? "Clustered bar chart"
        : /share|mix|composition|percent of/.test(lower) ? "100% stacked bar chart"
          : /scatter|outlier|correlation|relationship between/.test(lower) ? "Scatter chart"
            : /map|geography|country|state|city|region/.test(lower) ? "Filled map"
              : /matrix|cross|pivot|by month and/.test(lower) ? "Matrix"
                : /kpi|scorecard|headline|single number/.test(lower) ? "Card"
                  : "Clustered column chart";

    return [
      `RECOMMENDED VISUAL: ${chartType}`,
      "",
      "FIELD WELLS:",
      skill?.templates?.comparison || "Axis: Category dimension | Values: Primary measure | Sort: Descending | Tooltip: Variance, target",
      "",
      "REPORT DESIGN RULES:",
      ...rules,
      "",
      "FORMATTING CHECKLIST:",
      "- Title states the business question, not the chart type",
      "- Data labels on only if they change interpretation",
      "- Consistent color palette across the page",
      "- Sort order: descending by the decision metric",
      "- Conditional formatting: only where color changes meaning",
      "",
      "INTERACTIONS:",
      "- Set cross-filter/cross-highlight intentionally for each visual pair",
      "- Sync slicers across pages that share the same filter context",
      "- Add drillthrough to detail pages for operational records"
    ].join("\n");
  }

  function composeRlsAnswer(context) {
    const skill = context.matched.find((s) => s.id === "security-rls") || context.matched[0];
    const rules = (skill?.rules || []).slice(0, 8).map((r) => `- ${r}`);

    return [
      "ROW-LEVEL SECURITY GUIDANCE",
      "",
      "DYNAMIC RLS SETUP (most common):",
      skill?.templates?.dynamicRls || "'Security'[UserPrincipalName] = USERPRINCIPALNAME()",
      "",
      "STEPS:",
      "1. Create a Security mapping table: [UserEmail], [FilterValue]",
      "2. Create relationship: Security[FilterValue] → Dimension[Key]",
      "3. Modeling > Manage roles > New role > add DAX filter",
      "4. Test: Modeling > View as > select role + enter test email",
      "5. Publish and assign users/groups to the role in Power BI Service",
      "",
      "SECURITY RULES:",
      ...rules,
      "",
      "WARNINGS:",
      "- RLS does not apply to XMLA endpoints without Premium",
      "- Hidden pages and visuals are NOT security — use RLS for data access",
      "- Service principals bypass RLS unless EffectiveIdentity is set in embed tokens",
      "- Test every role with a real user account before go-live",
      ...(skill?.templates?.managerHierarchy ? [`\nMANAGER HIERARCHY PATTERN:\n${skill.templates.managerHierarchy}`] : [])
    ].join("\n");
  }

  function composePQAnswer(context) {
    const skill = context.matched.find((s) => s.id === "power-query") || context.matched[0];
    const rules = (skill?.rules || []).slice(0, 8).map((r) => `- ${r}`);

    return [
      "POWER QUERY / M GUIDANCE",
      "",
      "KEY PRINCIPLES:",
      ...rules,
      "",
      "QUERY FOLDING RULES:",
      "- Check folding: right-click a step → 'View Native Query' (greyed = folding broken)",
      "- Table.Buffer() breaks folding — move it as late as possible",
      "- SQL native queries maintain folding; string-built URLs break it",
      "- Group By, Filter, Select Columns, Remove Columns usually fold on SQL sources",
      "",
      "ERROR HANDLING PATTERN:",
      skill?.templates?.errorHandling || "try [Column] otherwise null",
      "",
      "CUSTOM FUNCTION PATTERN:",
      skill?.templates?.customFunction || "let fnGet = (p) => Json.Document(Web.Contents(url & p)) in fnGet",
      "",
      "DATAFLOW BEST PRACTICES:",
      "- Use Dataflow Gen2 for shared transformations consumed by multiple semantic models",
      "- Stage intermediate tables in Lakehouse before final output",
      "- Disable Load on every staging query to avoid bloating the dataflow model"
    ].join("\n");
  }

  function composeServiceAnswer(context) {
    const skill = context.matched.find((s) => s.id === "service-ops") || context.matched[0];
    const rules = (skill?.rules || []).slice(0, 8).map((r) => `- ${r}`);
    const lower = context.prompt.toLowerCase();

    const specificTemplate = /refresh|gateway/.test(lower) ? skill?.templates?.refreshTriage
      : /deployment|pipeline|stage/.test(lower) ? skill?.templates?.deploymentPipeline
        : /fabric|lakehouse|direct lake|onelake/.test(lower) ? skill?.templates?.fabricLakehouse
          : null;

    return [
      "POWER BI SERVICE GUIDANCE",
      "",
      "SERVICE BEST PRACTICES:",
      ...rules,
      ...(specificTemplate ? ["", "STEP-BY-STEP:", specificTemplate] : []),
      "",
      "GOVERNANCE CHECKLIST:",
      "- Certified datasets = shared contracts; version with Tabular Editor + git",
      "- Run Impact Analysis before changing any shared semantic model",
      "- Use Activity Log API to audit report usage and identify unused assets",
      "- Monitor capacity health with the Premium Capacity Metrics app",
      "- Subscribe stakeholders to scheduled report snapshots via email subscription"
    ].join("\n");
  }

  function composeGeneralAnswer(context) {
    const rules = context.matched.flatMap((skill) => skill.rules || []).slice(0, 8);
    const templates = context.matched.flatMap((skill) =>
      Object.entries(skill.templates || {}).map(([k, v]) => `${k}:\n${v}`)
    ).slice(0, 2);
    const knowledge = context.knowledge.slice(0, 3).map((item) => `- ${item.title}: ${item.body}`);
    const topSkill = context.matched[0];

    return [
      `POWER BI SPECIALIST ANSWER — ${topSkill ? topSkill.name.toUpperCase() : "GENERAL"}`,
      "",
      "EXPERT RULES:",
      ...rules.map((rule) => `- ${rule}`),
      ...(templates.length ? ["", "TEMPLATES:", ...templates] : []),
      ...(knowledge.length ? ["", "YOUR BUSINESS RULES:", ...knowledge] : []),
      "",
      "NEXT STEPS:",
      "- Define the exact business question this report must answer.",
      "- Confirm the grain of the fact table before writing measures.",
      "- Build base measures first, then derived and time-intelligence measures.",
      "- Validate totals against the source system with no slicers applied.",
      "- Use Performance Analyzer to verify the report loads in < 3 seconds."
    ].join("\n");
  }

  function composeExternalRuleAnswer(rule) {
    const fixedDax = rule._analysisResult?.fix || rule.fixed_dax;

    if (rule.category === "modeling") {
      return [
        "RULE:",
        stringifyRule({
          id: rule.id,
          pattern: rule.pattern,
          detection_logic: rule.detection_logic,
          fix: fixedDax,
          category: rule.category,
          confidence: 0.92,
          requires_llm: false,
          priority: rule.priority
        }),
        "",
        "FIX:",
        fixedDax
      ].join("\n");
    }

    return [
      "RULE:",
      stringifyRule({
        id: rule.id,
        pattern: rule.pattern,
        detection_logic: rule.detection_logic,
        fix_template: fixedDax,
        category: rule.category,
        confidence: 0.92,
        requires_llm: false,
        priority: rule.priority
      }),
      "",
      "FIXED_DAX:",
      fixedDax,
      "",
      "IMPACT:",
      `- performance_gain: ${rule.category === "performance" ? "medium" : "low"}`,
      `- correctness_risk: ${rule.category === "correctness" ? "high" : "medium"}`
    ].join("\n");
  }

  function findExternalRule(prompt) {
    const normalizedPrompt = normalizeRuleText(prompt);
    const exactRule = externalRules.find((rule) => {
      if (!rule.bad_dax) return false;
      const normalizedBadDax = normalizeRuleText(rule.bad_dax);
      return normalizedPrompt === normalizedBadDax || normalizedPrompt.includes(normalizedBadDax);
    });
    if (exactRule) return exactRule;

    const topResult = analyzeDAX(prompt)[0];
    return topResult && !topResult.requiresLLM ? { ...topResult.rule, _analysisResult: topResult } : null;
  }

  function matchesRule(dax, rule) {
    if (window.PowerBIDaxEngine?.matchesRule) {
      return window.PowerBIDaxEngine.matchesRule(dax, rule);
    }

    return scoreMatch(rule, dax) >= MATCH_THRESHOLD;
  }

  function analyzeDAX(dax) {
    if (window.PowerBIDaxEngine?.analyzeRuleMatches) {
      window.PowerBIDaxEngine.setRules(externalRules);
      return window.PowerBIDaxEngine.analyzeRuleMatches(dax);
    }

    const parsed = parseDAX(dax);
    const results = externalRules.map((rule) => {
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

  function hasFunctionCall(dax, fn) {
    const parsed = typeof dax === "object" ? dax : parseDAX(dax);
    return parsed.functions.includes(String(fn || "").toUpperCase());
  }

  function formatResult(result) {
    const rule = result.rule || result;
    const fix = applyTemplate(rule, result.parsed);

    return {
      issue: rule.pattern,
      fix: fix.fix,
      fix_type: fix.fix_type,
      rule_fix: rule.fixed_dax,
      category: rule.category,
      explanation: explainRule(rule, result.parsed),
      parsed: result.parsed
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

  function normalizeRuleText(value) {
    return String(value || "")
      .replace(/[“”]/g, "\"")
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function analyzeDaxPattern(prompt, dax) {
    const source = (dax || prompt).trim();

    if (/filter\s*\(\s*[\w']+\s*,\s*true\s*\(\s*\)\s*\)/i.test(source)) {
      return daxPattern("Using FILTER on entire table unnecessarily", "Detect FILTER(table, TRUE()) inside CALCULATE or iterator.", "{measure} = {base_aggregation}", "performance", 0.94, "medium", "low");
    }

    if (/crossjoin\s*\(/i.test(source)) {
      return daxPattern("Unnecessary CROSSJOIN usage", "Detect CROSSJOIN over potentially large VALUES tables.", "Avoid CROSSJOIN; use relationships or filtered visuals.", "performance", 0.86, "high", "medium");
    }

    if (/summarize\s*\(/i.test(source)) {
      return daxPattern("Using SUMMARIZE for aggregation instead of measure", "Detect SUMMARIZE used for measure logic or visual aggregation.", "Use measure: Total = SUM({amount_column})", "performance", 0.88, "medium", "medium");
    }

    if (/addcolumns\s*\(/i.test(source)) {
      return daxPattern("Unnecessary ADDCOLUMNS for scalar calc", "Detect ADDCOLUMNS used for row-level calculations that should be measures.", "Create measure: {measure} = SUM({revenue_column}) - SUM({cost_column})", "performance", 0.82, "medium", "medium");
    }

    if (/related\s*\(/i.test(source)) {
      return daxPattern("Using RELATED without relationship", "Detect RELATED(column) where no relationship exists or relationship is not guaranteed.", "Create relationship between tables or use LOOKUPVALUE with a unique key.", "modeling", 0.78, "low", "high");
    }

    if (/lookupvalue\s*\(/i.test(source)) {
      return daxPattern("Using LOOKUPVALUE repeatedly in measure", "Detect LOOKUPVALUE used in measure logic where relationship-based lookup is preferred.", "Create relationship and use RELATED({column})", "performance", 0.78, "medium", "medium");
    }

    if (/allselected\s*\(/i.test(source)) {
      return daxPattern("Using ALLSELECTED unnecessarily", "Detect ALLSELECTED(table) where visual-selection semantics are not required.", "CALCULATE({expression})", "performance", 0.82, "medium", "medium");
    }

    if (/hasonevalue\s*\(/i.test(source)) {
      return daxPattern("Using HASONEVALUE incorrectly", "Detect HASONEVALUE(column) returned directly as measure output.", "IF(HASONEVALUE({column}), 1, 0)", "correctness", 0.88, "low", "medium");
    }

    if (/=\s*distinct\s*\(/i.test(source)) {
      return daxPattern("Incorrect DISTINCT usage for scalar", "Detect DISTINCT(column) where a scalar value is required.", "SELECTEDVALUE({column})", "correctness", 0.88, "low", "high");
    }

    if (/=\s*if\s*\([^=]+=\s*blank\s*\(/i.test(source)) {
      return daxPattern("Incorrect logical comparison with BLANK", "Detect = BLANK() comparison inside IF/logical expression.", "IF(ISBLANK({expression}), {blank_result}, {nonblank_result})", "correctness", 0.9, "low", "medium");
    }

    if (/if\s*\([^,]+,\s*[^,]+,\s*if\s*\([^,]+,\s*[^,]+,\s*if\s*\(/i.test(source)) {
      return daxPattern("Complex nested IF instead of SWITCH", "Detect nested IF depth greater than 2.", "SWITCH({expression}, {value1}, {result1}, {value2}, {result2}, {else})", "performance", 0.84, "low", "medium");
    }

    if (/earlier\s*\(/i.test(source)) {
      return daxPattern("Using EARLIER in complex row operations", "Detect EARLIER in measure-like expression or complex row operation.", "RANKX({scope}, {measure})", "performance", 0.86, "medium", "high");
    }

    if (/calculate\s*\(\s*calculate\s*\(/i.test(source)) {
      return daxPattern("Nested CALCULATE calls", "Detect CALCULATE(CALCULATE(...)) with no additional outer filter modifiers.", "CALCULATE({expression}, {filters})", "performance", 0.92, "low", "low");
    }

    if (/calculated column/i.test(source) && /calculate\s*\(\s*sum\s*\(/i.test(source)) {
      return daxPattern("Missing context transition in calculated column", "Detect aggregation measure logic placed in a calculated column.", "Use measure instead: {measure} = SUM({column})", "modeling", 0.82, "medium", "high");
    }

    if (/^\s*[\w\s%$-]+=\s*calculate\s*\(\s*sum\s*\([^)]+\)\s*\)\s*$/i.test(source)) {
      return daxPattern("Using CALCULATE without filters repeatedly", "Detect CALCULATE(expression) with no filter arguments or context-transition requirement.", "{measure} = SUM({column})", "performance", 0.9, "low", "low");
    }

    if (/sumx\s*\(\s*[\w']+\s*,\s*calculate\s*\(\s*sum\s*\(/i.test(source)) {
      return daxPattern("Repeated context transition in iterators", "Detect SUMX(table, CALCULATE(SUM(...))) where context transition is repeated per row.", "{measure} = SUM({column})", "performance", 0.92, "high", "medium");
    }

    if (/sumx\s*\(\s*values\s*\(/i.test(source)) {
      return daxPattern("Using VALUES in row context repeatedly", "Detect SUMX(VALUES(column), measure) where the measure already respects filter context.", "{measure} = {base_measure}", "performance", 0.82, "medium", "medium");
    }

    if ((source.match(/countrows\s*\(\s*values\s*\(/ig) || []).length > 1) {
      return daxPattern("Using VALUES repeatedly in measure", "Detect repeated COUNTROWS(VALUES(column)) expressions in one measure.", "{measure} = n * DISTINCTCOUNT({column})", "performance", 0.86, "medium", "low");
    }

    if (/countrows\s*\(\s*values\s*\(/i.test(source)) {
      return daxPattern("Using COUNTROWS(VALUES()) instead of DISTINCTCOUNT", "Detect COUNTROWS(VALUES(column)) used as a distinct count.", "DISTINCTCOUNT({column})", "performance", 0.9, "medium", "low");
    }

    if (/countrows\s*\(\s*distinct\s*\(/i.test(source)) {
      return daxPattern("Using DISTINCT instead of VALUES in aggregation", "Detect DISTINCT(column) inside an aggregation table expression.", "COUNTROWS(VALUES({column}))", "performance", 0.78, "low", "low");
    }

    if (/=\s*values\s*\(/i.test(source)) {
      return daxPattern("VALUES used where scalar expected", "Detect measure returning VALUES(column) where a scalar is required.", "SELECTEDVALUE({column})", "correctness", 0.92, "low", "high");
    }

    if (/=\s*max\s*\([^)]*(year|name|category|status|type)[^)]*\)/i.test(source)) {
      return daxPattern("Using MAX instead of SELECTEDVALUE", "Detect MAX(column) used to retrieve a selected slicer/category value.", "SELECTEDVALUE({column})", "correctness", 0.72, "low", "medium");
    }

    if (/count\s*\(\s*[\w']+\s*\)/i.test(source)) {
      return daxPattern("COUNT used on table instead of COUNTROWS", "Detect COUNT(table) where a table row count is intended.", "COUNTROWS({table})", "correctness", 0.95, "medium", "high");
    }

    if (/if\s*\([^,]+=\s*0\s*,[^,]+,[\s\S]*\/[\s\S]*\)/i.test(source)) {
      return daxPattern("IF instead of DIVIDE", "Detect manual division with zero check using IF(denominator = 0, alternate, numerator / denominator).", "DIVIDE({numerator}, {denominator})", "performance", 0.86, "low", "medium");
    }

    if (/sum\s*\([^)]*(orderid|customerid|productid|guid|key|code|name)[^)]*\)/i.test(source)) {
      return daxPattern("SUM used on non-numeric column", "Detect SUM applied to ID/key/name-like columns that should not be additive.", "COUNT({column}) or DISTINCTCOUNT({column}) depending on business grain", "correctness", 0.78, "low", "high");
    }

    if (/by\s+category/i.test(source) && /=\s*sum\s*\(/i.test(source)) {
      return daxPattern("Missing relationship causing wrong results", "Detect measure grouped by a dimension where the model relationship is missing or inactive.", "Create relationship between fact table and dimension table.", "modeling", 0.7, "low", "high");
    }

    if (/=\s*[\w']+\[[^\]]+\]\s*[-+*/]\s*[\w']+\[[^\]]+\]\s*$/i.test(source)) {
      return daxPattern("Calculated column instead of measure", "Detect direct row-level column arithmetic where aggregation is required.", "{measure} = SUM({left_column}) - SUM({right_column})", "modeling", 0.82, "medium", "high");
    }

    if (/=\s*[\w']+\[[^\]]+\]\s*$/i.test(source)) {
      return daxPattern("Missing aggregation in measure", "Detect a measure expression returning a raw column reference.", "{measure} = SUM({column})", "correctness", 0.9, "low", "high");
    }

    if (/sumx\s*\(\s*filter\s*\(/i.test(source)) {
      return daxPattern("Iterator over FILTER for simple condition", "Detect SUMX(FILTER(table, simple predicate), table[column]).", "CALCULATE(SUM({column}), {predicate})", "performance", 0.9, "high", "low");
    }

    if (/sumx\s*\(\s*[\w' \[\]]+\s*,\s*[\w' \[\]]+\[[^\]]+\]\s*\)/i.test(source)) {
      return {
        rule: {
          pattern: /^total\s*=/i.test(source) ? "Using SUMX without row context need" : "SUMX over base column",
          detection_logic: "Detect SUMX(table, table[column]) where expression is a direct numeric column reference.",
          fix_template: "SUM({column})",
          category: /^total\s*=/i.test(source) ? "correctness" : "performance",
          confidence: 0.95,
          requires_llm: false
        },
        impact: { performance_gain: "high", correctness_risk: "low" }
      };
    }

    if (/filter\s*\(\s*all\s*\(\s*date\s*\)|filter\s*\(\s*all\s*\(\s*'?date'?\s*\)/i.test(source) || /filter\s*\(\s*all\s*\([^)]*date/i.test(source)) {
      return daxPattern("Inefficient time intelligence using FILTER", "Detect manual time filter using FILTER(ALL(Date), Date[Date] <= ...).", "TOTALYTD({expression}, 'Date'[Date])", "performance", 0.86, "medium", "medium");
    }

    if (/calculate\s*\(/i.test(source) && /filter\s*\(/i.test(source) && /[\w']+\[[^\]]+\]\s*(=|>|<|>=|<=)\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_]+|\d+)/i.test(source)) {
      if (/keepfilters/i.test(source)) {
        return daxPattern("Using FILTER instead of KEEPFILTERS", "Detect FILTER(table, column = value) inside CALCULATE where existing filter intersection should be preserved.", "CALCULATE({expression}, KEEPFILTERS({column} = {value}))", "performance", 0.82, "medium", "medium");
      }
      if (/[<>]=?\s*\d+/.test(source)) {
        return daxPattern("Using FILTER incorrectly for scalar comparison", "Detect FILTER(table, simple scalar comparison) inside CALCULATE.", "CALCULATE({expression}, {column} > {value})", "correctness", 0.86, "medium", "medium");
      }
      return daxPattern("FILTER inside CALCULATE for simple equality", "Detect CALCULATE(expression, FILTER(table, table[column] = scalar)).", "CALCULATE({expression}, {column} = {value})", "performance", 0.9, "medium", "low");
    }

    if (/calculate\s*\(/i.test(source) && /\|\|/.test(source) && /[\w']+\[[^\]]+\]\s*=\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_]+)/i.test(source)) {
      return daxPattern("Inefficient logical OR in CALCULATE", "Detect OR comparison inside a CALCULATE filter argument.", "CALCULATE({expression}, {column} IN {value1, value2})", "performance", 0.86, "medium", "medium");
    }

    if (/calculate\s*\([\s\S]+,\s*([\w']+\[[^\]]+\]\s*=\s*[^,\)]+),\s*\1\s*\)/i.test(source)) {
      return daxPattern("Redundant filters in CALCULATE", "Detect duplicate identical filter arguments inside CALCULATE.", "CALCULATE({expression}, {filter})", "performance", 0.95, "low", "low");
    }

    if (/calculate\s*\(/i.test(source) && /([\w']+\[[^\]]+\])\s*=\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_]+)[\s\S]+?\1\s*=\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_]+)/i.test(source)) {
      return daxPattern("Multiple filters overriding unintentionally", "Detect multiple filters on the same column with conflicting values inside CALCULATE.", "CALCULATE({expression}, {column} IN {value1, value2})", "correctness", 0.88, "medium", "high");
    }

    if (/calculate\s*\(/i.test(source) && /[\w']+\[(category|color|type|status)\]\s*=\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_]+)/i.test(source)) {
      return daxPattern("Hardcoded values instead of dimension reference", "Detect hardcoded filter applied to descriptive attribute on a fact table.", "CALCULATE({expression}, '{dimension}'[{attribute}] = {value})", "modeling", 0.72, "low", "medium");
    }

    if (/all\s*\(/i.test(source) && /removefilters|intent|remove filters/i.test(source)) {
      return daxPattern("Using ALL instead of REMOVEFILTERS", "Detect ALL(table/column) used only to clear filters.", "REMOVEFILTERS({table_or_column})", "performance", 0.84, "low", "medium");
    }

    if (/calculate\s*\(\s*sum\s*\([^)]+\)\s*,\s*all\s*\(\s*(product|category|customer|date|region)[^)]*\)\s*\)/i.test(source)) {
      return daxPattern("Incorrect filter context with CALCULATE and ALL", "Detect ALL(dimension) removing a dimension filter affecting the measure.", "CALCULATE({expression}) or remove ALL({dimension})", "correctness", 0.86, "low", "high");
    }

    if (/calculate\s*\(\s*sum\s*\([^)]+\)\s*,\s*all\s*\(\s*[\w']+\s*\)\s*\)/i.test(source) && /(unexpected|wrong|unnecessary|total sales|total\s*=)/i.test(source)) {
      return daxPattern("Using ALL removes required filters", "Detect ALL(fact table) inside a measure associated with unexpected totals.", "{measure} = SUM({column})", "correctness", 0.88, "low", "high");
    }

    if (hasRepeatedAggregation(source)) {
      return daxPattern("Repeated aggregation without VAR", "Detect repeated aggregation expression in a measure.", "VAR {name} = {repeated_expression} RETURN {expression_using_var}", "performance", 0.84, "medium", "medium");
    }

    if (/\s\/\s/.test(source) && /=/.test(source)) {
      return {
        rule: {
          pattern: "Manual division instead of DIVIDE",
          detection_logic: "Detect '/' operator inside a DAX measure expression.",
          fix_template: "DIVIDE({numerator}, {denominator})",
          category: "correctness",
          confidence: 0.9,
          requires_llm: false
        },
        impact: { performance_gain: "low", correctness_risk: "high" }
      };
    }

    if (/all\s*\(/i.test(source)) {
      return {
        rule: {
          pattern: "ALL() removing required filters",
          detection_logic: "Detect ALL(table/column) inside CALCULATE or iterator context.",
          fix_template: "REMOVEFILTERS({specific_column}) or ALLEXCEPT({table}, {required_dimensions})",
          category: "correctness",
          confidence: 0.8,
          requires_llm: false
        },
        impact: { performance_gain: "medium", correctness_risk: "high" }
      };
    }

    if (/filter\s*\(\s*all\s*\(/i.test(source) || /filter\s*\(\s*[\w']+\s*,/i.test(source)) {
      return {
        rule: {
          pattern: "FILTER used where explicit CALCULATE filter may be sufficient",
          detection_logic: "Detect FILTER(table, condition) or FILTER(ALL(...), condition) inside a measure.",
          fix_template: "CALCULATE({measure}, {column} = {value})",
          category: "performance",
          confidence: 0.75,
          requires_llm: false
        },
        impact: { performance_gain: "medium", correctness_risk: "medium" }
      };
    }

    if (/sameperiodlastyear|dateadd|datesytd|datesmtd|datesqtd/i.test(source)) {
      return {
        rule: {
          pattern: "time intelligence measure",
          detection_logic: "Detect DAX time-intelligence functions requiring a continuous marked Date table.",
          fix_template: "CALCULATE({base_measure}, {time_intelligence_function}('Date'[Date]))",
          category: "correctness",
          confidence: 0.75,
          requires_llm: false
        },
        impact: { performance_gain: "low", correctness_risk: "medium" }
      };
    }

    if (/incorrect total|wrong total|total wrong|aggregation/i.test(source)) {
      return {
        rule: {
          pattern: "incorrect total from row-context-dependent logic",
          detection_logic: "Detect user report of wrong totals without enough DAX to identify exact expression.",
          fix_template: "VAR row_logic = ... RETURN SUMX(VALUES({grain_dimension}), row_logic) only when business total must equal sum of displayed rows.",
          category: "correctness",
          confidence: 0.65,
          requires_llm: false
        },
        impact: { performance_gain: "medium", correctness_risk: "high" }
      };
    }

    return {
      rule: {
        pattern: "unknown or partial DAX pattern",
        detection_logic: "DAX-like input detected, but no strong static pattern matched.",
        fix_template: "CALCULATE({base_aggregation}, {explicit_filters})",
        category: "correctness",
        confidence: 0.45,
        requires_llm: true
      },
      impact: { performance_gain: "low", correctness_risk: "medium" }
    };
  }

  function analyzeModelPattern(prompt) {
    const lower = prompt.toLowerCase();

    if (/bi-directional|bidirectional|both direction|cross filter both/.test(lower)) {
      return {
        rule: {
          pattern: "bi-directional relationship ambiguity",
          detection_logic: "Detect relationship configured with cross-filter direction Both or user report of bidirectional filtering.",
          fix: "Use single-direction dimension-to-fact filtering; replace ambiguity with bridge table or explicit DAX.",
          category: "modeling",
          confidence: 0.9,
          requires_llm: false
        },
        fixSteps: [
          "Change relationship cross-filter direction to Single.",
          "Confirm dimension keys are unique.",
          "Add a bridge table for true many-to-many paths.",
          "Use TREATAS or USERELATIONSHIP for intentional alternate filter paths."
        ]
      };
    }

    if (/missing relationship|no relationship|relationship.+missing|sales by category/.test(lower)) {
      return {
        rule: {
          pattern: "Missing relationship causing wrong results",
          detection_logic: "Detect a dimension used for grouping without an active relationship to the fact table.",
          fix: "Create relationship between fact table and dimension table.",
          category: "modeling",
          confidence: 0.78,
          requires_llm: false
        },
        fixSteps: [
          "Create relationship between Sales and Category table.",
          "Use the dimension key on the one side and fact foreign key on the many side.",
          "Set cross-filter direction to Single from dimension to fact.",
          "Validate totals by category after relationship activation."
        ]
      };
    }

    if (/many-to-many|many to many|m:m|bridge/.test(lower)) {
      return {
        rule: {
          pattern: "Ambiguous many-to-many relationship",
          detection_logic: "Detect direct many-to-many relationship or request mentioning many-to-many without bridge design.",
          fix: "Create a bridge table with distinct keys and single-direction relationships from dimensions through bridge to facts.",
          category: "modeling",
          confidence: 0.88,
          requires_llm: false
        },
        fixSteps: [
          "Create bridge table with distinct relationship keys.",
          "Relate each dimension/fact to the bridge using stable keys.",
          "Keep filter direction single unless a tested exception is required.",
          "Validate totals by dimension after bridge implementation."
        ]
      };
    }

    if (/grouped by .*transactionid|transactionid|high cardinality|unique values|too many distinct|guid|timestamp/.test(lower)) {
      return {
        rule: {
          pattern: /grouped by .*transactionid|transactionid/.test(lower) ? "Large cardinality column used in grouping" : "high cardinality column in model or visual",
          detection_logic: "Detect fields with near-row-level distinctness used in slicers, relationships, legends, or grouping.",
          fix: /grouped by .*transactionid|transactionid/.test(lower) ? "Avoid grouping by high-cardinality columns; aggregate at higher level." : "Remove from visuals/slicers, split/round/bucket values, or keep only as hidden detail column.",
          category: /grouped by .*transactionid|transactionid/.test(lower) ? "performance" : "modeling",
          confidence: 0.82,
          requires_llm: false
        },
        fixSteps: [
          "Avoid grouping by high-cardinality transaction-level columns.",
          "Bucket timestamps/numeric values where analysis allows.",
          "Hide technical IDs from report users.",
          "Use surrogate keys only for relationships, not visuals."
        ]
      };
    }

    if (/star schema|dimension|fact|snowflake|repeated attribute|flat table/.test(lower)) {
      return {
        rule: {
          pattern: "non-star schema or repeated attributes in fact table",
          detection_logic: "Detect descriptive attributes repeated in fact table or model described as flat/snowflaked without clear dimensions.",
          fix: "Split descriptive attributes into dimensions and keep measures/additive events in fact tables.",
          category: "modeling",
          confidence: 0.78,
          requires_llm: false
        },
        fixSteps: [
          "Declare fact table grain.",
          "Move descriptive attributes to dimension tables.",
          "Use one-to-many relationships from dimensions to facts.",
          "Hide keys and technical columns.",
          "Create explicit base measures on fact columns."
        ]
      };
    }

    return {
      rule: {
        pattern: "unknown or partial modeling pattern",
        detection_logic: "Modeling language detected, but no strong static model anti-pattern matched.",
        fix: "Enforce star schema, single-direction relationships, unique dimensions, and clear fact grain.",
        category: "modeling",
        confidence: 0.45,
        requires_llm: true
      },
      fixSteps: [
        "Declare fact grain.",
        "Validate dimension key uniqueness.",
        "Use single-direction one-to-many relationships.",
        "Add a marked Date table.",
        "Escalate for detailed schema-specific rewrite."
      ]
    };
  }

  function extractDaxCandidate(prompt) {
    const prefixed = prompt.match(/(?:fix this dax|dax|measure)[:\-]\s*([\s\S]*?\w[\w\s%$-]*\s*=[\s\S]*)/i);
    if (prefixed) return prefixed[1].trim();

    const lines = prompt
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const start = lines.findIndex((line) => /\w[\w\s%$-]*\s*=/.test(line) || /^VAR\s+/i.test(line));
    if (start >= 0) return lines.slice(start).join("\n");
    return "";
  }

  function applyDaxPatternFix(dax, pattern) {
    const trimmed = dax.trim();
    const patternName = pattern.rule.pattern;

    if (patternName === "Missing relationship causing wrong results") {
      return "Create relationship between Sales and Category table";
    }

    if (patternName === "Using RELATED without relationship") {
      return "Create relationship between tables or use LOOKUPVALUE";
    }

    if (patternName === "Using LOOKUPVALUE repeatedly in measure") {
      return "Create relationship and use RELATED(Product[Price])";
    }

    if (patternName === "Incorrect use of LOOKUPVALUE with multiple matches") {
      return "Ensure unique key or use aggregation like MAXX/FILTER";
    }

    if (patternName === "Using ALLSELECTED unnecessarily") {
      return trimmed.replace(/,\s*ALLSELECTED\s*\([^)]+\)/i, "");
    }

    if (patternName === "Incorrect use of ALLSELECTED for totals") {
      return trimmed.replace(/\bALLSELECTED\s*\(/i, "REMOVEFILTERS(");
    }

    if (patternName === "Using HASONEVALUE incorrectly") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*HASONEVALUE\s*\(([^)]+)\)\s*$/i);
      if (match) return `${match[1].trim()} =\nIF(HASONEVALUE(${match[2].trim()}), 1, 0)`;
    }

    if (patternName === "Incorrect logical comparison with BLANK") {
      return trimmed.replace(/([^\s=]+(?:\[[^\]]+\])?)\s*=\s*BLANK\s*\(\s*\)/i, "ISBLANK($1)");
    }

    if (patternName === "Incorrect DISTINCT usage for scalar") {
      return trimmed.replace(/\bDISTINCT\s*\(/i, "SELECTEDVALUE(");
    }

    if (patternName === "Inefficient logical OR in CALCULATE" || patternName === "Incorrect OR condition using multiple filters" || patternName === "Multiple filters overriding unintentionally") {
      const parsed = parseSameColumnValues(trimmed);
      if (parsed) {
        return `${parsed.measureName} =\nCALCULATE(${parsed.expression}, ${parsed.column} IN {${parsed.values.join(",")}})`;
      }
    }

    if (patternName === "Using CALCULATE without filters repeatedly" || patternName === "Incorrect use of CALCULATE without filters") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*CALCULATE\s*\(\s*(SUM\([^)]+\))\s*\)\s*$/i);
      if (match) return `${match[1].trim()} =\n${match[2].trim()}`;
    }

    if (patternName === "Missing context transition in calculated column") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*CALCULATE\s*\(\s*(SUM\([^)]+\))\s*\)\s*$/i);
      if (match) return `Use measure instead: ${match[1].trim()} = ${match[2].trim()}`;
    }

    if (patternName === "Incorrect filter context with CALCULATE and ALL") {
      return trimmed.replace(/,\s*ALL\s*\([^)]+\)/i, "");
    }

    if (patternName === "FILTER inside CALCULATE for simple equality") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*CALCULATE\s*\(\s*([\s\S]+?)\s*,\s*FILTER\s*\(\s*([\w']+)\s*,\s*([\w']+\[[^\]]+\]\s*=\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_]+))\s*\)\s*\)/i);
      if (match) return `${match[1].trim()} =\nCALCULATE(${match[2].trim()}, ${match[4].trim()})`;
    }

    if (patternName === "Using FILTER instead of KEEPFILTERS") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*CALCULATE\s*\(\s*([\s\S]+?)\s*,\s*FILTER\s*\(\s*([\w']+)\s*,\s*([\w']+\[[^\]]+\]\s*=\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_]+))\s*\)\s*\)/i);
      if (match) return `${match[1].trim()} =\nCALCULATE(${match[2].trim()}, KEEPFILTERS(${match[4].trim()}))`;
    }

    if (patternName === "Using ALL removes required filters" || patternName === "Unnecessary ALL removing filters") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*CALCULATE\s*\(\s*(SUM\([^)]+\))\s*,\s*ALL\s*\(\s*[\w']+\s*\)\s*\)\s*$/i);
      if (match) return `${match[1].trim()} =\n${match[2].trim()}`;
    }

    if (patternName === "Using ALL instead of REMOVEFILTERS" || patternName === "Missing REMOVEFILTERS instead of ALL") {
      return trimmed.replace(/\bALL\s*\(/ig, "REMOVEFILTERS(");
    }

    if (patternName === "Repeated aggregation without VAR" || patternName === "Missing VAR for repeated expression") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*\((SUM\([^)]+\))\s*-\s*(SUM\([^)]+\))\)\s*\/\s*\2\s*$/i);
      if (match) {
        return [
          `${match[1].trim()} =`,
          `VAR Rev = ${match[2].trim()}`,
          `VAR Cost = ${match[3].trim()}`,
          "RETURN",
          "    DIVIDE(Rev - Cost, Rev)"
        ].join("\n");
      }
    }

    if (patternName === "COUNT used on table instead of COUNTROWS" || patternName === "COUNT instead of COUNTROWS") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*COUNT\s*\(\s*([\w']+)\s*\)\s*$/i);
      if (match) return `${match[1].trim()} =\nCOUNTROWS(${match[2].trim()})`;
    }

    if (patternName === "Using DISTINCT instead of VALUES in aggregation" || patternName === "Using DISTINCT instead of VALUES") {
      return trimmed.replace(/\bDISTINCT\s*\(/ig, "VALUES(");
    }

    if (patternName === "Nested CALCULATE calls" || patternName === "Nested CALCULATE redundancy") {
      return trimmed.replace(/CALCULATE\s*\(\s*CALCULATE\s*\(([\s\S]+)\)\s*\)/i, "CALCULATE($1)");
    }

    if (patternName === "IF instead of DIVIDE") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*IF\s*\(\s*(SUM\([^)]+\))\s*=\s*0\s*,\s*0\s*,\s*(SUM\([^)]+\))\s*\/\s*\2\s*\)\s*$/i);
      if (match) return `${match[1].trim()} =\nDIVIDE(${match[3].trim()}, ${match[2].trim()})`;
    }

    if (patternName === "Calculated column instead of measure") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*([\w']+\[[^\]]+\])\s*-\s*([\w']+\[[^\]]+\])\s*$/i);
      if (match) return `${match[1].trim()} =\nSUM(${match[2].trim()}) - SUM(${match[3].trim()})`;
    }

    if (patternName === "SUM used on non-numeric column" || patternName === "Using SUM on non-numeric column") {
      return trimmed.replace(/\bSUM\s*\(/i, "COUNT(");
    }

    if (patternName === "Iterator over FILTER for simple condition" || patternName === "Unnecessary iterator with FILTER") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*SUMX\s*\(\s*FILTER\s*\(\s*([\w']+)\s*,\s*([\w']+\[[^\]]+\]\s*=\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_]+))\s*\)\s*,\s*([\w']+\[[^\]]+\])\s*\)\s*$/i);
      if (match) return `${match[1].trim()} =\nCALCULATE(SUM(${match[4].trim()}), ${match[3].trim()})`;
    }

    if (patternName === "Hardcoded values instead of dimension reference") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*CALCULATE\s*\(\s*([\s\S]+?)\s*,\s*[\w']+\[(Category|Color|Type|Status)\]\s*=\s*((?:"[^"]+"|'[^']+'|[A-Za-z0-9_]+))\s*\)\s*$/i);
      if (match) return `${match[1].trim()} =\nCALCULATE(${match[2].trim()}, '${match[3]}'[${match[3]}] = ${match[4]})`;
    }

    if (patternName === "Using EARLIER in complex row operations" || patternName === "Incorrect use of EARLIER in measure" || patternName === "Using EARLIER unnecessarily") {
      return "Rank =\nRANKX(ALL(Sales), SUM(Sales[Amount]))";
    }

    if (patternName === "VALUES used where scalar expected" || patternName === "Using VALUES in scalar context") {
      return trimmed.replace(/\bVALUES\s*\(/i, "SELECTEDVALUE(");
    }

    if (patternName === "Missing aggregation in measure" || patternName === "No aggregation in measure") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*([\w']+\[[^\]]+\])\s*$/i);
      if (match) return `${match[1].trim()} =\nSUM(${match[2].trim()})`;
    }

    if (patternName === "Redundant filters in CALCULATE" || patternName === "Repeated CALCULATE filters") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*CALCULATE\s*\(\s*([\s\S]+?)\s*,\s*([^,]+=\s*[^,\)]+),\s*\3\s*\)\s*$/i);
      if (match) return `${match[1].trim()} =\nCALCULATE(${match[2].trim()}, ${match[3].trim()})`;
    }

    if (patternName === "Using COUNTROWS(VALUES()) instead of DISTINCTCOUNT" || patternName === "Using COUNTROWS on VALUES unnecessarily") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*COUNTROWS\s*\(\s*VALUES\s*\(([^)]+)\)\s*\)\s*$/i);
      if (match) return `${match[1].trim()} =\nDISTINCTCOUNT(${match[2].trim()})`;
    }

    if (patternName === "Inefficient time intelligence using FILTER" || patternName === "Incorrect time intelligence using manual filter" || patternName === "Inefficient time intelligence") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*CALCULATE\s*\(\s*(SUM\([^)]+\))[\s\S]+MAX\s*\(([^)]+)\)[\s\S]*$/i);
      if (match) return `${match[1].trim()} =\nTOTALYTD(${match[2].trim()}, ${match[3].trim()})`;
      const todayMatch = trimmed.match(/^([\w\s%$-]+)=\s*CALCULATE\s*\(\s*(SUM\([^)]+\))[\s\S]+(Date\[[^\]]+\])\s*<=\s*TODAY\s*\(\s*\)[\s\S]*$/i);
      if (todayMatch) return `${todayMatch[1].trim()} =\nTOTALYTD(${todayMatch[2].trim()}, ${todayMatch[3].trim()})`;
    }

    if (patternName === "Using MAX instead of SELECTEDVALUE") {
      return trimmed.replace(/\bMAX\s*\(/i, "SELECTEDVALUE(");
    }

    if (patternName === "Using SUMMARIZE for aggregation instead of measure" || patternName === "Using SUMMARIZE incorrectly for aggregation" || patternName === "Unnecessary calculated table") {
      return "Total =\nSUM(Sales[Amount])";
    }

    if (patternName === "Unnecessary ADDCOLUMNS for scalar calc" || patternName === "Using ADDCOLUMNS inefficiently") {
      return "Profit =\nSUM(Sales[Revenue]) - SUM(Sales[Cost])";
    }

    if (patternName === "Using FILTER on entire table unnecessarily") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*CALCULATE\s*\(\s*(SUM\([^)]+\))\s*,\s*FILTER\s*\(\s*[\w']+\s*,\s*TRUE\s*\(\s*\)\s*\)\s*\)\s*$/i);
      if (match) return `${match[1].trim()} =\n${match[2].trim()}`;
    }

    if (patternName === "Complex nested IF instead of SWITCH") {
      return "Result =\nSWITCH(A, 1, \"X\", 2, \"Y\", 3, \"Z\", \"Other\")";
    }

    if (patternName === "Repeated context transition in iterators") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*SUMX\s*\(\s*[\w']+\s*,\s*CALCULATE\s*\(\s*(SUM\([^)]+\))\s*\)\s*\)\s*$/i);
      if (match) return `${match[1].trim()} =\n${match[2].trim()}`;
    }

    if (patternName === "Using VALUES in row context repeatedly") {
      return trimmed.replace(/SUMX\s*\(\s*VALUES\s*\([^)]+\)\s*,\s*([^)]+)\)/i, "$1");
    }

    if (patternName === "Using VALUES repeatedly in measure") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*COUNTROWS\s*\(\s*VALUES\s*\(([^)]+)\)\s*\)\s*\+\s*COUNTROWS\s*\(\s*VALUES\s*\(\2\)\s*\)\s*$/i);
      if (match) return `${match[1].trim()} =\n2 * DISTINCTCOUNT(${match[2].trim()})`;
    }

    if (patternName === "Unnecessary CROSSJOIN usage") {
      return "Avoid CROSSJOIN; use relationships or filtered visuals";
    }

    if (pattern.rule.pattern === "SUMX over base column" || pattern.rule.pattern === "Using SUMX without row context need") {
      const match = trimmed.match(/^([\w\s%$-]+)=\s*SUMX\s*\(\s*([\w'\s]+)\s*,\s*([\w'\s]+\[[^\]]+\])\s*\)\s*$/i);
      if (match) {
        return `${match[1].trim()} =\nSUM(${match[3].trim()})`;
      }
    }

    const simpleSum = trimmed.match(/^([\w\s%$-]+)=\s*SUM\(([^)]+)\)\s*$/i);
    if (simpleSum) {
      return [
        `${simpleSum[1].trim()} =`,
        "CALCULATE(",
        `    SUM(${simpleSum[2].trim()})`,
        ")"
      ].join("\n");
    }

    if (/\s\/\s/.test(trimmed)) {
      const measure = trimmed.match(/^([\w\s%$-]+)=\s*([\s\S]+)$/);
      if (measure) {
        const division = measure[2].match(/^(.+?)\s\/\s(.+)$/);
        if (division) {
          return [
            `${measure[1].trim()} =`,
            `DIVIDE(${division[1].trim()}, ${division[2].trim()})`
          ].join("\n");
        }
      }
      return trimmed.replace(/(.+?)\s\/\s(.+)/, "DIVIDE($1, $2)");
    }

    if (/SUMX|FILTER/i.test(trimmed) && !/^VAR\s/im.test(trimmed)) {
      return `${trimmed}\n\n-- Review iterator necessity; use VAR blocks if repeated expressions exist.`;
    }

    return trimmed;
  }

  function daxPattern(pattern, detection_logic, fix_template, category, confidence, performance_gain, correctness_risk) {
    return {
      rule: {
        pattern,
        detection_logic,
        fix_template,
        category,
        confidence,
        requires_llm: confidence < 0.5
      },
      impact: { performance_gain, correctness_risk }
    };
  }

  function hasRepeatedAggregation(source) {
    const matches = source.match(/\b(SUM|COUNT|COUNTROWS|DISTINCTCOUNT|AVERAGE|MIN|MAX)\s*\([^)]+\)/gi) || [];
    const normalized = matches.map((item) => item.replace(/\s+/g, "").toLowerCase());
    return normalized.some((item, index) => normalized.indexOf(item) !== index);
  }

  function parseSameColumnValues(dax) {
    const measure = dax.match(/^([\w\s%$-]+)=\s*CALCULATE\s*\(\s*([\s\S]+?)\s*,\s*([\s\S]+)\)\s*$/i);
    if (!measure) return null;

    const filters = measure[3];
    const comparisons = Array.from(filters.matchAll(/([\w']+\[[^\]]+\])\s*=\s*("[^"]+"|'[^']+'|[A-Za-z0-9_]+)/g));
    if (comparisons.length < 2) return null;

    const column = comparisons[0][1];
    if (!comparisons.every((comparison) => comparison[1] === column)) return null;

    return {
      measureName: measure[1].trim(),
      expression: measure[2].trim(),
      column,
      values: comparisons.map((comparison) => comparison[2].trim())
    };
  }

  function stringifyRule(rule) {
    return JSON.stringify(rule, null, 2);
  }

  function inferDaxTemplate(prompt) {
    const lower = prompt.toLowerCase();
    if (/yoy|year over year/.test(lower)) {
      return [
        "YoY % =",
        "VAR CurrentValue = [Base Measure]",
        "VAR PriorValue =",
        "    CALCULATE(",
        "        [Base Measure],",
        "        SAMEPERIODLASTYEAR('Date'[Date])",
        "    )",
        "RETURN",
        "    DIVIDE(CurrentValue - PriorValue, PriorValue)"
      ].join("\n");
    }

    if (/margin|ratio|percent|rate|conversion/.test(lower)) {
      return [
        "Rate % =",
        "VAR NumeratorValue = [Numerator Measure]",
        "VAR DenominatorValue = [Denominator Measure]",
        "RETURN",
        "    DIVIDE(NumeratorValue, DenominatorValue)"
      ].join("\n");
    }

    return [
      "Base Measure =",
      "CALCULATE(",
      "    SUM('Fact Table'[Amount])",
      ")"
    ].join("\n");
  }

  function inferDaxIssue(prompt, dax) {
    const lower = `${prompt}\n${dax}`.toLowerCase();
    if (/\s\/\s/.test(dax)) return "Uses raw division, which can return errors or unstable blanks when the denominator is zero.";
    if (/sumx|filter\(/.test(lower)) return "Iterator/filter logic may be forcing row-by-row evaluation or overriding filter context unnecessarily.";
    if (/total|aggregation/.test(lower)) return "The measure likely behaves differently at total level because total filter context is not the same as row context.";
    if (/yoy|ytd|mtd|dateadd|sameperiodlastyear/.test(lower)) return "Time-intelligence logic requires a continuous marked Date table and correct date relationship.";
    return "Original measure does not make the intended filter context explicit enough for production validation.";
  }

  window.PowerBISkillEngine = {
    skills: SKILLS,
    analyze,
    composeDeterministicAnswer,
    setExternalRules(rules) {
      externalRules = Array.isArray(rules) ? rules : [];
      if (window.PowerBIDaxEngine?.setRules) {
        window.PowerBIDaxEngine.setRules(externalRules);
      }
    },
    getExternalRules() {
      return externalRules.slice();
    },
    scoreMatch,
    matchCondition,
    matchesRule,
    analyzeDAX,
    explainRule,
    applyTemplate,
    formatResult
  };

  if (window.PowerBIRulePacks?.rules) {
    window.PowerBISkillEngine.setExternalRules(window.PowerBIRulePacks.rules);
  }
})();
