# Power BI Web Copilot

A local Chrome extension MVP for Power BI Service (`app.powerbi.com`). It injects a compact assistant into the Power BI web page and provides:

- Power BI expert guidance for report building.
- DAX measure generation.
- DAX review and safety checks.
- Visual recommendations and report-page layout plans.
- Semantic model and relationship review checklists.
- Deterministic skill packs with confidence scoring.
- Optional Anthropic fallback through a local proxy.
- A local "training notes" store for your business definitions and report standards.

This first version runs locally in your browser. It does not call OpenAI, Microsoft Graph, or the Power BI REST API yet.

## Load It In Chrome

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder:

   `C:\Users\tchagon\OneDrive - Indiana University\Documents\New project\powerbi-web-copilot`

6. Open [Power BI Service](https://app.powerbi.com/).
7. Click the yellow **BI** tab on the right side of the page, or click the extension icon.

## How To Use

- **Ask**: describe the Power BI task you want help with.
- **Measures**: generate reusable DAX patterns and review DAX.
- **Visuals**: enter a business question and fields to get a visual recipe.
- **Model**: review relationships, grain, star schema shape, and common modeling risks.
- **Train**: save your business definitions, naming conventions, and report rules.

## Deterministic Skills

The extension now loads built-in deterministic skill packs from `src/skills.js`:

- DAX Expert
- Power BI Architect Mode
- Visual Design
- Semantic Model
- Business KPI Glossary
- Performance Review
- Power Query
- Security and RLS
- Power BI Service Ops

Open the **Train** tab to turn skill packs on or off. **Power BI Architect Mode** is enabled by default and now behaves as a compiler/static analyzer.

```text
RULE:
{
  "pattern": "<detectable structure>",
  "detection_logic": "<how to identify>",
  "fix_template": "<generalized fix>",
  "category": "performance | correctness | modeling",
  "confidence": 0.0,
  "requires_llm": false
}

FIXED_DAX:
<code>

IMPACT:
- performance_gain: <low|medium|high>
- correctness_risk: <low|medium|high>
```

```text
RULE:
{
  "pattern": "<model issue>",
  "detection_logic": "<how to detect>",
  "fix": "<schema-level fix>",
  "category": "modeling",
  "confidence": 0.0,
  "requires_llm": false
}

FIX:
<specific changes>
```

Known deterministic patterns include `SUMX` over a base column, iterators over simple `FILTER`, raw division, repeated expressions needing `VAR`, `COUNT` vs `COUNTROWS`, `DISTINCT` vs `VALUES`, nested `CALCULATE`, repeated context transition, nested `IF`, row-level calculated columns, `ALL()`/`ALLSELECTED` filter removal, scalar `VALUES`/`DISTINCT`, duplicate or conflicting filters, `HASONEVALUE`, `BLANK`, `RELATED`, `LOOKUPVALUE`, manual time intelligence, unnecessary `ADDCOLUMNS`/`SUMMARIZE`/`CROSSJOIN`, missing relationships, bidirectional relationships, many-to-many without bridge, high-cardinality columns, and non-star schemas.

Run the deterministic pattern smoke test:

```powershell
node tools\pattern-smoke-test.js
```

When you ask a question, the extension scores matching skills and generates a rule-based answer first.

## Anthropic Fallback

Use fallback when the deterministic skill confidence is low. Keep the Anthropic API key out of the extension by running the local proxy:

```powershell
$env:ANTHROPIC_API_KEY="your_api_key_here"
node tools\anthropic-proxy\server.js
```

If `node` is not on your PATH, use any Node 18+ runtime. The proxy listens at:

`http://localhost:8787/fallback`

Then in the extension:

1. Open the **Train** tab.
2. Turn on **Enable fallback**.
3. Keep the endpoint as `http://localhost:8787/fallback`.
4. Set the fallback threshold. A higher number calls Anthropic more often.
5. Save settings.

The proxy uses Anthropic's Messages API (`POST /v1/messages`) with the `anthropic-version` header and your selected model.

## What "Training" Means Here

This MVP does not fine-tune a model. It stores your rules locally and injects them into the deterministic skill engine. That is the right first step because it is fast, inspectable, and safe.

Later, the extension can be connected to a backend that uses:

- Microsoft identity sign-in.
- Power BI REST APIs.
- DAX query execution.
- XMLA/TOM/TMSL/TMDL for measure and semantic model writes.
- An LLM with retrieval over your saved standards, DAX examples, and report patterns.

## Next Build Step

The next serious upgrade is a backend connector:

1. Microsoft OAuth sign-in.
2. List workspaces, reports, and semantic models.
3. Execute DAX validation queries.
4. Preview measure changes.
5. Write approved measures into Power BI models where XMLA/write permissions allow it.
