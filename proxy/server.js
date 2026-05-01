const http = require("http");
const https = require("https");

// ── Configuration ─────────────────────────────────────────────────────────────
// Set OLLAMA_URL to your VM's address, e.g. http://192.168.1.50:11434
const OLLAMA_URL   = process.env.OLLAMA_URL   || "http://localhost:11434";
const TEXT_MODEL   = process.env.TEXT_MODEL   || "mistral";
const VISION_MODEL = process.env.VISION_MODEL || "llava";
const PORT         = parseInt(process.env.PORT || "8787", 10);

// Maximum tokens for responses
const MAX_TOKENS   = parseInt(process.env.MAX_TOKENS || "512", 10);

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseUrl(urlStr) {
  try { return new URL(urlStr); }
  catch { throw new Error("Invalid OLLAMA_URL: " + urlStr); }
}

// Strip the data:image/png;base64, prefix if present
function stripDataPrefix(dataUrl) {
  if (!dataUrl) return null;
  const comma = dataUrl.indexOf(",");
  return comma !== -1 ? dataUrl.slice(comma + 1) : dataUrl;
}

// POST JSON to a URL, return parsed response body
function postJson(targetUrl, body) {
  return new Promise((resolve, reject) => {
    const parsed = parseUrl(targetUrl);
    const payload = JSON.stringify(body);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + (parsed.search || ""),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: { raw } }); }
      });
    });

    req.on("error", reject);
    req.setTimeout(300000, () => { req.destroy(new Error("Ollama request timed out")); });
    req.write(payload);
    req.end();
  });
}

// ── Ollama API calls ──────────────────────────────────────────────────────────

// /api/chat — works for both text and vision (llava accepts images array)
async function ollamaChat(model, messages) {
  const result = await postJson(`${OLLAMA_URL}/api/chat`, {
    model,
    messages,
    stream: false,
    options: { num_predict: MAX_TOKENS },
  });

  if (result.status !== 200) {
    const detail = result.body?.error || result.body?.raw || JSON.stringify(result.body);
    throw new Error(`Ollama returned ${result.status}: ${detail}`);
  }

  // Ollama chat response: { message: { role, content }, done: true, ... }
  const content = result.body?.message?.content;
  if (!content) throw new Error("Ollama response missing message.content: " + JSON.stringify(result.body));
  return content;
}

// Vision request — sends image inline in the user message (llava format)
async function ollamaVision(prompt, imageBase64) {
  const messages = [
    {
      role: "user",
      content: prompt,
      images: [imageBase64],
    },
  ];
  return ollamaChat(VISION_MODEL, messages);
}

// Text / action plan request — no image
async function ollamaText(systemPrompt, userPrompt) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userPrompt });
  return ollamaChat(TEXT_MODEL, messages);
}

// ── Request routing ───────────────────────────────────────────────────────────

/*
  Extension POST body schema (from fallback_contract.json):
  {
    type: "vision" | "action_plan" | "text"
    prompt: string
    system_prompt?: string
    screenshot?: string   — base64 PNG (with or without data: prefix)
    model?: string        — override, ignored (we use env vars)
  }

  This proxy always returns: { text: string }
*/
async function handleFallback(body) {
  const { type, prompt, system_prompt, screenshot } = body;

  if (type === "vision") {
    if (!screenshot) throw new Error("type=vision requires a screenshot field");
    const imageB64 = stripDataPrefix(screenshot);
    const text = await ollamaVision(prompt, imageB64);
    return { text };
  }

  if (type === "action_plan" || type === "text") {
    const text = await ollamaText(system_prompt || null, prompt);
    return { text };
  }

  throw new Error(`Unknown request type: ${type}. Expected vision, action_plan, or text.`);
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS — Chrome extensions send cross-origin requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url.split("?")[0];

  // Health check
  if (req.method === "GET" && url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      ollama_url: OLLAMA_URL,
      text_model: TEXT_MODEL,
      vision_model: VISION_MODEL,
    }));
    return;
  }

  // List available Ollama models — useful for setup verification
  if (req.method === "GET" && url === "/models") {
    try {
      const parsed = parseUrl(OLLAMA_URL);
      const isHttps = parsed.protocol === "https:";
      const lib = isHttps ? https : http;
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: "/api/tags",
        method: "GET",
      };
      const result = await new Promise((resolve, reject) => {
        const r = lib.request(options, (resp) => {
          const chunks = [];
          resp.on("data", (c) => chunks.push(c));
          resp.on("end", () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
            catch { resolve({ raw: Buffer.concat(chunks).toString() }); }
          });
        });
        r.on("error", reject);
        r.end();
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Could not reach Ollama: " + err.message }));
    }
    return;
  }

  // Main fallback endpoint
  if (req.method === "POST" && url === "/fallback") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }

      const start = Date.now();
      console.log(`[${new Date().toISOString()}] ${body.type} — model: ${body.type === "vision" ? VISION_MODEL : TEXT_MODEL}`);

      try {
        const result = await handleFallback(body);
        const elapsed = Date.now() - start;
        console.log(`  → OK in ${elapsed}ms (${result.text.length} chars)`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error(`  → ERROR: ${err.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found. POST /fallback or GET /health or GET /models" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Power BI Copilot proxy listening on http://127.0.0.1:${PORT}`);
  console.log(`  Ollama URL:    ${OLLAMA_URL}`);
  console.log(`  Text model:    ${TEXT_MODEL}`);
  console.log(`  Vision model:  ${VISION_MODEL}`);
  console.log(`  Health check:  http://127.0.0.1:${PORT}/health`);
  console.log(`  Model list:    http://127.0.0.1:${PORT}/models`);
});
