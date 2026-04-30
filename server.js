const http = require("http");

const PORT = Number(process.env.PORT || 8787);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || "2023-06-01";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function buildUserPrompt(payload) {
  const skills = payload.deterministic?.analysis?.matches
    ?.map((skill) => `${skill.name}: ${skill.rules?.slice(0, 5).join("; ")}`)
    .join("\n") || "No deterministic skills matched.";

  const knowledge = (payload.knowledge || [])
    .slice(0, 12)
    .map((item) => `- ${item.title}: ${item.body}`)
    .join("\n") || "- No custom training notes.";

  return [
    "User Power BI request:",
    payload.prompt || "",
    "",
    "Power BI page context:",
    JSON.stringify(payload.context || {}, null, 2),
    "",
    "Deterministic skill result:",
    payload.deterministic?.text || "",
    "",
    "Matched deterministic skills:",
    skills,
    "",
    "User training notes:",
    knowledge,
    "",
    "Local rule-based applied answer:",
    payload.localPattern || "",
    "",
    "Return only the final compiler output. No preamble, no plan, no generic advice.",
    "For DAX, use exactly: RULE JSON block, FIXED_DAX, IMPACT.",
    "For modeling, use exactly: RULE JSON block, FIX.",
    "RULE must include pattern, detection_logic, fix_template or fix, category, confidence, requires_llm.",
    "Set requires_llm true only when confidence < 0.5.",
    "If debugging wrong totals, wrong aggregations, or slow reports, reduce to a reusable pattern first."
  ].join("\n");
}

async function callAnthropic(payload) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION
    },
    body: JSON.stringify({
      model: payload.model || DEFAULT_MODEL,
      max_tokens: 1600,
      temperature: 0.2,
      system: [
        "You are Codex, a senior Power BI architect and systems engineer.",
        "You are not a chatbot. You are a rule compiler that converts Power BI problems into deterministic logic.",
        "Transform input into detectable patterns, deterministic rules, optimized solutions, and reusable templates.",
        "Minimize reliance on external models. Maximize rule-based execution.",
        "Act immediately. Produce structured outputs. Prefer rules over explanations. Prefer reusable logic over one-time answers.",
        "You are expert in DAX, context transition, CALCULATE, filter context, star schema modeling, cardinality, Power Query, query folding, performance tuning, visualization best practices, finance, SaaS, and sales metrics.",
        "Output priority: RULE, FIXED SOLUTION, PATTERN DETECTION, short explanation only if needed.",
        "For DAX output exactly: RULE, FIXED_DAX, IMPACT.",
        "For modeling output exactly: RULE, FIX.",
        "RULE is JSON with pattern, detection_logic, fix_template or fix, category, confidence, requires_llm.",
        "Confidence: 0.9+ strong known pattern, 0.6-0.8 partial match, below 0.5 uncertain.",
        "If confidence < 0.5 set requires_llm true, otherwise false.",
        "Known patterns include SUMX over base column, ALL removing required filters, bidirectional relationship ambiguity, high-cardinality column performance issue.",
        "No fluff, no generic advice, no repeating the question.",
        "Use the deterministic skill result as source of truth where applicable.",
        "Never claim you changed Power BI directly unless an external tool confirms execution."
      ].join(" "),
      messages: [
        {
          role: "user",
          content: buildUserPrompt(payload)
        }
      ]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || `Anthropic returned HTTP ${response.status}.`;
    throw new Error(message);
  }

  return data.content
    ?.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method !== "POST" || req.url !== "/fallback") {
    sendJson(res, 404, { error: "Use POST /fallback." });
    return;
  }

  try {
    const body = await readBody(req);
    const payload = JSON.parse(body || "{}");
    const text = await callAnthropic(payload);
    sendJson(res, 200, { text });
  } catch (error) {
    sendJson(res, 500, { error: error.message || String(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Power BI Web Copilot Anthropic proxy listening on http://127.0.0.1:${PORT}/fallback`);
});
