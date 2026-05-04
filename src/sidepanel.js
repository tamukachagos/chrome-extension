/**
 * sidepanel.js — Data Analyst AI side panel controller
 *
 * Uses AgentLoop (loaded before this script in sidepanel.html) for:
 *   - Observe → Act → Verify → Re-plan execution
 *   - Conversation history (multi-turn follow-ups)
 *   - Power BI REST API measure creation (reliable, no DOM jank)
 *   - DAX query execution to see actual results
 */

(function () {

  // ── State ────────────────────────────────────────────────────────────────────
  let proxyEndpoint = "http://localhost:3003";
  let apiKey        = "";        // Anthropic key, stored locally, sent per-request
  let sqlConnection = "";        // SQL connection string
  let activeTabId   = null;
  let activeHost    = "unknown"; // for session memory keying
  let platform      = "unknown";
  let knowledge     = [];
  let kpis          = [];
  let agentLoop     = null;      // AgentLoop instance
  let insightEngine = null;      // InsightEngine instance
  let running       = false;     // is the loop active?
  let pbiApiState   = {};        // { hasToken, workspaceId, reportId, datasetId }
  let wsDatasets    = [];        // cached workspace datasets
  let wsTables      = [];        // cached tables for selected dataset
  let slackWebhook  = "";        // Slack incoming webhook URL

  const PLATFORM_LABELS = {
    power_bi: "Power BI", tableau: "Tableau", sql_server: "SQL",
    looker: "Looker", metabase: "Metabase", unknown: "Unknown"
  };

  // ── DOM ──────────────────────────────────────────────────────────────────────
  const $messages     = document.getElementById("chat-messages");
  const $input        = document.getElementById("user-input");
  const $sendBtn      = document.getElementById("send-btn");
  const $stopBtn      = document.getElementById("stop-btn");
  const $shotBtn      = document.getElementById("screenshot-btn");
  const $scanBtn      = document.getElementById("scan-btn");
  const $statusDot    = document.getElementById("status-dot");
  const $statusText   = document.getElementById("status-text");
  const $proxyStatus  = document.getElementById("proxy-status");
  const $badge        = document.getElementById("platform-badge");
  const $kpiList      = document.getElementById("kpi-list");
  const $addKpiBtn    = document.getElementById("add-kpi-btn");
  const $kpiName      = document.getElementById("kpi-name");
  const $kpiTable     = document.getElementById("kpi-table");
  const $kpiDax       = document.getElementById("kpi-dax");
  const $kpiDef       = document.getElementById("kpi-definition");

  // Alerts tab
  const $alertList        = document.getElementById("alert-list");
  const $alertHistory     = document.getElementById("alert-history");
  const $monitoringEnabled= document.getElementById("monitoring-enabled");
  const $monitoringInterval=document.getElementById("monitoring-interval");
  const $runMonitorNow    = document.getElementById("run-monitor-now");
  const $alertsBadge      = document.getElementById("alerts-badge");

  // Workspace tab
  const $wsDatasets       = document.getElementById("ws-datasets");
  const $wsReports        = document.getElementById("ws-reports");
  const $wsDatasetSelect  = document.getElementById("ws-dataset-select");
  const $wsLoadSchema     = document.getElementById("ws-load-schema");
  const $wsSchema         = document.getElementById("ws-schema");
  const $wsRefreshBtn     = document.getElementById("ws-refresh-btn");
  const $wsPqDataset      = document.getElementById("ws-pq-dataset");
  const $wsPqTable        = document.getElementById("ws-pq-table");
  const $wsPqLoad         = document.getElementById("ws-pq-load");
  const $wsPqEditor       = document.getElementById("ws-pq-editor");
  const $wsPqAiFix        = document.getElementById("ws-pq-ai-fix");
  const $wsPqSave         = document.getElementById("ws-pq-save");
  const $wsPqStatus       = document.getElementById("ws-pq-status");
  const $wsRefreshHistory    = document.getElementById("ws-refresh-history");
  const $wsTriggerRefresh    = document.getElementById("ws-trigger-refresh");
  const $wsWorkspaceSelect   = document.getElementById("ws-workspace-select");
  const $wsLoadWorkspaces    = document.getElementById("ws-load-workspaces");
  const $wsSwitchWorkspace   = document.getElementById("ws-switch-workspace");
  const $wsRlsDataset        = document.getElementById("ws-rls-dataset");
  const $wsRlsLoad           = document.getElementById("ws-rls-load");
  const $wsRlsRoles          = document.getElementById("ws-rls-roles");
  const $wsRlsUsername       = document.getElementById("ws-rls-username");
  const $wsRlsRolesInput     = document.getElementById("ws-rls-roles-input");
  const $wsRlsAddUser        = document.getElementById("ws-rls-add-user");
  const $wsRlsTest           = document.getElementById("ws-rls-test");
  const $wsRlsStatus         = document.getElementById("ws-rls-status");

  // Settings
  const $sSlackWebhook = document.getElementById("s-slack-webhook");
  const $sApiKey       = document.getElementById("s-api-key");
  const $sProxy       = document.getElementById("s-proxy");
  const $sSqlConn     = document.getElementById("s-sql-conn");
  const $sSaveBtn     = document.getElementById("s-save-btn");
  const $sTestBtn     = document.getElementById("s-test-btn");
  const $sProxyStatus = document.getElementById("s-proxy-status");
  const $sKbList      = document.getElementById("s-knowledge-list");
  const $sKbTitle     = document.getElementById("s-kb-title");
  const $sKbBody      = document.getElementById("s-kb-body");
  const $sKbAddBtn    = document.getElementById("s-kb-add-btn");
  const $sAboutProxy  = document.getElementById("s-about-proxy");

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const escHtml = s =>
    String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function setStatus(color, text, pulse) {
    $statusDot.className = "dot" + (color ? " " + color : "") + (pulse ? " pulse" : "");
    $statusText.textContent = text || "";
  }

  function autoResize(ta) {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }

  // ── Chat rendering ────────────────────────────────────────────────────────────

  function appendMsg(role, content, extra = {}) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${role}`;
    const avatar = role === "user" ? "U" : "D";
    const label  = role === "user" ? "You" : "Data Analyst AI";

    let html = "";

    if (typeof content === "string") {
      // Render ```lang\n...\n``` blocks
      const escaped = escHtml(content);
      html = escaped.replace(
        /```(?:[a-z]*)?\n?([\s\S]*?)```/g,
        (_, code) => `<code>${code.trim()}</code>`
      );
    }

    if (extra.screenshot) {
      html += `<br/><img class="thumb" src="${escHtml(extra.screenshot)}" alt="screenshot">`;
    }

    if (extra.logs?.length) {
      html += extra.logs.map(l =>
        `<div class="agent-log ${l.ok === false ? "err" : "ok"}">${
          escHtml((l.step_id ? `[${l.step_id}] ` : "") + (l.error || l.value || (l.ok !== false ? "✓" : "✗")))
        }</div>`
      ).join("");
    }

    if (extra.rows?.length) {
      // Show DAX query results as a mini table
      const cols = Object.keys(extra.rows[0]);
      html += `<div style="overflow-x:auto;margin-top:6px"><table style="border-collapse:collapse;font-size:10px;width:100%">` +
        `<tr>${cols.map(c => `<th style="border:1px solid var(--border);padding:3px 6px;text-align:left">${escHtml(c)}</th>`).join("")}</tr>` +
        extra.rows.slice(0, 20).map(row =>
          `<tr>${cols.map(c => `<td style="border:1px solid var(--border);padding:2px 6px">${escHtml(String(row[c] ?? ""))}</td>`).join("")}</tr>`
        ).join("") +
        (extra.rows.length > 20 ? `<tr><td colspan="${cols.length}" style="padding:4px;color:var(--muted)">…and ${extra.rows.length - 20} more rows</td></tr>` : "") +
        `</table></div>`;
    }

    wrap.innerHTML = `<div class="avatar">${avatar}</div><div><div class="bubble">${html}</div><div class="meta">${label}</div></div>`;
    $messages.appendChild(wrap);
    $messages.scrollTop = $messages.scrollHeight;
    return wrap;
  }

  function appendProgress(text) {
    const el = document.createElement("div");
    el.className = "msg agent";
    el.id = "progress-msg";
    el.innerHTML = `<div class="avatar">D</div><div><div class="bubble" style="color:var(--muted);font-size:11px">${escHtml(text)}</div></div>`;
    $messages.appendChild(el);
    $messages.scrollTop = $messages.scrollHeight;
    return el;
  }

  function updateProgress(el, text) {
    if (!el) return;
    const b = el.querySelector(".bubble");
    if (b) b.textContent = text;
    $messages.scrollTop = $messages.scrollHeight;
  }

  function removeProgress(el) { el?.remove(); }

  function showThinking() {
    const el = document.createElement("div");
    el.id = "thinking";
    el.className = "msg agent";
    el.innerHTML = `<div class="avatar">D</div><div class="thinking-dots"><span></span><span></span><span></span></div>`;
    $messages.appendChild(el);
    $messages.scrollTop = $messages.scrollHeight;
  }
  function hideThinking() { document.getElementById("thinking")?.remove(); }

  /**
   * Creates a streaming response bubble.
   * Returns { el, appendToken(token), finalize(fullText, extra) }.
   * Tokens are appended raw; finalize re-renders with full markdown formatting.
   */
  function appendStreamBubble() {
    const wrap = document.createElement("div");
    wrap.className = "msg agent";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.style.cssText = "white-space:pre-wrap;word-break:break-word";
    wrap.innerHTML = `<div class="avatar">D</div>`;
    wrap.appendChild(bubble);
    // cursor blink
    const cursor = document.createElement("span");
    cursor.id = "stream-cursor";
    cursor.style.cssText = "display:inline-block;width:6px;height:11px;background:var(--accent,#7c6ff7);border-radius:1px;margin-left:2px;animation:blink 1s step-end infinite;vertical-align:middle";
    bubble.appendChild(cursor);
    $messages.appendChild(wrap);
    $messages.scrollTop = $messages.scrollHeight;

    let accumulated = "";

    function appendToken(token) {
      accumulated += token;
      // Insert before cursor
      cursor.insertAdjacentText("beforebegin", token);
      $messages.scrollTop = $messages.scrollHeight;
    }

    function finalize(fullText, extra = {}) {
      cursor.remove();
      // Re-render with code block formatting
      const escaped = escHtml(fullText || accumulated);
      let html = escaped.replace(
        /```(?:[a-z]*)?\n?([\s\S]*?)```/g,
        (_, code) => `<code>${code.trim()}</code>`
      );
      if (extra.screenshot) {
        html += `<br/><img class="thumb" src="${escHtml(extra.screenshot)}" alt="screenshot">`;
      }
      if (extra.rows?.length) {
        const cols = extra.rows[0] && typeof extra.rows[0] === "object" ? Object.keys(extra.rows[0]) : [];
        if (cols.length) {
          html += `<div style="overflow-x:auto;margin-top:6px"><table style="border-collapse:collapse;font-size:10px;width:100%">` +
            `<tr>${cols.map(c => `<th style="border:1px solid var(--border);padding:3px 6px;text-align:left">${escHtml(c)}</th>`).join("")}</tr>` +
            extra.rows.slice(0, 20).map(row =>
              `<tr>${cols.map(c => `<td style="border:1px solid var(--border);padding:2px 6px">${escHtml(String(row[c] ?? ""))}</td>`).join("")}</tr>`
            ).join("") + `</table></div>`;
        }
      }
      bubble.innerHTML = html;
      bubble.style.whiteSpace = "";
      // Bug fix: meta label must be OUTSIDE the bubble, as a sibling — not appended inside it
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = "Data Analyst AI";
      const innerDiv = document.createElement("div");
      innerDiv.appendChild(bubble);
      innerDiv.appendChild(meta);
      wrap.innerHTML = "";
      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.textContent = "D";
      wrap.appendChild(avatar);
      wrap.appendChild(innerDiv);
      $messages.scrollTop = $messages.scrollHeight;
    }

    return { el: wrap, appendToken, finalize };
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  async function init() {
    setStatus("orange", "Initializing…", true);

    chrome.storage.local.get(["pbiSettings", "pbiKnowledge", "kpiRegistry"], async r => {
      const s   = r.pbiSettings || {};
      proxyEndpoint = s.proxyEndpoint || "http://localhost:3003";
      apiKey        = s.apiKey        || "";
      sqlConnection = s.sqlConnection || "";
      slackWebhook  = s.slackWebhook  || "";
      knowledge     = r.pbiKnowledge  || [];
      kpis          = r.kpiRegistry   || [];
      renderKpis();
      loadSettingsUI(s);
      loadMonitoringUI(s);
      buildLoop();
      buildInsightEngine();
    });

    await refreshActiveTab();
    checkProxy();
    loadAlerts();
  }

  function buildLoop() {
    agentLoop = new AgentLoop({
      proxyEndpoint,
      apiKey,
      tabId:    activeTabId,
      knowledge,
      onEvent:  handleLoopEvent
    });
  }

  function buildInsightEngine() {
    insightEngine = new InsightEngine({
      proxy:     proxyEndpoint,
      apiKey,
      pbiState:  pbiApiState,
      sqlConn:   sqlConnection,
      knowledge
    });
  }

  async function refreshActiveTab() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB" }, resp => {
        if (!resp?.tab) { resolve(); return; }
        activeTabId = resp.tab.id;
        if (agentLoop) agentLoop.tabId = activeTabId;

        // Extract hostname for session memory keying
        try { activeHost = new URL(resp.tab.url || "").hostname || "unknown"; } catch (_) {}

        // Load session memory (conversation history) for this host
        chrome.runtime.sendMessage({ type: "LOAD_SESSION_MEMORY", host: activeHost }, memResp => {
          if (memResp?.history?.length && agentLoop) {
            agentLoop.history = memResp.history;
          }
        });

        chrome.runtime.sendMessage(
          { type: "RELAY_TO_CONTENT", tabId: activeTabId, payload: { type: "ADAPTER_PING" } },
          relay => {
            platform = relay?.platform || "unknown";
            if (relay?.workspaceId) pbiApiState.workspaceId = relay.workspaceId;
            if (relay?.reportId)    pbiApiState.reportId    = relay.reportId;
            updateBadge();
            refreshPbiApiStatus();
            setStatus("green", "Ready");
            resolve();
          }
        );
      });
    });
  }

  // Save conversation history when it changes (debounced)
  let _saveHistoryTimer = null;
  function scheduleHistorySave() {
    clearTimeout(_saveHistoryTimer);
    _saveHistoryTimer = setTimeout(() => {
      if (!agentLoop?.history?.length || !activeHost) return;
      chrome.runtime.sendMessage({
        type: "SAVE_SESSION_MEMORY",
        host: activeHost,
        history: agentLoop.history
      });
    }, 2000);
  }

  function updateBadge() {
    $badge.textContent = PLATFORM_LABELS[platform] || "Unknown";
    $badge.className   = { power_bi: "pbi", tableau: "tableau", sql_server: "sql" }[platform] || "";
  }

  async function refreshPbiApiStatus() {
    if (platform !== "power_bi" || !activeTabId) return;
    const r = await relay({ type: "PBI_API_STATUS" });
    if (r?.ok) {
      pbiApiState = { ...pbiApiState, hasToken: r.hasToken, workspaceId: r.workspaceId, reportId: r.reportId };
      const tokenLabel = r.hasToken ? "🔑 Token ✓" : "No token";
      $proxyStatus.title = `Power BI API: ${tokenLabel} | Workspace: ${r.workspaceId || "?"}`;

      // Eagerly resolve datasetId so insightEngine DAX execution can use it immediately
      if (r.hasToken && r.workspaceId && r.reportId && !pbiApiState.datasetId) {
        relay({ type: "PBI_API_GET_DATASET_ID", params: { workspaceId: r.workspaceId, reportId: r.reportId } })
          .then(dsResp => { if (dsResp?.ok && dsResp.result) pbiApiState.datasetId = dsResp.result; })
          .catch(() => {});
      }
    }
  }

  async function checkProxy() {
    try {
      const r = await fetch(`${proxyEndpoint}/health`, { signal: AbortSignal.timeout(3000) });
      const d = r.ok ? await r.json() : null;
      // Proxy never stores the key server-side; check local apiKey instead
      const hasKey = !!apiKey;
      $proxyStatus.textContent = d ? (hasKey ? "Proxy ✓" : "Proxy: no key") : `HTTP ${r.status}`;
      $proxyStatus.style.color = d ? (hasKey ? "var(--green)" : "var(--orange)") : "var(--red)";
    } catch {
      $proxyStatus.textContent = "Proxy offline";
      $proxyStatus.style.color = "var(--red)";
    }
  }

  function relay(payload) {
    return new Promise(resolve =>
      chrome.runtime.sendMessage(
        { type: "RELAY_TO_CONTENT", tabId: activeTabId, payload },
        r => resolve(r)
      )
    );
  }

  // ── Agent loop event handler ──────────────────────────────────────────────────

  let _progressEl = null;
  let _planStepCount = 0;

  function handleLoopEvent(type, data) {
    switch (type) {
      case "start":
        _planStepCount = 0;
        setStatus("orange", "Planning…", true);
        break;

      case "plan":
        _planStepCount = data.plan.steps.length;
        _progressEl = appendProgress(`📋 Plan ready — ${_planStepCount} steps`);
        break;

      case "step_start": {
        const label = data.step.reason || `${data.step.type}: ${data.step.target || data.step.text || ""}`;
        updateProgress(_progressEl, `⚡ Step ${data.stepIndex + 1}/${data.total}: ${label.slice(0, 80)}${data.attempt > 0 ? ` (retry ${data.attempt})` : ""}`);
        setStatus("orange", `Step ${data.stepIndex + 1}/${data.total}`, true);
        break;
      }

      case "step_done":
        updateProgress(_progressEl, `✅ Step ${data.stepIndex + 1} done — ${data.verification?.what_changed?.slice(0, 60) || "ok"}`);
        break;

      case "step_fail":
        appendMsg("agent", `⚠️ Step ${data.stepIndex + 1} failed: ${data.error || "verification failed"}${data.fatal ? " (fatal)" : " — replanning…"}`);
        break;

      case "replan":
        appendMsg("agent", `🔄 Replanning: ${data.reason}. New plan has ${data.newPlan.steps.length} steps.`);
        break;

      case "pbi_api":
        if (data.result?.ok) {
          appendMsg("agent", `🔗 Power BI API: measure created successfully.`);
        }
        break;

      case "complete":
        removeProgress(_progressEl);
        _progressEl = null;
        if (data.textOnly) return; // handled by caller
        appendMsg("agent", data.summary || (data.ok ? "Done." : "Could not complete all steps."),
          { screenshot: data.screenshot });
        setStatus("green", "Ready");
        break;

      case "error":
        removeProgress(_progressEl);
        _progressEl = null;
        appendMsg("agent", `❌ ${data.error}`);
        setStatus("red", data.error.slice(0, 50));
        break;
    }
  }

  // ── Main send ────────────────────────────────────────────────────────────────

  async function send(text, opts = {}) {
    if (running) return;
    const msg = (text || $input.value).trim();
    if (!msg && !opts.forceScreenshot) return;

    if (!opts.silent) {
      if (msg) appendMsg("user", msg);
      $input.value = "";
      autoResize($input);
    }

    running = true;
    $sendBtn.disabled = true;
    $sendBtn.style.display = "none";
    $stopBtn.style.display = "grid";
    showThinking();
    setStatus("orange", "Thinking…", true);

    if (!agentLoop) buildLoop();
    agentLoop.tabId = activeTabId;

    try {
      // Detect intent: execution vs. conversation
      const isExecutionGoal = opts.execute || (
        /\b(create|make|build|open|click|insert|add|write|generate|run|execute|start|apply|set|enable|fix|delete|remove|rename)\b/i.test(msg) &&
        !/\b(what|how|why|explain|tell me|describe|list|show me what|can you)\b/i.test(msg.slice(0, 60))
      );

      hideThinking();

      if (isExecutionGoal) {
        // Agent loop with observe-act-verify
        const result = await agentLoop.run(msg, { withScreenshot: true });
        if (result.type === "text") {
          // Loop decided it was a text question, not an action
          appendMsg("agent", result.text);
        }
        // Other results (complete/error) handled by loop events
      } else {
        // Detect if the question needs live data (insight engine path)
        const needsInsight = insightEngine && !opts.withScreenshot &&
          /\b(why|what caused|how much|trend|compare|top|bottom|which|anomal|drop|spike|change|last week|last month|ytd|revenue|sales|margin|growth|kpi)\b/i.test(msg);

        if (needsInsight) {
          // Insight pipeline: NL → query → execute → interpret
          const { appendToken, finalize } = appendStreamBubble();
          const state = await getPageState();
          const ctx   = agentLoop?._stateContext(state) || "";

          // Update insight engine with latest state
          if (insightEngine) {
            insightEngine.pbiState  = { ...pbiApiState, platform };
            insightEngine.sqlConn   = sqlConnection;
            insightEngine.knowledge = knowledge;
          }

          const insight = await insightEngine.answer(msg, {
            pageContext: ctx,
            onToken:    appendToken,
            pbiRelay:   (payload) => relay(payload)
          });

          finalize(insight.explanation || insight.text || "(no answer)", {
            rows: insight.dataTable?.rows
          });

          if (insight.anomalies?.length) {
            await sleep(150);
            const a = insight.anomalies[0];
            appendMsg("agent", `⚠️ **Anomaly detected** in ${a.column}: value ${a.value} is ${a.zScore}σ ${a.direction} the mean (${a.mean}).`);
          }

          if (insight.followUps?.length) {
            await sleep(150);
            appendMsg("agent", `💡 **Follow-up ideas:**\n${insight.followUps.map((f, i) => `${i + 1}. ${f}`).join("\n")}`);
          }
        } else {
          // Standard streaming chat — always include screenshot on known platforms
          // so the agent can see the current UI state (visual awareness)
          const autoShot = platform !== "unknown";
          const useShot  = opts.withScreenshot || autoShot;
          const { appendToken, finalize } = appendStreamBubble();
          const result = await agentLoop.chat(msg, {
            withScreenshot: useShot,
            onToken: appendToken
          });
          finalize(result.text, {
            screenshot: useShot ? result.screenshot : undefined,  // show thumbnail whenever screenshot was used
            rows: result.json?.rows
          });

          // If response contains DAX, offer to insert
          if (/```dax/i.test(result.text) && platform === "power_bi") {
            await sleep(200);
            appendMsg("agent", `💡 I wrote a DAX measure. Say **"insert that measure"** to apply it via the Power BI API (or DOM if no token), or **"test this"** to run it as a query.`);
          }
        }

        // Save conversation history after every turn
        scheduleHistorySave();
      }

      setStatus("green", "Ready");
    } catch (err) {
      if (err.name === "AbortError") {
        // User clicked Stop — already handled by the stop button handler
        return;
      }
      hideThinking();
      removeProgress(_progressEl); _progressEl = null;
      appendMsg("agent", `❌ Error: ${err.message}\n\nMake sure the proxy is running:\n\`node tools/anthropic-proxy/server.js\``);
      setStatus("red", err.message.slice(0, 50));
    } finally {
      running = false;
      $sendBtn.disabled = false;
      $sendBtn.style.display = "grid";
      $stopBtn.style.display = "none";
    }
  }

  // ── Quick actions ────────────────────────────────────────────────────────────

  async function runAction(action) {
    switchTab("chat");

    switch (action) {

      case "new-measure": {
        const goal = await ask("Describe the measure you want (e.g. 'Total Revenue as sum of Sales[Amount]'):");
        if (!goal) return;
        appendMsg("user", `Create a measure: ${goal}`);
        await send(`Create a DAX measure: ${goal}. Then insert it into Power BI.`, { silent: true, execute: true });
        break;
      }

      case "audit-visuals":
        await send("Audit all visuals on this page — identify issues with chart types, field selections, missing labels, truncated data, and anything visually wrong.", { withScreenshot: true });
        break;

      case "check-dax": {
        const state = await getPageState();
        const dax   = state?.formulaBarDax || state?.measureEditorDax;
        if (dax) {
          await send(`Audit this DAX measure:\n\`\`\`\n${dax}\n\`\`\`\nCheck for correctness, performance issues, and best-practice violations.`);
        } else {
          appendMsg("agent", "⚠️ No DAX found in the formula bar. Select a measure first.");
        }
        break;
      }

      case "model-review": {
        const state = await getPageState();
        const tables = state?.fields?.tables || [];
        if (tables.length) {
          const summary = tables.slice(0, 15).map(t =>
            `${t.name}: ${t.fields.slice(0, 10).join(", ")}`
          ).join("\n");
          await send(`Review my data model:\n${summary}\n\nIdentify: grain issues, missing relationships, denormalization, naming problems, missing date table.`);
        } else {
          await send("Review my data model and identify any structural issues.", { withScreenshot: true });
        }
        break;
      }

      case "gen-sql": {
        const desc = await ask("Describe the SQL query you need:");
        if (!desc) return;
        await send(`Write a production-quality SQL query: ${desc}`);
        break;
      }

      case "run-sql": {
        const sql = await ask("Enter a SQL SELECT query to execute:");
        if (!sql) return;
        appendMsg("user", `Run SQL: ${sql.length > 80 ? sql.slice(0, 77) + "…" : sql}`);
        await runSqlQuery(sql);
        break;
      }

      case "screenshot-analyze":
        await send("Analyze this screenshot — describe the data, visuals, chart types, and any issues you see.", { withScreenshot: true, silent: true });
        if (!document.getElementById("thinking")) appendMsg("user", "📷 Screenshot & analyze");
        break;

      case "run-dax-query": {
        const dax = await ask("Enter a DAX EVALUATE query to run against the dataset:");
        if (!dax) return;
        appendMsg("user", `Run DAX query: ${dax}`);
        setStatus("orange", "Running query…", true);
        const state  = await getPageState();
        if (!agentLoop) buildLoop();
        agentLoop.tabId = activeTabId;
        const result = await agentLoop.executeDaxQuery(
          { _pbiIds: { workspaceId: pbiApiState.workspaceId, reportId: pbiApiState.reportId } },
          dax
        );
        if (result?.ok) {
          appendMsg("agent", `Query returned ${result.result?.length || 0} row(s):`, { rows: result.result || [] });
        } else {
          appendMsg("agent", `❌ Query failed: ${result?.error}`);
        }
        setStatus("green", "Ready");
        break;
      }

      case "agent-goal": {
        const goal = await ask("Describe your goal — I'll plan and execute each step:");
        if (!goal) return;
        appendMsg("user", goal);
        await send(goal, { silent: true, execute: true });
        break;
      }

      // ── Tableau actions ──────────────────────────────────────────────────────

      case "tableau-state": {
        switchTab("chat");
        appendMsg("user", "📊 Get Tableau viz state");
        setStatus("orange", "Reading viz…", true);
        const r = await relay({ type: "TABLEAU_GET_STATE" });
        if (r?.ok) {
          const s = r.result || {};
          let msg = `**Tableau Viz State**\n`;
          msg += `Sheet: ${s.activeSheet || "?"} (${s.sheetType || "?"})\n`;
          if (s.sheets?.length) msg += `Sheets: ${s.sheets.map(sh => sh.name || sh).join(", ")}\n`;
          if (s.filters?.length) msg += `Filters (${s.filters.length}):\n${s.filters.map(f => `  • ${f.fieldName}: ${(f.appliedValues || []).join(", ") || "all"}`).join("\n")}\n`;
          if (s.parameters?.length) msg += `Parameters:\n${s.parameters.map(p => `  • ${p.name} = ${p.currentValue?.formattedValue || p.currentValue?.value || "?"}`).join("\n")}`;
          appendMsg("agent", msg);
        } else {
          appendMsg("agent", `⚠️ ${r?.error || "Tableau adapter not found — are you on a Tableau page?"}`);
        }
        setStatus("green", "Ready");
        break;
      }

      case "tableau-filter": {
        const fieldName = await ask("Field name to filter (e.g. Region):");
        if (!fieldName) return;
        const vals = await ask("Values to apply (comma-separated, e.g. East,West):");
        if (vals === null) return;
        const values = vals.split(",").map(v => v.trim()).filter(Boolean);
        switchTab("chat");
        appendMsg("user", `Filter Tableau: ${fieldName} = ${values.join(", ")}`);
        setStatus("orange", "Applying filter…", true);
        const r = await relay({ type: "TABLEAU_APPLY_FILTER", fieldName, values, updateType: "replace" });
        appendMsg("agent", r?.ok ? `✅ Filter applied: **${fieldName}** = ${values.join(", ")}` : `⚠️ ${r?.error}`);
        setStatus("green", "Ready");
        break;
      }

      case "tableau-navigate": {
        const sheetName = await ask("Sheet name to navigate to:");
        if (!sheetName) return;
        switchTab("chat");
        appendMsg("user", `Navigate to sheet: ${sheetName}`);
        setStatus("orange", "Navigating…", true);
        const r = await relay({ type: "TABLEAU_ACTIVATE_SHEET", name: sheetName });
        appendMsg("agent", r?.ok ? `✅ Activated sheet: **${sheetName}**` : `⚠️ ${r?.error}`);
        setStatus("green", "Ready");
        break;
      }

      case "tableau-parameter": {
        const paramName = await ask("Parameter name:");
        if (!paramName) return;
        const paramVal  = await ask(`New value for "${paramName}":`);
        if (paramVal === null) return;
        switchTab("chat");
        appendMsg("user", `Set parameter: ${paramName} = ${paramVal}`);
        setStatus("orange", "Setting parameter…", true);
        const r = await relay({ type: "TABLEAU_SET_PARAMETER", name: paramName, value: paramVal });
        appendMsg("agent", r?.ok ? `✅ Parameter **${paramName}** set to **${paramVal}**` : `⚠️ ${r?.error}`);
        setStatus("green", "Ready");
        break;
      }

      case "tableau-export": {
        switchTab("chat");
        appendMsg("user", "🖼️ Export Tableau view as image");
        setStatus("orange", "Exporting…", true);
        const r = await relay({ type: "TABLEAU_EXPORT_IMAGE" });
        appendMsg("agent", r?.ok ? `✅ Export triggered (method: ${r.result?.method || "api"}). Check your downloads.` : `⚠️ ${r?.error}`);
        setStatus("green", "Ready");
        break;
      }

      default:
        appendMsg("agent", `Unknown action: ${action}`);
    }
  }

  // ── Slack notification helper ─────────────────────────────────────────────────

  async function sendSlackNotification(message, extra = {}) {
    if (!slackWebhook) return { ok: false, error: "No Slack webhook configured in Settings" };
    try {
      const res = await fetch(`${proxyEndpoint}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: slackWebhook, message, ...extra }),
        signal: AbortSignal.timeout(10_000)
      });
      return await res.json();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function getPageState() {
    if (!activeTabId) return null;
    const r = await relay({ type: "ADAPTER_GET_STATE" });
    return r?.ok ? r.state : null;
  }

  function ask(prompt) {
    return new Promise(resolve => resolve(window.prompt(prompt)));
  }

  // ── KPI registry ─────────────────────────────────────────────────────────────

  function renderKpis() {
    $kpiList.innerHTML = "";
    if (!kpis.length) {
      $kpiList.innerHTML = `<div style="color:var(--muted);font-size:11px;padding:8px 0">No KPIs yet.</div>`;
      return;
    }
    kpis.forEach(k => {
      const el = document.createElement("div");
      el.className = "kpi-card";
      el.innerHTML = `
        <div class="kpi-name">${escHtml(k.name)}</div>
        <div class="kpi-dax">${escHtml(k.dax || "")}</div>
        ${k.definition ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${escHtml(k.definition)}</div>` : ""}
        <div class="kpi-actions">
          <button data-a="insert" data-id="${k.id}">Insert DAX</button>
          <button data-a="query"  data-id="${k.id}">Run Query</button>
          <button data-a="chat"   data-id="${k.id}">Discuss</button>
          <button data-a="delete" data-id="${k.id}" class="danger">Delete</button>
        </div>`;
      $kpiList.appendChild(el);
    });
  }

  function saveKpis() {
    chrome.storage.local.set({ kpiRegistry: kpis });
  }

  function addKpi() {
    const name = $kpiName.value.trim();
    if (!name) { alert("Name required"); return; }
    const threshold = parseFloat(document.getElementById("kpi-threshold")?.value);
    const direction = document.getElementById("kpi-direction")?.value || "below";
    const kpi = {
      id:         `kpi-${Date.now()}`,
      name,
      table:      $kpiTable.value.trim(),
      dax:        $kpiDax.value.trim(),
      definition: $kpiDef.value.trim(),
      createdAt:  new Date().toISOString(),
      // Monitoring config (background.js reads this)
      monitoring: isNaN(threshold) ? null : {
        enabled:   true,
        threshold,
        direction,
        pbiIds: {
          workspaceId: pbiApiState.workspaceId || null,
          datasetId:   pbiApiState.datasetId   || null
        }
      }
    };
    kpis.push(kpi);
    saveKpis();
    chrome.runtime.sendMessage({ type: "SAVE_KPI", kpi });
    renderKpis();
    $kpiName.value = $kpiTable.value = $kpiDax.value = $kpiDef.value = "";
    const tEl = document.getElementById("kpi-threshold");
    if (tEl) tEl.value = "";
  }

  async function handleKpiAction(action, id) {
    const kpi = kpis.find(k => k.id === id);
    if (!kpi) return;

    if (action === "insert") {
      if (!kpi.dax) { appendMsg("agent", "This KPI has no DAX."); return; }
      switchTab("chat");
      // Try Power BI API first, then DOM fallback
      if (pbiApiState.hasToken && pbiApiState.workspaceId && kpi.table) {
        setStatus("orange", "Creating measure via API…", true);
        const state = { _pbiIds: pbiApiState };
        if (!agentLoop) buildLoop();
        agentLoop.tabId = activeTabId;
        const r = await agentLoop.createMeasureViaApi(state, kpi.name, kpi.dax);
        appendMsg("agent", r?.ok
          ? `✅ "${kpi.name}" created via Power BI API in table "${kpi.table}".`
          : `⚠️ API failed (${r?.error}). Trying DOM insert…`
        );
        if (!r?.ok) domInsertDax(kpi.dax);
      } else {
        domInsertDax(kpi.dax);
      }
      setStatus("green", "Ready");
      return;
    }

    if (action === "query") {
      if (!kpi.dax) { appendMsg("agent", "No DAX to query."); return; }
      switchTab("chat");
      appendMsg("user", `Run query for KPI: ${kpi.name}`);
      setStatus("orange", "Running query…", true);
      if (!agentLoop) buildLoop();
      agentLoop.tabId = activeTabId;
      const q = `EVALUATE TOPN(10, SUMMARIZECOLUMNS("Value", [${kpi.name}]))`;
      const result = await agentLoop.executeDaxQuery(
        { _pbiIds: pbiApiState },
        q
      );
      if (result?.ok) {
        appendMsg("agent", `Results for **${kpi.name}**:`, { rows: result.result || [] });
      } else {
        appendMsg("agent", `❌ Query error: ${result?.error}`);
      }
      setStatus("green", "Ready");
      return;
    }

    if (action === "chat") {
      switchTab("chat");
      send(`Tell me about the KPI "${kpi.name}": ${kpi.definition || ""}\nDAX: ${kpi.dax || "(none)"}\nExplain best practices, potential issues, and related measures.`);
      return;
    }

    if (action === "delete") {
      kpis = kpis.filter(k => k.id !== id);
      saveKpis();
      chrome.runtime.sendMessage({ type: "DELETE_KPI", id });
      renderKpis();
    }
  }

  function domInsertDax(dax) {
    relay({ type: "ADAPTER_WRITE_DAX", dax })
      .then(r => appendMsg("agent", r?.ok ? "✅ DAX written to formula bar." : `⚠️ DOM insert failed: ${r?.error}`));
  }

  // ── SQL execution ─────────────────────────────────────────────────────────────

  async function runSqlQuery(sql) {
    const connectionString = await getStoredSqlConnection();
    if (!connectionString) {
      appendMsg("agent",
        "⚠️ No SQL connection string configured.\n\nGo to the **Settings** tab and enter your connection string, e.g.:\n" +
        "• `postgresql://user:pass@host:5432/dbname`\n" +
        "• `mysql://user:pass@host:3306/dbname`\n" +
        "• `mssql://user:pass@host/dbname`"
      );
      return;
    }

    setStatus("orange", "Running query…", true);
    try {
      const res = await fetch(`${proxyEndpoint}/query-sql`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ connectionString, sql, maxRows: 500 }),
        signal:  AbortSignal.timeout(35_000)
      });
      const data = await res.json();
      if (data.ok) {
        // Convert columnar result to rows-of-objects for appendMsg
        const { columns = [], rows = [] } = data;
        const objects = rows.map(r =>
          Object.fromEntries(columns.map((c, i) => [c, r[i]]))
        );
        appendMsg("agent",
          `Query returned **${data.rowCount ?? rows.length}** row(s):`,
          { rows: objects }
        );
      } else {
        appendMsg("agent", `❌ SQL error: ${data.error}`);
      }
    } catch (err) {
      appendMsg("agent", `❌ ${err.message}`);
    } finally {
      setStatus("green", "Ready");
    }
  }

  function getStoredSqlConnection() {
    return new Promise(resolve =>
      chrome.storage.local.get("pbiSettings", r =>
        resolve(r.pbiSettings?.sqlConnection || "")
      )
    );
  }

  // ── Tab switching ─────────────────────────────────────────────────────────────
  function switchTab(name) {
    document.querySelectorAll(".tab-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach(p =>
      p.classList.toggle("active", p.id === `tab-${name}`));
  }

  // ── Events ────────────────────────────────────────────────────────────────────

  $sendBtn.addEventListener("click",  () => send());
  $input.addEventListener("keydown",  e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  $input.addEventListener("input",    () => autoResize($input));

  $stopBtn.addEventListener("click", () => {
    if (!running) return;
    agentLoop?.abort();
    hideThinking();
    removeProgress(_progressEl); _progressEl = null;
    appendMsg("agent", "⏹ Stopped.");
    setStatus("green", "Ready");
    running = false;
    $sendBtn.disabled = false;
    $sendBtn.style.display = "grid";
    $stopBtn.style.display = "none";
  });

  document.getElementById("narrate-btn")?.addEventListener("click", narrateReport);

  $shotBtn.addEventListener("click",  () => send("Analyze this screenshot — describe what you see, the data shown, any issues.", { withScreenshot: true }));
  $scanBtn.addEventListener("click",  async () => {
    const state = await getPageState();
    if (!state) { appendMsg("agent", "⚠️ Content script not loaded. Refresh the page."); return; }
    const errors = state.errors?.filter(e => e.type !== "loading") || [];
    let msg = `**Page scan — ${PLATFORM_LABELS[state.platform] || state.platform}**\n`;
    if (state.mode)   msg += `Mode: ${state.mode}\n`;
    if (state.page)   msg += `Page: ${state.page}\n`;
    if (state.pages?.length) msg += `Pages: ${state.pages.join(", ")}\n`;
    if (state.visuals?.length) msg += `Visuals: ${state.visuals.map(v => v.title).join(", ")}\n`;
    if (state.formulaBarDax) msg += `\nFormula bar:\n${state.formulaBarDax}\n`;
    if (errors.length) msg += `\n⚠️ Errors: ${errors.map(e => e.text).join("; ")}\n`;
    if (pbiApiState.hasToken) msg += `\n🔑 Power BI token captured (workspace: ${pbiApiState.workspaceId || "?"})`;
    appendMsg("agent", msg);
  });

  document.querySelectorAll(".tab-btn").forEach(b =>
    b.addEventListener("click", () => {
      switchTab(b.dataset.tab);
      // Lazy-load workspace data on first visit
      if (b.dataset.tab === "workspace" && !wsDatasets.length) loadWorkspace();
      if (b.dataset.tab === "alerts") loadAlerts();
    }));

  document.getElementById("actions-panel").addEventListener("click", e => {
    const card = e.target.closest("[data-action]");
    if (card) runAction(card.dataset.action);
  });

  $addKpiBtn.addEventListener("click", addKpi);
  $kpiList.addEventListener("click", e => {
    const btn = e.target.closest("button[data-a]");
    if (btn) handleKpiAction(btn.dataset.a, btn.dataset.id);
  });

  // Tab/navigation tracking
  chrome.tabs?.onActivated?.addListener(() => setTimeout(refreshActiveTab, 300));
  chrome.tabs?.onUpdated?.addListener((id, info) => {
    if (id === activeTabId && info.status === "complete") setTimeout(refreshActiveTab, 800);
  });

  // ── Settings ──────────────────────────────────────────────────────────────────

  function loadSettingsUI(s) {
    if ($sProxy)        $sProxy.value        = s.proxyEndpoint  || "http://localhost:3003";
    if ($sApiKey)       $sApiKey.value       = s.apiKey         || "";
    if ($sSqlConn)      $sSqlConn.value      = s.sqlConnection  || "";
    if ($sSlackWebhook) $sSlackWebhook.value = s.slackWebhook   || "";
    if ($sAboutProxy)   $sAboutProxy.textContent = (s.proxyEndpoint || "localhost:3003").replace(/^https?:\/\//, "");
    renderKnowledgeList();
  }

  function renderKnowledgeList() {
    if (!$sKbList) return;
    $sKbList.innerHTML = "";
    if (!knowledge.length) {
      $sKbList.innerHTML = `<div style="font-size:11px;color:var(--muted)">No entries yet.</div>`;
      return;
    }
    knowledge.forEach((item, i) => {
      const el = document.createElement("div");
      el.style.cssText = "background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;display:flex;gap:8px;align-items:flex-start";
      el.innerHTML = `
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700">${escHtml(item.title)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(item.body)}</div>
        </div>
        <button data-kb-del="${i}" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;flex-shrink:0;padding:0">✕</button>`;
      $sKbList.appendChild(el);
    });
  }

  function saveSettings() {
    const newApiKey   = $sApiKey?.value.trim()        || "";
    const proxy       = $sProxy?.value.trim()         || "http://localhost:3003";
    const sqlConn     = $sSqlConn?.value.trim()       || "";
    const webhook     = $sSlackWebhook?.value.trim()  || "";

    proxyEndpoint = proxy;
    apiKey        = newApiKey;
    sqlConnection = sqlConn;
    slackWebhook  = webhook;
    if (agentLoop)       { agentLoop.proxy = proxy; agentLoop.apiKey = newApiKey; }
    if (insightEngine)   { insightEngine.proxy = proxy; insightEngine.apiKey = newApiKey; insightEngine.sqlConn = sqlConn; }

    const s = {
      settingsVersion: 4,
      proxyEndpoint:   proxy,
      apiKey:          newApiKey,
      sqlConnection:   sqlConn,
      slackWebhook:    webhook,
      aiMode:          "claude",
      activeSkills:    ["architect-mode","dax-expert","visual-design","semantic-model","kpi-glossary","performance","power-query","security-rls","service-ops"]
    };

    chrome.storage.local.set({ pbiSettings: s, pbiKnowledge: knowledge }, () => {
      if ($sAboutProxy) $sAboutProxy.textContent = proxy.replace(/^https?:\/\//, "");
      showSaveConfirm();
      checkProxy();
    });
  }

  function showSaveConfirm() {
    if (!$sSaveBtn) return;
    const orig = $sSaveBtn.textContent;
    $sSaveBtn.textContent = "✓ Saved";
    $sSaveBtn.style.background = "var(--green)";
    setTimeout(() => {
      $sSaveBtn.textContent = orig;
      $sSaveBtn.style.background = "";
    }, 1800);
  }

  async function testProxy() {
    if (!$sProxyStatus) return;
    const url = ($sProxy?.value.trim() || proxyEndpoint);
    $sProxyStatus.textContent = "Checking…";
    $sProxyStatus.style.color = "var(--muted)";
    try {
      const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
      const d = r.ok ? await r.json() : null;
      if (d) {
        const hasKey = !!($sApiKey?.value.trim() || apiKey);
        $sProxyStatus.textContent = hasKey
          ? `✓ Connected — model: ${d.model || "?"}, ready`
          : "⚠ Proxy online but no API key entered above.";
        $sProxyStatus.style.color = hasKey ? "var(--green)" : "var(--orange)";
      } else {
        $sProxyStatus.textContent = `✗ HTTP ${r.status}`;
        $sProxyStatus.style.color = "var(--red)";
      }
    } catch (e) {
      $sProxyStatus.textContent = `✗ Can't reach proxy: ${e.message.slice(0, 60)}`;
      $sProxyStatus.style.color = "var(--red)";
    }
  }

  // Settings event wiring
  $sSaveBtn?.addEventListener("click", saveSettings);
  $sTestBtn?.addEventListener("click", testProxy);

  $sKbAddBtn?.addEventListener("click", () => {
    const title = $sKbTitle?.value.trim();
    const body  = $sKbBody?.value.trim();
    if (!title || !body) return;
    knowledge.push({ title, body });
    renderKnowledgeList();
    if ($sKbTitle) $sKbTitle.value = "";
    if ($sKbBody)  $sKbBody.value  = "";
  });

  $sKbList?.addEventListener("click", e => {
    const btn = e.target.closest("[data-kb-del]");
    if (!btn) return;
    const i = Number(btn.dataset.kbDel);
    knowledge.splice(i, 1);
    renderKnowledgeList();
  });

  document.getElementById("s-proxy-start-hint")?.addEventListener("click", e => {
    e.preventDefault();
    switchTab("chat");
    appendMsg("agent", `**How to start the proxy:**\n\n1. Open Terminal in the extension folder\n2. Run: \`cd tools/anthropic-proxy\`\n3. Run: \`node server.js\`\n4. The proxy listens on port 3003\n\nOr on Windows, double-click \`tools/anthropic-proxy/start.ps1\`\n\nMake sure your API key is saved in Settings first — the proxy will read it from the request.`);
  });

  // ── Report narration ──────────────────────────────────────────────────────────

  async function narrateReport() {
    if (running) return;
    if (!activeTabId) { appendMsg("agent", "⚠️ No active tab."); return; }

    switchTab("chat");
    appendMsg("user", "📖 Narrate all report pages");
    running = true;
    $sendBtn.disabled = true;

    const pageState = await getPageState();
    const pages = pageState?.pages || [];
    const screenshots = [];
    setStatus("orange", "Capturing pages…", true);

    if (!pages.length) {
      // Single-page capture
      const shot = await new Promise(r => chrome.runtime.sendMessage({ type: "SCREENSHOT_TAB", tabId: activeTabId }, r));
      if (shot?.ok) screenshots.push({ pageName: pageState?.page || "Page 1", screenshot: shot.dataUrl });
    } else {
      // Multi-page: navigate each tab and capture
      for (const pageName of pages.slice(0, 8)) {
        // Click the page tab
        await relay({ type: "EXECUTOR_RUN_PLAN", plan: { steps: [{ type: "click", target: `text=${pageName}`, reason: `Navigate to page ${pageName}` }] } });
        await sleep(1200);
        const shot = await new Promise(r => chrome.runtime.sendMessage({ type: "SCREENSHOT_TAB", tabId: activeTabId }, r));
        if (shot?.ok) screenshots.push({ pageName, screenshot: shot.dataUrl });
      }
    }

    if (!screenshots.length) {
      appendMsg("agent", "⚠️ Could not capture any pages.");
      running = false; $sendBtn.disabled = false; setStatus("green", "Ready");
      return;
    }

    setStatus("orange", `Analyzing ${screenshots.length} page(s)…`, true);
    try {
      if (!insightEngine) buildInsightEngine();
      const result = await insightEngine.narrateReport(screenshots, { style: "executive" });
      appendMsg("agent", result.narrative || "(no narrative generated)", {
        screenshot: screenshots[screenshots.length - 1]?.screenshot
      });
    } catch (e) {
      appendMsg("agent", `❌ Narration failed: ${e.message}`);
    } finally {
      running = false; $sendBtn.disabled = false; setStatus("green", "Ready");
    }
  }

  // ── Alerts ────────────────────────────────────────────────────────────────────

  function loadAlerts() {
    chrome.runtime.sendMessage({ type: "GET_ALERTS" }, resp => {
      const alerts = resp?.alerts || [];
      renderAlerts(alerts);
      const activeCount = alerts.filter(a => a.triggered).length;
      if ($alertsBadge) {
        $alertsBadge.textContent = activeCount;
        $alertsBadge.style.display = activeCount > 0 ? "inline" : "none";
      }
    });
  }

  function renderAlerts(alerts) {
    if (!$alertList) return;
    const active = alerts.filter(a => a.triggered);
    if (!active.length) {
      $alertList.innerHTML = `<div style="color:var(--muted);font-size:11px">No active alerts — all KPIs are within thresholds.</div>`;
      return;
    }
    $alertList.innerHTML = active.map(a => `
      <div style="background:var(--surface);border:1px solid var(--red);border-radius:8px;padding:10px 12px;display:flex;gap:8px;align-items:flex-start">
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:var(--red)">⚠️ ${escHtml(a.kpiName)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${escHtml(a.reason)}</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">${a.checkedAt ? new Date(a.checkedAt).toLocaleString() : ""}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button data-clear-alert="${escHtml(a.kpiId)}" style="font-size:10px;background:none;border:1px solid var(--border);color:var(--muted);border-radius:5px;padding:2px 8px;cursor:pointer">Dismiss</button>
          <button data-investigate="${escHtml(a.kpiId)}" style="font-size:10px;background:none;border:1px solid var(--accent2);color:var(--accent2);border-radius:5px;padding:2px 8px;cursor:pointer">Investigate</button>
        </div>
      </div>`).join("");

    // Show history
    const all = alerts.filter(a => a.checkedAt);
    if ($alertHistory && all.length) {
      $alertHistory.innerHTML = all.map(a => `<div style="padding:4px 0;border-bottom:1px solid var(--border)">${escHtml(a.kpiName)} — last: ${a.lastValue ?? "?"} @ ${new Date(a.checkedAt).toLocaleString()}</div>`).join("");
    }
  }

  function loadMonitoringUI(s) {
    if (!$monitoringEnabled) return;
    const m = s.monitoring || {};
    $monitoringEnabled.checked = m.enabled || false;
    if ($monitoringInterval && m.intervalMinutes) $monitoringInterval.value = m.intervalMinutes;
  }

  // Alerts tab event wiring
  $alertList?.addEventListener("click", async e => {
    const clearBtn = e.target.closest("[data-clear-alert]");
    if (clearBtn) {
      const kpiId = clearBtn.dataset.clearAlert;
      chrome.runtime.sendMessage({ type: "CLEAR_ALERT", kpiId }, () => loadAlerts());
    }
    const invBtn = e.target.closest("[data-investigate]");
    if (invBtn) {
      const kpi = kpis.find(k => k.id === invBtn.dataset.investigate);
      if (kpi) {
        switchTab("chat");
        await send(`Investigate the KPI "${kpi.name}": it has triggered an alert. Current value: analyze it, check recent trends, and identify what might have caused the change.`, { silent: true });
      }
    }
  });

  $monitoringEnabled?.addEventListener("change", () => {
    chrome.runtime.sendMessage({
      type: "SET_MONITORING",
      enabled: $monitoringEnabled.checked,
      intervalMinutes: Number($monitoringInterval?.value) || 30
    });
  });

  $monitoringInterval?.addEventListener("change", () => {
    if ($monitoringEnabled?.checked) {
      chrome.runtime.sendMessage({
        type: "SET_MONITORING",
        enabled: true,
        intervalMinutes: Number($monitoringInterval.value) || 30
      });
    }
  });

  $runMonitorNow?.addEventListener("click", () => {
    $runMonitorNow.textContent = "Running…";
    chrome.runtime.sendMessage({ type: "RUN_KPI_MONITOR_NOW" }, () => {
      $runMonitorNow.textContent = "Run now";
      loadAlerts();
    });
  });

  // ── Workspace ─────────────────────────────────────────────────────────────────

  async function loadWorkspace() {
    if (!pbiApiState.workspaceId) {
      $wsDatasets.textContent = "Open a Power BI report first to load workspace data.";
      return;
    }
    $wsDatasets.textContent = "Loading…";
    $wsReports.textContent  = "Loading…";

    try {
      const [dsResp, rpResp] = await Promise.all([
        relay({ type: "PBI_API_LIST_DATASETS",  params: { workspaceId: pbiApiState.workspaceId } }),
        relay({ type: "PBI_API_LIST_REPORTS",   params: { workspaceId: pbiApiState.workspaceId } })
      ]);

      wsDatasets = dsResp?.result?.value || [];
      const reports  = rpResp?.result?.value || [];

      // Render datasets
      if (wsDatasets.length) {
        $wsDatasets.innerHTML = wsDatasets.map(d => `
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px">
            <div style="font-size:12px;font-weight:700">${escHtml(d.name)}</div>
            <div style="font-size:10px;color:var(--muted)">${escHtml(d.id)}</div>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button data-ds-refresh="${escHtml(d.id)}" style="font-size:10px;background:none;border:1px solid var(--border);color:var(--muted);border-radius:5px;padding:2px 8px;cursor:pointer">↻ Refresh</button>
              <button data-ds-history="${escHtml(d.id)}" style="font-size:10px;background:none;border:1px solid var(--border);color:var(--muted);border-radius:5px;padding:2px 8px;cursor:pointer">History</button>
            </div>
          </div>`).join("");

        // Populate dataset selects (schema, PQ, and RLS)
        const opts = wsDatasets.map(d => `<option value="${escHtml(d.id)}">${escHtml(d.name)}</option>`).join("");
        if ($wsDatasetSelect) $wsDatasetSelect.innerHTML = `<option value="">Select…</option>` + opts;
        if ($wsPqDataset)     $wsPqDataset.innerHTML     = `<option value="">Dataset…</option>` + opts;
        if ($wsRlsDataset)    $wsRlsDataset.innerHTML    = `<option value="">Dataset…</option>` + opts;
      } else {
        $wsDatasets.textContent = "No datasets found in this workspace.";
      }

      // Render reports
      if (reports.length) {
        $wsReports.innerHTML = reports.map(r => `
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:12px;font-weight:700">${escHtml(r.name)}</div>
              <div style="font-size:10px;color:var(--muted)">${r.pages ? `${r.pages} pages` : ""}</div>
            </div>
            <a href="${escHtml(r.webUrl || "#")}" target="_blank" style="font-size:10px;color:var(--accent2);text-decoration:none">Open ↗</a>
          </div>`).join("");
      } else {
        $wsReports.textContent = "No reports found.";
      }
    } catch (e) {
      $wsDatasets.textContent = `Error: ${e.message}`;
    }
  }

  $wsRefreshBtn?.addEventListener("click", loadWorkspace);

  $wsDatasets?.addEventListener("click", async e => {
    const refreshBtn = e.target.closest("[data-ds-refresh]");
    const histBtn    = e.target.closest("[data-ds-history]");

    if (refreshBtn) {
      const dsId = refreshBtn.dataset.dsRefresh;
      refreshBtn.textContent = "Refreshing…";
      const r = await relay({ type: "PBI_API_REFRESH_DATASET", params: { workspaceId: pbiApiState.workspaceId, datasetId: dsId } });
      refreshBtn.textContent = r?.ok ? "✓ Triggered" : `✗ ${r?.error?.slice(0, 30) || "Failed"}`;
    }

    if (histBtn) {
      const dsId = histBtn.dataset.dsHistory;
      histBtn.textContent = "Loading…";
      const r = await relay({ type: "PBI_API_GET_REFRESH_HISTORY", params: { workspaceId: pbiApiState.workspaceId, datasetId: dsId } });
      histBtn.textContent = "History";
      const refreshes = r?.result?.value || [];
      if ($wsRefreshHistory) {
        if (refreshes.length) {
          $wsRefreshHistory.innerHTML = refreshes.slice(0, 5).map(rf => `
            <div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:11px">
              ${rf.status} — ${rf.endTime ? new Date(rf.endTime).toLocaleString() : rf.startTime || "?"}
              ${rf.serviceExceptionJson ? ` <span style="color:var(--red)">⚠️ Error</span>` : ""}
            </div>`).join("");
          $wsTriggerRefresh.style.display = "block";
          $wsTriggerRefresh.dataset.dsId = dsId;
        } else {
          $wsRefreshHistory.textContent = "No refresh history.";
        }
      }
    }
  });

  $wsTriggerRefresh?.addEventListener("click", async () => {
    const dsId = $wsTriggerRefresh.dataset.dsId;
    if (!dsId) return;
    $wsTriggerRefresh.textContent = "Triggering…";
    const r = await relay({ type: "PBI_API_REFRESH_DATASET", params: { workspaceId: pbiApiState.workspaceId, datasetId: dsId } });
    $wsTriggerRefresh.textContent = r?.ok ? "✓ Refresh started" : `✗ ${r?.error?.slice(0, 40)}`;
  });

  $wsLoadSchema?.addEventListener("click", async () => {
    const dsId = $wsDatasetSelect?.value;
    if (!dsId) return;
    $wsSchema.textContent = "Loading schema…";
    const r = await relay({ type: "PBI_API_GET_FULL_SCHEMA", params: { workspaceId: pbiApiState.workspaceId, datasetId: dsId } });
    const tables = r?.result || [];
    if (!tables.length) { $wsSchema.textContent = "No schema found."; return; }
    $wsSchema.innerHTML = tables.map(t => `
      <div style="margin-bottom:8px">
        <div style="font-size:12px;font-weight:700;color:var(--accent)">${escHtml(t.name)}</div>
        ${t.measures?.length ? `<div style="font-size:10px;color:var(--muted)">Measures: ${t.measures.map(m => escHtml(m.name)).join(", ")}</div>` : ""}
        ${t.columns?.length  ? `<div style="font-size:10px;color:var(--muted)">Columns: ${t.columns.map(c => escHtml(c.name)).join(", ")}</div>` : ""}
      </div>`).join("");

    // Ask Claude to analyze the schema
    appendMsg("agent", `📋 Loaded schema for **${wsDatasets.find(d => d.id === dsId)?.name || dsId}** — ${tables.length} table(s), ${tables.reduce((n, t) => n + (t.measures?.length || 0), 0)} measure(s), ${tables.reduce((n, t) => n + (t.columns?.length || 0), 0)} column(s).\n\nSay "analyze my data model" for an AI review.`);
  });

  // Power Query M editor
  $wsPqDataset?.addEventListener("change", async () => {
    const dsId = $wsPqDataset.value;
    if (!dsId) { $wsPqTable.innerHTML = "<option value=''>Table…</option>"; return; }
    $wsPqTable.innerHTML = "<option value=''>Loading…</option>";
    const r = await relay({ type: "PBI_API_GET_TABLES", params: { workspaceId: pbiApiState.workspaceId, datasetId: dsId } });
    wsTables = r?.result?.value || [];
    $wsPqTable.innerHTML = "<option value=''>Table…</option>" + wsTables.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join("");
  });

  $wsPqLoad?.addEventListener("click", async () => {
    const dsId = $wsPqDataset?.value;
    const tbl  = $wsPqTable?.value;
    if (!dsId || !tbl) return;
    $wsPqStatus.textContent = "Loading M expression…";
    const r = await relay({ type: "PBI_API_GET_TABLE_SOURCE", params: { workspaceId: pbiApiState.workspaceId, datasetId: dsId, tableName: tbl } });
    if (r?.result !== undefined) {
      $wsPqEditor.value = r.result || "(no M expression — this may be a calculated table)";
      $wsPqStatus.textContent = "";
    } else {
      $wsPqStatus.textContent = `Error: ${r?.error || "Could not load"}`;
    }
  });

  $wsPqAiFix?.addEventListener("click", async () => {
    const m = $wsPqEditor?.value.trim();
    if (!m) return;
    $wsPqStatus.textContent = "Asking AI to improve this M expression…";
    try {
      const res = await fetch(`${proxyEndpoint}/fallback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          type: "fallback",
          prompt: `You are a Power Query (M) expert. Review and fix or improve this M expression:\n\n${m}\n\nFix any errors, improve performance (use Table.Buffer where helpful, avoid unnecessary columns), and add comments. Return ONLY the improved M expression.`
        })
      });
      const data = await res.json();
      if (data.text) {
        $wsPqEditor.value = data.text.replace(/^```(?:m|powerquery)?\s*/i, "").replace(/```\s*$/, "").trim();
        $wsPqStatus.textContent = "✓ AI suggestions applied. Review before saving.";
      }
    } catch (e) {
      $wsPqStatus.textContent = `Error: ${e.message}`;
    }
  });

  $wsPqSave?.addEventListener("click", async () => {
    const dsId = $wsPqDataset?.value;
    const tbl  = $wsPqTable?.value;
    const m    = $wsPqEditor?.value.trim();
    if (!dsId || !tbl || !m) { $wsPqStatus.textContent = "Select dataset, table, and enter M expression."; return; }
    if (!confirm(`Save M expression to table "${tbl}"? This will update the Power BI dataset source.`)) return;
    $wsPqStatus.textContent = "Saving…";
    const r = await relay({ type: "PBI_API_UPDATE_TABLE_SOURCE", params: { workspaceId: pbiApiState.workspaceId, datasetId: dsId, tableName: tbl, mExpression: m } });
    $wsPqStatus.textContent = r?.ok ? "✓ Saved. Trigger a dataset refresh to apply changes." : `✗ ${r?.error?.slice(0, 80)}`;
    if (r?.ok) {
      $wsTriggerRefresh.style.display = "block";
      $wsTriggerRefresh.dataset.dsId  = dsId;  // ensure the button knows which dataset to refresh
    }
  });


  // ── Cross-workspace switcher ──────────────────────────────────────────────────

  $wsLoadWorkspaces?.addEventListener("click", async () => {
    if ($wsWorkspaceSelect) $wsWorkspaceSelect.innerHTML = `<option value="">Loading…</option>`;
    const r = await relay({ type: "PBI_API_LIST_WORKSPACES", params: {} });
    const workspaces = r?.result?.value || [];
    if (!workspaces.length) {
      if ($wsWorkspaceSelect) $wsWorkspaceSelect.innerHTML = `<option value="">No workspaces found</option>`;
      return;
    }
    const opts = workspaces.map(w =>
      `<option value="${escHtml(w.id)}" ${w.id === pbiApiState.workspaceId ? "selected" : ""}>${escHtml(w.name)}</option>`
    ).join("");
    if ($wsWorkspaceSelect) $wsWorkspaceSelect.innerHTML = `<option value="">Current workspace</option>` + opts;
    // Also populate RLS dataset select
    if ($wsRlsDataset) {
      const dsOpts = wsDatasets.map(d => `<option value="${escHtml(d.id)}">${escHtml(d.name)}</option>`).join("");
      $wsRlsDataset.innerHTML = `<option value="">Dataset…</option>` + dsOpts;
    }
  });

  $wsSwitchWorkspace?.addEventListener("click", () => {
    const wid = $wsWorkspaceSelect?.value;
    if (!wid) { return; }
    pbiApiState.workspaceId = wid;
    pbiApiState.datasetId   = null;
    pbiApiState.reportId    = null;
    appendMsg("agent", `🏢 Switched to workspace ID: **${wid}**. Loading data…`);
    loadWorkspace();
  });

  // ── RLS management events ─────────────────────────────────────────────────────

  $wsRlsLoad?.addEventListener("click", async () => {
    const dsId = $wsRlsDataset?.value;
    if (!dsId) { if ($wsRlsStatus) $wsRlsStatus.textContent = "Select a dataset first."; return; }
    if ($wsRlsRoles) $wsRlsRoles.textContent = "Loading RLS roles…";
    if ($wsRlsStatus) $wsRlsStatus.textContent = "";

    const [rolesResp, usersResp] = await Promise.all([
      relay({ type: "PBI_API_LIST_RLS_ROLES",  params: { datasetId: dsId } }),
      relay({ type: "PBI_API_LIST_DATASET_USERS", params: { workspaceId: pbiApiState.workspaceId, datasetId: dsId } })
    ]);

    const roles = rolesResp?.result || [];
    const users = usersResp?.result?.value || [];

    if (!$wsRlsRoles) return;

    const rolesHtml = roles.length
      ? `<div style="font-size:11px;font-weight:700;margin-bottom:4px">Roles defined in model (${roles.length}):</div>` +
        roles.map(r => `<div style="padding:3px 0;color:var(--text)">📋 ${escHtml(r.Name || r.Role || JSON.stringify(r))}</div>`).join("")
      : `<div style="color:var(--muted);font-size:11px">No RLS roles detected (INFO.ROLES() returned empty).</div>`;

    const usersHtml = users.length
      ? `<div style="font-size:11px;font-weight:700;margin:8px 0 4px">Dataset users (${users.length}):</div>` +
        users.map(u => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-size:11px">${escHtml(u.emailAddress || u.identifier || u.displayName || "?")}</div>
              <div style="font-size:10px;color:var(--muted)">${escHtml(u.datasetUserAccessRight || "")} · ${escHtml(u.principalType || "")}</div>
            </div>
            <button data-rls-remove-user="${escHtml(u.emailAddress || u.identifier || "")}" data-rls-dataset="${escHtml(dsId)}"
              style="font-size:10px;background:none;border:1px solid var(--border);color:var(--muted);border-radius:5px;padding:2px 8px;cursor:pointer">Remove</button>
          </div>`).join("")
      : `<div style="color:var(--muted);font-size:11px;margin-top:4px">No dataset users found.</div>`;

    $wsRlsRoles.innerHTML = rolesHtml + usersHtml;
  });

  // Remove user (event delegation on rls-roles container)
  $wsRlsRoles?.addEventListener("click", async e => {
    const btn = e.target.closest("[data-rls-remove-user]");
    if (!btn) return;
    const identifier = btn.dataset.rlsRemoveUser;
    const dsId       = btn.dataset.rlsDataset || $wsRlsDataset?.value;
    if (!identifier || !dsId) return;
    if (!confirm(`Remove "${identifier}" from this dataset?`)) return;
    btn.textContent = "Removing…";
    const r = await relay({ type: "PBI_API_REMOVE_DATASET_USER", params: { workspaceId: pbiApiState.workspaceId, datasetId: dsId, identifier } });
    if (r?.ok) {
      btn.closest("div[style]")?.remove();
      if ($wsRlsStatus) $wsRlsStatus.textContent = `✓ Removed ${identifier}`;
    } else {
      btn.textContent = "Remove";
      if ($wsRlsStatus) $wsRlsStatus.textContent = `✗ ${r?.error?.slice(0, 60) || "Failed"}`;
    }
  });

  $wsRlsAddUser?.addEventListener("click", async () => {
    const dsId      = $wsRlsDataset?.value;
    const username  = $wsRlsUsername?.value.trim();
    if (!dsId)     { if ($wsRlsStatus) $wsRlsStatus.textContent = "Select a dataset first."; return; }
    if (!username) { if ($wsRlsStatus) $wsRlsStatus.textContent = "Enter a user email."; return; }
    if ($wsRlsStatus) $wsRlsStatus.textContent = "Adding user…";
    const r = await relay({
      type:   "PBI_API_ADD_DATASET_USER",
      params: { workspaceId: pbiApiState.workspaceId, datasetId: dsId, identifier: username, principalType: "User", datasetUserAccessRight: "Read" }
    });
    if ($wsRlsStatus) $wsRlsStatus.textContent = r?.ok ? `✓ Added ${username} as Reader.` : `✗ ${r?.error?.slice(0, 80) || "Failed"}`;
    if (r?.ok && $wsRlsUsername) $wsRlsUsername.value = "";
  });

  $wsRlsTest?.addEventListener("click", async () => {
    const dsId    = $wsRlsDataset?.value;
    const username = $wsRlsUsername?.value.trim();
    const roles    = ($wsRlsRolesInput?.value || "").split(",").map(r => r.trim()).filter(Boolean);
    if (!dsId || !username) {
      if ($wsRlsStatus) $wsRlsStatus.textContent = "Enter username and select dataset to test RLS.";
      return;
    }
    if ($wsRlsStatus) $wsRlsStatus.textContent = "Testing RLS identity…";
    const r = await relay({ type: "PBI_API_TEST_RLS", params: { workspaceId: pbiApiState.workspaceId, reportId: pbiApiState.reportId, username, roles } });
    if (r?.ok) {
      if ($wsRlsStatus) $wsRlsStatus.textContent = `✓ Token generated for "${username}"${roles.length ? ` with roles [${roles.join(", ")}]` : ""}. RLS identity is valid.`;
    } else {
      if ($wsRlsStatus) $wsRlsStatus.textContent = `✗ ${r?.error?.slice(0, 100) || "Test failed"}`;
    }
  });

  // RLS dataset select is synced inside loadWorkspace() — see below

  // Proxy: accept apiKey from extension settings
  // (the proxy already reads it from the body — see server.js callAnthropic)

  // ── Incoming messages from background / content scripts ──────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg?.type) return;

    // Tableau viz loaded in the active tab — refresh state
    if (msg.type === "TABLEAU_VIZ_LOADED") {
      const s = msg.state || {};
      platform = "tableau";
      updateBadge();
      if (s.activeSheet) setStatus("green", `Tableau: ${s.activeSheet}`);
      return;
    }

    // Background fired a KPI alert — deliver to Slack if configured
    if (msg.type === "KPI_ALERT") {
      loadAlerts();
      const { kpiName, value, threshold, direction, reason } = msg;
      if (slackWebhook) {
        const message = `⚠️ *KPI Alert: ${kpiName}*\n${reason || `Value: ${value} (threshold: ${threshold})`}`;
        sendSlackNotification(message, { kpiName, value, threshold, direction })
          .catch(() => {});
      }
      return;
    }
  });

  // ── Start ─────────────────────────────────────────────────────────────────────
  init();

})();
