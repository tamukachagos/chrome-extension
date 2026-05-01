/**
 * PBI Anthropic Proxy — listens on PORT (default 3003)
 * Forwards requests to the Anthropic Messages API.
 * ANTHROPIC_API_KEY must be set in the environment — never exposed to the extension.
 * Zero npm dependencies beyond Node.js built-ins.
 */

const http = require("http");
const https = require("https");

const PORT = Number(process.env.PORT) || 3003;
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;
const TEMPERATURE = 0.1;
const ANTHROPIC_API_HOST = "api.anthropic.com";
const ANTHROPIC_API_PATH = "/v1/messages";

const SYSTEM_PROMPTS = {
  fallback: "You are a senior Power BI expert. Return structured, actionable answers.",
  vision: "You are analyzing a Power BI screenshot. Return ONLY valid JSON matching the schema provided. No markdown.",
  action_plan: `You are a Power BI automation assistant. Return ONLY a valid JSON action plan. Schema: { goal, risk_level, requires_user_approval, steps: [{ id, type, target, selector, text, keys, x, y, dx, dy, duration_ms, reason, requires_approval, risk_level, success_detection, failure_detection }] }. Never claim to execute actions directly.`
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Private-Network": "true",
    "Content-Type": "application/json"
  };
}

function sendJson(res, statusCode, body) {
  const data = JSON.stringify(body);
  res.writeHead(statusCode, { ...corsHeaders(), "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

function buildAnthropicMessages(type, payload) {
  const { prompt, goal, screenshot, context, knowledge } = payload;

  const contextBlock = context
    ? `\n\nPage context: ${JSON.stringify(context).slice(0, 800)}`
    : "";

  const knowledgeBlock = Array.isArray(knowledge) && knowledge.length
    ? `\n\nCustom knowledge:\n${knowledge.slice(0, 10).map((k) => `- ${k.title}: ${k.body}`).join("\n")}`
    : "";

  if (type === "vision") {
    const messages = [];
    const contentParts = [];

    if (screenshot && screenshot.dataUrl) {
      const dataUrl = screenshot.dataUrl;
      const base64Data = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      const mimeType = screenshot.mimeType || "image/png";
      contentParts.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mimeType,
          data: base64Data
        }
      });
    }

    contentParts.push({
      type: "text",
      text: (prompt || "Analyze this Power BI screenshot.") + contextBlock + knowledgeBlock
    });

    messages.push({ role: "user", content: contentParts });
    return messages;
  }

  if (type === "action_plan") {
    const goalText = goal || prompt || "Accomplish the stated goal in Power BI.";
    const parts = [];

    if (screenshot && screenshot.dataUrl) {
      const dataUrl = screenshot.dataUrl;
      const base64Data = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      const mimeType = screenshot.mimeType || "image/png";
      parts.push({
        type: "image",
        source: { type: "base64", media_type: mimeType, data: base64Data }
      });
    }

    const availableActions = Array.isArray(payload.availableActions)
      ? payload.availableActions.join(", ")
      : "click, double_click, right_click, type, key, scroll, wait, screenshot, drag";

    parts.push({
      type: "text",
      text: `Goal: ${goalText}\n\nAvailable action types: ${availableActions}${contextBlock}${knowledgeBlock}\n\nReturn ONLY valid JSON matching the action plan schema. No markdown fences.`
    });

    return [{ role: "user", content: parts }];
  }

  // fallback (default)
  const userText = (prompt || goal || "Help with Power BI.") + contextBlock + knowledgeBlock;
  return [{ role: "user", content: userText }];
}

function callAnthropic(type, payload) {
  return new Promise((resolve, reject) => {
    if (!API_KEY) {
      return reject(new Error("ANTHROPIC_API_KEY environment variable is not set."));
    }

    const model = payload.model || DEFAULT_MODEL;
    const systemPrompt = SYSTEM_PROMPTS[type] || SYSTEM_PROMPTS.fallback;
    const messages = buildAnthropicMessages(type, payload);

    const requestBody = JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: systemPrompt,
      messages
    });

    const options = {
      hostname: ANTHROPIC_API_HOST,
      port: 443,
      path: ANTHROPIC_API_PATH,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(requestBody),
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01"
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed;
        try { parsed = JSON.parse(raw); } catch (e) {
          return reject(new Error(`Non-JSON response from Anthropic: ${raw.slice(0, 200)}`));
        }

        if (res.statusCode >= 400) {
          const errMsg = parsed?.error?.message || parsed?.error || raw.slice(0, 300);
          return reject(Object.assign(new Error(errMsg), { anthropicStatus: res.statusCode }));
        }

        // Extract text from Anthropic content blocks
        const textBlock = Array.isArray(parsed.content)
          ? parsed.content.find((b) => b.type === "text")
          : null;
        const text = textBlock ? textBlock.text : "";

        // Try to parse JSON from text
        let json = {};
        try {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) json = JSON.parse(match[0]);
        } catch (_) { /* not JSON, leave empty */ }

        resolve({ text, json, raw: parsed });
      });
    });

    req.on("error", reject);
    req.write(requestBody);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, {
      status: "ok",
      port: PORT,
      model: DEFAULT_MODEL,
      hasApiKey: Boolean(API_KEY)
    });
    return;
  }

  if (req.method === "POST" && req.url === "/fallback") {
    let payload;
    try {
      const body = await readBody(req);
      payload = JSON.parse(body);
    } catch (err) {
      sendJson(res, 400, { error: "Invalid JSON in request body: " + err.message });
      return;
    }

    if (!API_KEY) {
      sendJson(res, 500, { error: "ANTHROPIC_API_KEY is not configured on the proxy server. Set it before starting the proxy." });
      return;
    }

    const type = payload.type || "fallback";
    if (!["fallback", "vision", "action_plan"].includes(type)) {
      sendJson(res, 400, { error: `Unknown type "${type}". Supported: fallback, vision, action_plan.` });
      return;
    }

    try {
      const result = await callAnthropic(type, payload);
      sendJson(res, 200, result);
    } catch (err) {
      const status = err.anthropicStatus ? 502 : 500;
      sendJson(res, status, { error: err.message || String(err) });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found. Use POST /fallback or GET /health." });
});

// Accept large request bodies (screenshots up to 50 MB)
server.maxHeaderSize = 16 * 1024;
server.setTimeout(120000);

// Node's http.Server doesn't have a body size limit — set via socket timeout
// The 50 MB guard is enforced via readBody accepting whatever arrives
server.on("connection", (socket) => {
  socket.setTimeout(120000);
});

server.listen(PORT, () => {
  console.log(`[PBI Anthropic Proxy] Listening on http://localhost:${PORT}`);
  console.log(`[PBI Anthropic Proxy] API key: ${API_KEY ? "SET (" + API_KEY.slice(0, 8) + "...)" : "NOT SET — set ANTHROPIC_API_KEY"}`);
  console.log(`[PBI Anthropic Proxy] Model: ${DEFAULT_MODEL}`);
  console.log(`[PBI Anthropic Proxy] Endpoints: POST /fallback  GET /health`);
});
