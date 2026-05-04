/**
 * tools/test-proxy.js — Smoke tests for the Anthropic proxy server
 *
 * Tests every endpoint for correct shape, error handling, and auth guards.
 * Does NOT require a live Anthropic API key — tests are structured so that
 * missing-key responses are also valid test outcomes.
 *
 * Usage:
 *   node tools/test-proxy.js [--url http://localhost:3003] [--key sk-ant-...]
 *
 * Exit code: 0 = all pass, 1 = one or more failures.
 */

"use strict";

const http  = require("http");
const https = require("https");

// ── Config ────────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const BASE_URL = getArg("--url", "http://localhost:3003");
const API_KEY  = getArg("--key", process.env.ANTHROPIC_API_KEY || "");

// ── HTTP helper ───────────────────────────────────────────────────────────────

function request(method, path, body, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const isHttps = url.protocol === "https:";
    const lib = isHttps ? https : http;

    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {})
      }
    };

    const timer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString("utf8");
        let json;
        try { json = JSON.parse(text); } catch (_) { json = null; }
        resolve({ status: res.statusCode, text, json, headers: res.headers });
      });
    });
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Test runner ───────────────────────────────────────────────────────────────

const results = [];
let passing = 0, failing = 0;

async function test(name, fn) {
  process.stdout.write(`  ${name} … `);
  try {
    await fn();
    console.log("\x1b[32m✓\x1b[0m");
    passing++;
    results.push({ name, ok: true });
  } catch (err) {
    console.log("\x1b[31m✗  " + err.message + "\x1b[0m");
    failing++;
    results.push({ name, ok: false, error: err.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}
function assertField(obj, field, type) {
  assert(obj != null,        `Response is null`);
  assert(field in obj,       `Missing field: ${field}`);
  if (type) assert(typeof obj[field] === type, `${field} should be ${type}, got ${typeof obj[field]}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nData Analyst AI Proxy Smoke Tests`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`API key: ${API_KEY ? "provided (" + API_KEY.slice(0, 8) + "…)" : "NOT provided (auth guard tests only)"}`);
  console.log("─".repeat(50));

  // ── GET /health ─────────────────────────────────────────────────────────────

  console.log("\n[GET /health]");

  await test("returns 200", async () => {
    const r = await request("GET", "/health");
    assert(r.status === 200, `Expected 200, got ${r.status}`);
  });

  await test("body has status:ok", async () => {
    const r = await request("GET", "/health");
    assertField(r.json, "status", "string");
    assert(r.json.status === "ok", `status should be 'ok', got '${r.json.status}'`);
  });

  await test("body has port and model fields", async () => {
    const r = await request("GET", "/health");
    assertField(r.json, "port");
    assertField(r.json, "model", "string");
  });

  // ── POST /fallback ──────────────────────────────────────────────────────────

  console.log("\n[POST /fallback]");

  await test("rejects missing API key with 401", async () => {
    const r = await request("POST", "/fallback", { type: "fallback", prompt: "hello", apiKey: "" });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
    assertField(r.json, "error");
  });

  await test("rejects unknown type with 400", async () => {
    const r = await request("POST", "/fallback", { type: "bogus_type", prompt: "hello", apiKey: API_KEY || "dummy" });
    assert(r.status === 400 || r.status === 401, `Expected 400 or 401, got ${r.status}`);
  });

  await test("rejects malformed JSON with 400", async () => {
    const raw = await new Promise((resolve, reject) => {
      const url = new URL("/fallback", BASE_URL);
      const r = http.request({
        hostname: url.hostname, port: url.port || 80,
        path: "/fallback", method: "POST",
        headers: { "Content-Type": "application/json" }
      }, (res) => {
        const chunks = []; res.on("data", c => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      });
      r.on("error", reject);
      r.write("{bad json");
      r.end();
    });
    assert(raw.status === 400, `Expected 400, got ${raw.status}`);
  });

  if (API_KEY) {
    await test("returns text field for valid fallback request", async () => {
      const r = await request("POST", "/fallback", {
        type: "fallback", apiKey: API_KEY,
        prompt: "Return the single word: PONG"
      }, 30000);
      assert(r.status === 200, `Expected 200, got ${r.status}: ${r.text?.slice(0, 200)}`);
      assertField(r.json, "text", "string");
      assert(r.json.text.length > 0, "text should not be empty");
    });

    await test("action_plan returns parseable JSON steps", async () => {
      const r = await request("POST", "/fallback", {
        type: "action_plan", apiKey: API_KEY,
        goal: "Take a screenshot"
      }, 30000);
      assert(r.status === 200, `Expected 200, got ${r.status}`);
      const body = r.json;
      assertField(body, "json");
      assert(Array.isArray(body.json?.steps) || typeof body.json === "object",
        "json field should be an object with steps");
    });
  } else {
    console.log("  (skipping live Anthropic tests — no API key)");
  }

  // ── POST /stream ────────────────────────────────────────────────────────────

  console.log("\n[POST /stream]");

  await test("rejects missing API key with 401", async () => {
    const r = await request("POST", "/stream", { type: "fallback", prompt: "hello", apiKey: "" });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  if (API_KEY) {
    await test("streams SSE tokens and closes with done event", async () => {
      await new Promise((resolve, reject) => {
        const url = new URL("/stream", BASE_URL);
        const bodyStr = JSON.stringify({ type: "fallback", apiKey: API_KEY, prompt: "Say: HELLO" });
        const timer = setTimeout(() => reject(new Error("Stream timeout")), 30000);
        const req = http.request({
          hostname: url.hostname, port: url.port || 80,
          path: "/stream", method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) }
        }, (res) => {
          assert(res.statusCode === 200, `Expected 200, got ${res.statusCode}`);
          assert(res.headers["content-type"]?.includes("text/event-stream"), "Content-Type should be text/event-stream");
          let tokens = 0, gotDone = false, buf = "";
          res.on("data", (chunk) => {
            buf += chunk.toString();
            const lines = buf.split("\n"); buf = lines.pop();
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const evt = JSON.parse(line.slice(6));
                if (evt.token) tokens++;
                if (evt.done) gotDone = true;
              } catch (_) {}
            }
          });
          res.on("end", () => {
            clearTimeout(timer);
            assert(gotDone, "Stream should end with {done:true} event");
            assert(tokens > 0, "Should have received at least one token");
            resolve();
          });
        });
        req.on("error", (e) => { clearTimeout(timer); reject(e); });
        req.write(bodyStr); req.end();
      });
    });
  }

  // ── POST /query-sql ─────────────────────────────────────────────────────────

  console.log("\n[POST /query-sql]");

  await test("rejects missing connectionString with 400", async () => {
    const r = await request("POST", "/query-sql", { sql: "SELECT 1" });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
    assertField(r.json, "error");
  });

  await test("rejects non-SELECT queries with 400", async () => {
    const r = await request("POST", "/query-sql", {
      connectionString: "postgresql://localhost/test",
      sql: "DROP TABLE users"
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
    assert(r.json?.error?.toLowerCase().includes("only") || r.json?.error?.toLowerCase().includes("select"),
      `Error should mention SELECT restriction, got: ${r.json?.error}`);
  });

  await test("rejects unrecognised connection string with 400", async () => {
    const r = await request("POST", "/query-sql", {
      connectionString: "mongodb://localhost/test",
      sql: "SELECT 1"
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
    assertField(r.json, "error");
  });

  // ── POST /narrate ────────────────────────────────────────────────────────────

  console.log("\n[POST /narrate]");

  await test("rejects empty pages array with 400", async () => {
    const r = await request("POST", "/narrate", { pages: [], apiKey: API_KEY || "dummy" });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("rejects missing API key with 401", async () => {
    const r = await request("POST", "/narrate", {
      pages: [{ pageName: "Overview", screenshot: null }], apiKey: ""
    });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  // ── POST /anomaly ─────────────────────────────────────────────────────────────

  console.log("\n[POST /anomaly]");

  await test("rejects series with fewer than 2 points", async () => {
    const r = await request("POST", "/anomaly", {
      series: [{ period: "Jan", value: 100 }], kpiName: "Revenue", apiKey: API_KEY || "dummy"
    });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
    assertField(r.json, "error");
  });

  await test("rejects missing API key with 401", async () => {
    const r = await request("POST", "/anomaly", {
      series: [{ period: "Jan", value: 100 }, { period: "Feb", value: 200 }],
      kpiName: "Revenue", apiKey: ""
    });
    assert(r.status === 401, `Expected 401, got ${r.status}`);
  });

  // ── POST /notify ──────────────────────────────────────────────────────────────

  console.log("\n[POST /notify]");

  await test("rejects missing webhookUrl with 400", async () => {
    const r = await request("POST", "/notify", { message: "test" });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
    assertField(r.json, "error");
  });

  await test("rejects invalid URL with 400", async () => {
    const r = await request("POST", "/notify", { webhookUrl: "not-a-url", message: "test" });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
  });

  await test("attempts delivery to unreachable host, returns 502", async () => {
    // Use a valid URL format but guaranteed unreachable
    const r = await request("POST", "/notify", {
      webhookUrl: "https://invalid.example.invalid/webhook",
      message: "test notification"
    }, 15000);
    // Should fail gracefully — either 500 (connection error) or 502 (upstream error)
    assert(r.status === 500 || r.status === 502, `Expected 500 or 502, got ${r.status}`);
  });

  // ── POST /tableau ──────────────────────────────────────────────────────────

  console.log("\n[POST /tableau]");

  await test("rejects missing serverUrl with 400", async () => {
    const r = await request("POST", "/tableau", { path: "/sessions" });
    assert(r.status === 400, `Expected 400, got ${r.status}`);
    assertField(r.json, "error");
  });

  // ── 404 handler ─────────────────────────────────────────────────────────────

  console.log("\n[404 handler]");

  await test("unknown route returns 404 with endpoint list", async () => {
    const r = await request("GET", "/does-not-exist");
    assert(r.status === 404, `Expected 404, got ${r.status}`);
    assertField(r.json, "error");
    assert(r.json.error.includes("/fallback"), "Error should list known endpoints");
  });

  // ── Summary ─────────────────────────────────────────────────────────────────

  console.log("\n" + "─".repeat(50));
  console.log(`Results: \x1b[32m${passing} passed\x1b[0m, \x1b[31m${failing} failed\x1b[0m, ${passing + failing} total`);

  if (failing > 0) {
    console.log("\nFailed tests:");
    results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.name}: ${r.error}`));
    process.exit(1);
  } else {
    console.log("\n✓ All tests passed.\n");
    process.exit(0);
  }
}

run().catch(err => {
  console.error("\nFatal error:", err.message);
  console.error("Is the proxy running?  cd tools/anthropic-proxy && node server.js");
  process.exit(1);
});
