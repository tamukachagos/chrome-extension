/**
 * Data Analyst AI — Anthropic Proxy  v1.1.0
 * Listens on PORT (default 3003).
 *
 * Endpoints
 *   GET  /health           — status check
 *   POST /fallback         — single-shot Anthropic call (JSON response)
 *   POST /stream           — streaming Anthropic call  (SSE response)
 *   POST /query-sql        — execute a SELECT query against a database
 *
 * API key can be set via:
 *   • ANTHROPIC_API_KEY environment variable (set before starting the proxy), OR
 *   • apiKey field in the request body (set in the extension Settings tab)
 */

const http  = require("http");
const https = require("https");

const PORT               = Number(process.env.PORT) || 3003;
const API_KEY            = process.env.ANTHROPIC_API_KEY || "";
const DEFAULT_MODEL      = "claude-sonnet-4-6";
const MAX_TOKENS         = 8192;
const TEMPERATURE        = 0.1;
const ANTHROPIC_API_HOST = "api.anthropic.com";
const ANTHROPIC_API_PATH = "/v1/messages";

// ── System prompts ────────────────────────────────────────────────────────────

const SYSTEM_PROMPTS = {
  fallback: `You are a senior data analyst AI assistant embedded in a browser extension. You help with Power BI (DAX, visuals, modeling, KPIs), Tableau, and SQL. Be concise and practical. When writing DAX, always use production-quality patterns: VAR/RETURN, DIVIDE() for ratios, proper time intelligence with a marked Date table. When you include a DAX measure in your response, wrap it in triple backticks with "dax" as the language tag.`,

  vision: `You are a data analyst AI analyzing a screenshot of a business intelligence tool (Power BI, Tableau, or SQL editor). Describe what you see clearly: visual types, data shown, any issues (wrong chart type, missing labels, truncated data, error messages). If you see DAX or SQL code, include it verbatim. Be direct and specific.`,

  action_plan: `You are a Power BI automation assistant. The user wants you to EXECUTE a goal — not explain it. You MUST return a JSON action plan. Never return conversational text.

CRITICAL: ALWAYS return valid JSON with a "steps" array. If uncertain, use a "screenshot" step as the first step to assess the state. NEVER return plain text, advice, or explanations.

Schema:
{
  "goal": "string",
  "risk_level": "low|medium|high",
  "requires_user_approval": false,
  "model_memory": {},
  "steps": [
    {
      "id": "step-1",
      "type": "click|double_click|right_click|type|key|scroll|wait|screenshot|drag|hover|select|clear|focus|read_element|assert_visible|assert_text|write_dax|write_sql|new_measure|write_measure_name|commit_formula|tableau_filter|tableau_navigate|tableau_parameter|tableau_select|tableau_clear_filter|tableau_export|tableau_get_data",
      "target": "CSS selector, XPath, text=..., or aria=...",
      "text": "text to type or assert",
      "keys": "Enter|Escape|ctrl+z|etc",
      "x": 0, "y": 0, "dx": 0, "dy": 0,
      "duration_ms": 0,
      "reason": "why this step",
      "requires_approval": false,
      "risk_level": "low|medium|high",
      "success_detection": "what to check after",
      "failure_detection": "what indicates failure"
    }
  ]
}

Power BI measure creation — choose path based on hasToken in the page context:

IF hasToken is true (REST API available — preferred):
  Use a SINGLE write_dax step. The extension calls the REST API automatically.
  { "type": "write_dax", "text": "MeasureName = DAX_expression", "reason": "Create measure via REST API" }
  Example: { "type": "write_dax", "text": "Total Revenue = SUM(Sales[Amount])", "reason": "Create Total Revenue measure" }
  Do NOT add new_measure, write_measure_name, or commit_formula steps — they are not needed.

IF hasToken is false (DOM path only):
  1. { "type": "new_measure", "reason": "Open the new measure dialog" }
  2. { "type": "write_measure_name", "text": "Total Revenue", "reason": "Set the measure name" }
  3. { "type": "write_dax", "text": "Total Revenue = SUM(Sales[Amount])", "reason": "Enter the DAX formula" }
  4. { "type": "commit_formula", "reason": "Save the measure" }

Tableau action fields (use these instead of DOM clicks when on a Tableau page):
  - tableau_filter:       { fieldName, values: ["East","West"], updateType: "replace|add|remove" }
  - tableau_navigate:     { name: "Sheet Name" }
  - tableau_parameter:    { name: "Parameter Name", value: "new value" }
  - tableau_select:       { fieldName, values: ["Product A"] }
  - tableau_clear_filter: { fieldName }
  - tableau_export:       { }  (no additional fields)
  - tableau_get_data:     { maxRows: 200 }

Use data-testid and aria-label selectors. Keep steps atomic. Return ONLY valid JSON. No markdown fences. No explanations outside the JSON.`,

  dax_expert: `You are a DAX expert for Microsoft Power BI. Write production-quality DAX measures. Rules:
- Always start with simple base measures (SUM, COUNT) before derived measures
- Use DIVIDE(numerator, denominator, 0) — never use /
- Use VAR/RETURN for any expression referenced more than once
- Use a marked Date table for time intelligence (DATEADD, SAMEPERIODLASTYEAR, etc.)
- Use REMOVEFILTERS instead of ALL as a CALCULATE argument
- Add a comment line describing what the measure does
- Wrap the final measure in triple backticks with "dax" tag

Format: Brief explanation → DAX code block → Edge cases to test.`,

  sql_expert: `You are a SQL expert. Write clear, optimized, production-quality SQL queries.
- Use explicit column aliases
- Add comments for complex logic
- Use CTEs (WITH ...) for readability over nested subqueries
- Avoid SELECT * in production
- Consider NULL handling and edge cases
- Wrap SQL in triple backticks with "sql" tag`
};

// ── Utility helpers ───────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end",  () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Private-Network": "true",
    ...extra
  };
}

function sendJson(res, statusCode, body) {
  const data = JSON.stringify(body);
  res.writeHead(statusCode, {
    ...corsHeaders(),
    "Content-Type":   "application/json",
    "Content-Length": Buffer.byteLength(data)
  });
  res.end(data);
}

function resolveApiKey(payload) {
  return (payload.apiKey || "").trim() || API_KEY;
}

// ── Anthropic message builder ─────────────────────────────────────────────────

function buildAnthropicMessages(type, payload) {
  const { prompt, goal, screenshot, context, knowledge, dax, sql,
          modelContext, conversationHistory } = payload;

  const contextBlock = context
    ? `\n\nPage context: ${JSON.stringify(context).slice(0, 800)}`
    : "";

  const knowledgeBlock = Array.isArray(knowledge) && knowledge.length
    ? `\n\nCustom knowledge:\n${knowledge.slice(0, 10).map((k) => `- ${k.title}: ${k.body}`).join("\n")}`
    : "";

  const modelContextBlock = modelContext && Object.keys(modelContext).length
    ? `\n\nModel context: ${JSON.stringify(modelContext).slice(0, 600)}`
    : "";

  const historyMessages = Array.isArray(conversationHistory) && conversationHistory.length
    ? conversationHistory.slice(-8).map((h) => ({
        role:    h.role === "assistant" ? "assistant" : "user",
        content: String(h.content || "").slice(0, 2000)
      }))
    : [];

  function imageBlock(sc) {
    if (!sc?.dataUrl) return null;
    const base64 = sc.dataUrl.includes(",") ? sc.dataUrl.split(",")[1] : sc.dataUrl;
    return { type: "image", source: { type: "base64", media_type: sc.mimeType || "image/png", data: base64 } };
  }

  if (type === "vision") {
    const parts = [];
    const img = imageBlock(screenshot);
    if (img) parts.push(img);
    parts.push({ type: "text", text: (prompt || "Analyze this screenshot.") + contextBlock + knowledgeBlock });
    return [{ role: "user", content: parts }];
  }

  if (type === "action_plan") {
    const parts = [];
    const img = imageBlock(screenshot);
    if (img) parts.push(img);
    const avail = Array.isArray(payload.availableActions)
      ? payload.availableActions.join(", ")
      : "click, double_click, right_click, type, key, scroll, wait, screenshot, drag, write_dax, write_sql, new_measure";
    parts.push({ type: "text",
      text: `Goal: ${goal || prompt || "Accomplish the stated goal."}\n\nAvailable action types: ${avail}${contextBlock}${modelContextBlock}${knowledgeBlock}\n\nReturn ONLY valid JSON. No markdown fences.`
    });
    return [{ role: "user", content: parts }];
  }

  if (type === "generate_dax") {
    return [{ role: "user", content: `${prompt || goal || "Write a DAX measure."}${contextBlock}${modelContextBlock}${knowledgeBlock}` }];
  }

  if (type === "generate_sql") {
    return [{ role: "user", content: `${prompt || goal || "Write a SQL query."}${contextBlock}${knowledgeBlock}` }];
  }

  if (type === "audit_dax") {
    return [{ role: "user", content: `Please audit this DAX measure:\n\n\`\`\`dax\n${dax || prompt || ""}\n\`\`\`${modelContextBlock}${knowledgeBlock}` }];
  }

  if (type === "verify" || type === "replan") {
    const parts = [];
    const img = imageBlock(screenshot);
    if (img) parts.push(img);
    let txt = prompt || goal || "";
    if (type === "verify" && payload.step) {
      const s = payload.step;
      txt = `I just executed: type=${s.type}, target=${s.target || "n/a"}, text=${s.text || "n/a"}, reason=${s.reason || "n/a"}\n\nDid it succeed?\n\nReturn ONLY valid JSON:\n{"success":true,"confidence":0.9,"what_changed":"...","next_action":"continue","issue":""}\n\nnext_action: "continue"|"retry"|"replan"|"abort"`;
    }
    parts.push({ type: "text", text: txt + contextBlock + knowledgeBlock });
    return [{ role: "user", content: parts }];
  }

  // fallback — multi-turn aware
  const currentText = (prompt || goal || "Help with data analysis.") + contextBlock + modelContextBlock + knowledgeBlock;
  if (historyMessages.length) {
    return [...historyMessages, { role: "user", content: currentText }];
  }
  return [{ role: "user", content: currentText }];
}

// ── Single-shot Anthropic call ────────────────────────────────────────────────

function callAnthropic(type, payload) {
  return new Promise((resolve, reject) => {
    const apiKey = resolveApiKey(payload);
    if (!apiKey) {
      return reject(new Error("No API key. Set it in the extension Settings tab or via ANTHROPIC_API_KEY env var."));
    }

    const systemMap = {
      fallback: "fallback", vision: "vision", action_plan: "action_plan",
      generate_dax: "dax_expert", generate_sql: "sql_expert",
      audit_dax: "dax_expert", verify: "vision", replan: "action_plan"
    };
    const systemPrompt = SYSTEM_PROMPTS[systemMap[type]] || SYSTEM_PROMPTS.fallback;
    const messages     = buildAnthropicMessages(type, payload);

    const requestBody = JSON.stringify({
      model:       payload.model || DEFAULT_MODEL,
      max_tokens:  MAX_TOKENS,
      temperature: TEMPERATURE,
      system:      systemPrompt,
      messages
    });

    const req = https.request({
      hostname: ANTHROPIC_API_HOST, port: 443,
      path: ANTHROPIC_API_PATH, method: "POST",
      headers: {
        "Content-Type":    "application/json",
        "Content-Length":  Buffer.byteLength(requestBody),
        "x-api-key":       apiKey,
        "anthropic-version": "2023-06-01"
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed;
        try { parsed = JSON.parse(raw); } catch (e) {
          return reject(new Error(`Non-JSON from Anthropic: ${raw.slice(0, 200)}`));
        }
        if (res.statusCode >= 400) {
          return reject(Object.assign(
            new Error(parsed?.error?.message || raw.slice(0, 300)),
            { anthropicStatus: res.statusCode }
          ));
        }
        const textBlock = Array.isArray(parsed.content) ? parsed.content.find((b) => b.type === "text") : null;
        const text = textBlock ? textBlock.text : "";
        let json = {};
        try { const m = text.match(/\{[\s\S]*\}/); if (m) json = JSON.parse(m[0]); } catch (_) {}
        resolve({ text, json, raw: parsed });
      });
    });
    req.on("error", reject);
    req.write(requestBody);
    req.end();
  });
}

// ── SSE streaming Anthropic call ──────────────────────────────────────────────
// Sends tokens as:  data: {"token":"..."}\n\n
// Final event:      data: {"done":true,"text":"...","json":{}}\n\n

function streamFromAnthropic(type, payload, res) {
  const apiKey = resolveApiKey(payload);
  if (!apiKey) {
    res.write(`data: ${JSON.stringify({ error: "No API key configured." })}\n\n`);
    res.end();
    return;
  }

  const systemMap = {
    fallback: "fallback", vision: "vision", action_plan: "action_plan",
    generate_dax: "dax_expert", generate_sql: "sql_expert",
    audit_dax: "dax_expert", verify: "vision", replan: "action_plan"
  };
  const systemPrompt = SYSTEM_PROMPTS[systemMap[type]] || SYSTEM_PROMPTS.fallback;
  const messages     = buildAnthropicMessages(type, payload);

  const requestBody = JSON.stringify({
    model:       payload.model || DEFAULT_MODEL,
    max_tokens:  MAX_TOKENS,
    temperature: TEMPERATURE,
    system:      systemPrompt,
    messages,
    stream:      true
  });

  const req = https.request({
    hostname: ANTHROPIC_API_HOST, port: 443,
    path: ANTHROPIC_API_PATH, method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "Content-Length":  Buffer.byteLength(requestBody),
      "x-api-key":       apiKey,
      "anthropic-version": "2023-06-01"
    }
  }, (anthropicRes) => {
    let fullText = "";
    let leftover  = "";

    anthropicRes.on("data", (chunk) => {
      const raw = leftover + chunk.toString("utf8");
      const lines = raw.split("\n");
      leftover = lines.pop(); // incomplete last line

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        let evt;
        try { evt = JSON.parse(jsonStr); } catch (_) { continue; }

        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          const token = evt.delta.text || "";
          fullText += token;
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        } else if (evt.type === "message_stop" || evt.type === "message_delta") {
          // will handle below on "end"
        } else if (evt.error) {
          res.write(`data: ${JSON.stringify({ error: evt.error.message || "Anthropic error" })}\n\n`);
        }
      }
    });

    anthropicRes.on("end", () => {
      // Parse any JSON in the accumulated text
      let json = {};
      try { const m = fullText.match(/\{[\s\S]*\}/); if (m) json = JSON.parse(m[0]); } catch (_) {}
      res.write(`data: ${JSON.stringify({ done: true, text: fullText, json })}\n\n`);
      res.end();
    });

    anthropicRes.on("error", (err) => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });
  });

  req.on("error", (err) => {
    try {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    } catch (_) {}
  });

  req.write(requestBody);
  req.end();
}

// ── SQL execution ─────────────────────────────────────────────────────────────

const SQL_SAFETY_RE = /^\s*(SELECT|WITH|EVALUATE)\b/i;
const SQL_TIMEOUT_MS = 30_000;
const SQL_MAX_ROWS   = 500;

function detectDriver(connectionString) {
  const cs = (connectionString || "").trim().toLowerCase();
  if (cs.startsWith("postgresql://") || cs.startsWith("postgres://")) return "pg";
  if (cs.startsWith("mysql://"))      return "mysql2";
  // mssql: various formats
  if (cs.startsWith("mssql://") || cs.startsWith("sqlserver://") ||
      cs.includes("server=")    || cs.includes("data source="))   return "mssql";
  return null;
}

async function executeQuery(connectionString, sql, maxRows = SQL_MAX_ROWS) {
  if (!SQL_SAFETY_RE.test(sql.trim())) {
    throw new Error("Only SELECT, WITH, or EVALUATE queries are permitted.");
  }

  const driver = detectDriver(connectionString);
  if (!driver) {
    throw new Error("Unrecognised connection string format. Supported: postgresql://, mysql://, mssql://, or ADO.NET (Server=...).");
  }

  // Dynamic require — driver may not be installed
  let lib;
  try { lib = require(driver); } catch (e) {
    throw new Error(`Driver "${driver}" not installed. Run: npm install ${driver} — in the proxy folder.`);
  }

  // ── PostgreSQL ──
  if (driver === "pg") {
    const { Client } = lib;
    const client = new Client({ connectionString, connectionTimeoutMillis: SQL_TIMEOUT_MS, query_timeout: SQL_TIMEOUT_MS });
    await client.connect();
    try {
      // Add LIMIT if not present
      const safeSql = /\bLIMIT\b/i.test(sql) ? sql : `${sql.replace(/;?\s*$/, "")} LIMIT ${maxRows}`;
      const result  = await client.query({ text: safeSql, rowMode: "array" });
      return {
        columns: result.fields.map((f) => f.name),
        rows:    result.rows.slice(0, maxRows),
        rowCount: result.rowCount
      };
    } finally {
      await client.end().catch(() => {});
    }
  }

  // ── MySQL ──
  if (driver === "mysql2") {
    const mysql = lib;
    return await new Promise((resolve, reject) => {
      const conn = mysql.createConnection(connectionString);
      conn.connect((err) => { if (err) return reject(err); });
      const safeSql = /\bLIMIT\b/i.test(sql) ? sql : `${sql.replace(/;?\s*$/, "")} LIMIT ${maxRows}`;
      conn.query(safeSql, (err, rows, fields) => {
        conn.destroy();
        if (err) return reject(err);
        const columns = (fields || []).map((f) => f.name);
        const data    = (rows || []).slice(0, maxRows).map((r) => columns.map((c) => r[c]));
        resolve({ columns, rows: data, rowCount: data.length });
      });
    });
  }

  // ── SQL Server (mssql) ──
  if (driver === "mssql") {
    const mssql  = lib;
    // Parse mssql:// URI or pass ADO string directly
    let config;
    const uri = connectionString.trim();
    if (uri.startsWith("mssql://") || uri.startsWith("sqlserver://")) {
      const u = new URL(uri.replace(/^sqlserver/, "mssql"));
      config = {
        user:     u.username || undefined,
        password: u.password || undefined,
        server:   u.hostname,
        port:     Number(u.port) || 1433,
        database: u.pathname.replace(/^\//, "") || undefined,
        options:  { encrypt: true, trustServerCertificate: true },
        connectionTimeout: SQL_TIMEOUT_MS,
        requestTimeout:    SQL_TIMEOUT_MS
      };
    } else {
      config = { connectionString: uri, options: { encrypt: true, trustServerCertificate: true } };
    }
    const pool = await mssql.connect(config);
    try {
      const safeSql = /\bTOP\b|\bFETCH\b/i.test(sql)
        ? sql
        : sql.replace(/^\s*SELECT\b/i, `SELECT TOP ${maxRows}`);
      const result = await pool.request().query(safeSql);
      const cols   = result.recordset?.columns ? Object.keys(result.recordset.columns) : [];
      const rows   = (result.recordset || []).slice(0, maxRows).map((r) => cols.map((c) => r[c]));
      return { columns: cols, rows, rowCount: rows.length };
    } finally {
      await pool.close().catch(() => {});
    }
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // ── GET /health ───────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, {
      status: "ok",
      port:   PORT,
      model:  DEFAULT_MODEL,
      hasApiKey: Boolean(API_KEY),
      note: API_KEY
        ? `API key set in environment (${API_KEY.slice(0, 8)}...)`
        : "API key must be provided per-request via extension Settings"
    });
    return;
  }

  // ── POST /fallback ─────────────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/fallback") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (err) {
      sendJson(res, 400, { error: "Invalid JSON: " + err.message });
      return;
    }

    const effectiveKey = resolveApiKey(payload);
    if (!effectiveKey) {
      sendJson(res, 401, { error: "No API key. Set it in the extension Settings tab or via ANTHROPIC_API_KEY env var." });
      return;
    }

    const type = payload.type || "fallback";
    const VALID = ["fallback","vision","action_plan","generate_dax","generate_sql","audit_dax","verify","replan"];
    if (!VALID.includes(type)) {
      sendJson(res, 400, { error: `Unknown type "${type}". Supported: ${VALID.join(", ")}.` });
      return;
    }

    try {
      const result = await callAnthropic(type, payload);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, err.anthropicStatus ? 502 : 500, { error: err.message });
    }
    return;
  }

  // ── POST /stream ───────────────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/stream") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (err) {
      sendJson(res, 400, { error: "Invalid JSON: " + err.message });
      return;
    }

    const effectiveKey = resolveApiKey(payload);
    if (!effectiveKey) {
      sendJson(res, 401, { error: "No API key. Set it in the extension Settings tab or via ANTHROPIC_API_KEY env var." });
      return;
    }

    // Open SSE stream
    res.writeHead(200, corsHeaders({
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive"
    }));

    const type = payload.type || "fallback";
    streamFromAnthropic(type, payload, res);
    return;
  }

  // ── POST /query-sql ────────────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/query-sql") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (err) {
      sendJson(res, 400, { error: "Invalid JSON: " + err.message });
      return;
    }

    const { connectionString, sql, maxRows } = payload;
    if (!connectionString || !sql) {
      sendJson(res, 400, { error: "Both connectionString and sql are required." });
      return;
    }

    try {
      const result = await executeQuery(connectionString, sql.trim(), maxRows || SQL_MAX_ROWS);
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err.message });
    }
    return;
  }

  // ── POST /narrate ────────────────────────────────────────────────────────────
  // Multi-page report narration. Takes N page screenshots → executive summary.
  if (req.method === "POST" && req.url === "/narrate") {
    let payload;
    try { payload = JSON.parse(await readBody(req)); }
    catch (e) { sendJson(res, 400, { error: "Invalid JSON: " + e.message }); return; }

    const apiKey = resolveApiKey(payload);
    if (!apiKey) { sendJson(res, 401, { error: "No API key." }); return; }

    const { pages = [], style = "executive", knowledge = [] } = payload;
    if (!pages.length) { sendJson(res, 400, { error: "pages array is required." }); return; }

    const styleGuide = style === "executive"
      ? "Write as a CFO-level executive summary: 3-4 bullet points per page, one overall conclusion, and 2-3 recommended actions. Be decisive and concise."
      : "Write as a senior data analyst: describe each visual type, call out any data issues, note trends, and recommend follow-up analyses.";

    const knowledgeBlock = knowledge.length
      ? `\nCustom context:\n${knowledge.map(k => `- ${k.title}: ${k.body}`).join("\n")}`
      : "";

    // Build multi-image message
    const contentParts = [];
    for (const page of pages.slice(0, 8)) {
      if (page.screenshot) {
        const base64 = page.screenshot.includes(",") ? page.screenshot.split(",")[1] : page.screenshot;
        contentParts.push({ type: "image", source: { type: "base64", media_type: "image/png", data: base64 } });
      }
      contentParts.push({ type: "text", text: `[Page: ${page.pageName || "Untitled"}]` });
    }
    contentParts.push({
      type: "text",
      text: `You are analyzing a Power BI report with ${pages.length} page(s).\n${styleGuide}${knowledgeBlock}\n\nProvide:\n1. A narrative summary for each page\n2. Overall report health (data completeness, visual effectiveness)\n3. Top 3 insights or anomalies spotted\n4. Recommended actions`
    });

    try {
      const requestBody = JSON.stringify({
        model: DEFAULT_MODEL, max_tokens: MAX_TOKENS, temperature: 0.2,
        system: SYSTEM_PROMPTS.vision,
        messages: [{ role: "user", content: contentParts }]
      });
      const result = await new Promise((resolve, reject) => {
        const req2 = https.request({
          hostname: ANTHROPIC_API_HOST, port: 443, path: ANTHROPIC_API_PATH, method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(requestBody),
                     "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
        }, (r) => {
          const chunks = [];
          r.on("data", c => chunks.push(c));
          r.on("end", () => {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const text = parsed.content?.find(b => b.type === "text")?.text || "";
            resolve({ narrative: text, pages: pages.map(p => p.pageName) });
          });
        });
        req2.on("error", reject);
        req2.write(requestBody);
        req2.end();
      });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // ── POST /anomaly ──────────────────────────────────────────────────────────
  // Time-series anomaly detection. Accepts {series:[{period,value}], kpiName, unit}
  // Returns server-side statistical analysis + Claude interpretation.
  if (req.method === "POST" && req.url === "/anomaly") {
    let payload;
    try { payload = JSON.parse(await readBody(req)); }
    catch (e) { sendJson(res, 400, { error: "Invalid JSON: " + e.message }); return; }

    const apiKey = resolveApiKey(payload);
    if (!apiKey) { sendJson(res, 401, { error: "No API key." }); return; }

    const { series = [], kpiName = "KPI", unit = "" } = payload;
    if (series.length < 2) { sendJson(res, 400, { error: "Need at least 2 data points." }); return; }

    // Statistical analysis
    const values = series.map(p => Number(p.value)).filter(v => !isNaN(v));
    const mean   = values.reduce((a, b) => a + b, 0) / values.length;
    const std    = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    const anomalies = series.map((p, i) => {
      const z = std > 0 ? Math.abs((p.value - mean) / std) : 0;
      return z > 2 ? { period: p.period, value: p.value, zScore: Math.round(z * 10) / 10 } : null;
    }).filter(Boolean);

    const latest  = series[series.length - 1];
    const prev    = series[series.length - 2];
    const pctChange = prev?.value ? ((latest.value - prev.value) / Math.abs(prev.value)) * 100 : 0;

    const seriesSummary = series.slice(-12).map(p => `${p.period}: ${p.value}${unit}`).join(", ");

    try {
      const result = await callAnthropic("fallback", {
        ...payload,
        prompt: `Analyze this time-series data for ${kpiName}:\n${seriesSummary}\n\nStatistics: mean=${Math.round(mean*100)/100}, std=${Math.round(std*100)/100}, latest ${pctChange >= 0 ? "+" : ""}${Math.round(pctChange*10)/10}% vs prior period.\n${anomalies.length ? `Outliers detected at: ${anomalies.map(a => a.period).join(", ")}` : "No statistical outliers."}\n\nReturn JSON:\n{"trend":"up|down|flat|volatile","alert":false,"summary":"2-sentence summary","anomalies":[...],"recommendation":"what to investigate"}`
      });
      sendJson(res, 200, {
        ok: true, kpiName, mean, std, pctChange,
        anomalies, trend: result.json?.trend || "unknown",
        alert: result.json?.alert || anomalies.length > 0,
        summary: result.json?.summary || result.text?.slice(0, 200),
        recommendation: result.json?.recommendation || "",
        raw: result.json
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // ── POST /tableau ──────────────────────────────────────────────────────────
  // Proxy Tableau REST API calls (for Tableau Cloud/Server environments).
  // Client sends: { serverUrl, token, method, path, body }
  if (req.method === "POST" && req.url === "/tableau") {
    let payload;
    try { payload = JSON.parse(await readBody(req)); }
    catch (e) { sendJson(res, 400, { error: "Invalid JSON: " + e.message }); return; }

    const { serverUrl, token, method = "GET", path: apiPath, body: apiBody } = payload;
    if (!serverUrl || !apiPath) { sendJson(res, 400, { error: "serverUrl and path required." }); return; }

    try {
      const url = new URL(apiPath.startsWith("http") ? apiPath : `${serverUrl.replace(/\/$/, "")}/api/2.8${apiPath}`);
      const bodyStr = apiBody ? JSON.stringify(apiBody) : undefined;
      const result = await new Promise((resolve, reject) => {
        const isHttps = url.protocol === "https:";
        const reqLib  = isHttps ? https : http;
        const r = reqLib.request({
          hostname: url.hostname, port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + (url.search || ""), method,
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            ...(token ? { "X-Tableau-Auth": token } : {}),
            ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {})
          }
        }, (resp) => {
          const chunks = [];
          resp.on("data", c => chunks.push(c));
          resp.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json;
            try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
            resolve({ status: resp.statusCode, body: json });
          });
        });
        r.on("error", reject);
        if (bodyStr) r.write(bodyStr);
        r.end();
      });
      sendJson(res, result.status >= 400 ? 502 : 200, result.body);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // ── POST /notify ──────────────────────────────────────────────────────────────
  // Deliver a notification to a Slack incoming webhook or generic HTTP endpoint.
  // Body: { webhookUrl, message, kpiName, value, threshold, direction, blocks }
  if (req.method === "POST" && req.url === "/notify") {
    let payload;
    try { payload = JSON.parse(await readBody(req)); }
    catch (e) { sendJson(res, 400, { error: "Invalid JSON: " + e.message }); return; }

    const { webhookUrl, message, kpiName, value, threshold, direction, blocks } = payload;
    if (!webhookUrl) { sendJson(res, 400, { error: "webhookUrl is required." }); return; }

    // Build Slack-compatible message body
    const text = message ||
      (kpiName ? `⚠️ *${kpiName}* alert: value ${value} is ${direction || "out of threshold"} (threshold: ${threshold})` : "Data Analyst AI alert");

    const slackBody = JSON.stringify({ text, ...(blocks ? { blocks } : {}) });

    try {
      let targetUrl;
      try { targetUrl = new URL(webhookUrl); } catch (_) {
        sendJson(res, 400, { error: "Invalid webhookUrl." }); return;
      }

      const isHttps = targetUrl.protocol === "https:";
      const lib     = isHttps ? https : http;

      const result = await new Promise((resolve, reject) => {
        const r = lib.request({
          hostname: targetUrl.hostname,
          port:     targetUrl.port || (isHttps ? 443 : 80),
          path:     targetUrl.pathname + (targetUrl.search || ""),
          method:   "POST",
          headers: {
            "Content-Type":   "application/json",
            "Content-Length": Buffer.byteLength(slackBody)
          }
        }, (resp) => {
          const chunks = [];
          resp.on("data", c => chunks.push(c));
          resp.on("end", () => resolve({ status: resp.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
        });
        r.on("error", reject);
        r.write(slackBody);
        r.end();
      });

      sendJson(res, result.status >= 400 ? 502 : 200, {
        ok:     result.status < 400,
        status: result.status,
        body:   result.body.slice(0, 200)
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found. Endpoints: POST /fallback | POST /stream | POST /query-sql | POST /narrate | POST /anomaly | POST /tableau | POST /notify | GET /health" });
});

server.maxHeaderSize = 16 * 1024;
server.setTimeout(120_000);
server.on("connection", (socket) => socket.setTimeout(120_000));

server.listen(PORT, () => {
  console.log(`\n  [Data Analyst AI Proxy] Listening on http://localhost:${PORT}`);
  console.log(`  Model    : ${DEFAULT_MODEL}`);
  console.log(`  API key  : ${API_KEY ? "SET (" + API_KEY.slice(0, 8) + "...)" : "NOT SET — enter it in the extension Settings tab"}`);
  console.log(`  Endpoints: POST /fallback | POST /stream | POST /query-sql | POST /narrate | POST /anomaly | POST /tableau | POST /notify | GET /health\n`);
});
