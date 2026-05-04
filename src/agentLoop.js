/**
 * agentLoop.js — Observe → Act → Verify → Re-plan agent loop
 * Loaded in the side panel context (listed in sidepanel.html before sidepanel.js).
 *
 * The loop turns a single goal into reliable multi-step execution:
 *   1. Take initial screenshot + read page state
 *   2. Ask Claude to plan the steps (action_plan type)
 *   3. For each step:
 *        a. Execute the step via EXECUTOR_RUN_PLAN relay
 *        b. Wait for UI to settle
 *        c. Take a screenshot
 *        d. Ask Claude: "Did this work?" (verify type)
 *        e. If yes → next step
 *        f. If no → retry (up to maxRetries), then replan remaining steps
 *   4. Final screenshot + summary
 *
 * Events emitted to onEvent(type, data):
 *   "start"       { goal }
 *   "plan"        { plan }
 *   "step_start"  { step, stepIndex, total, attempt }
 *   "step_done"   { step, stepIndex, verification, screenshot }
 *   "step_fail"   { step, stepIndex, error, fatal }
 *   "step_retry"  { step, stepIndex, attempt }
 *   "replan"      { reason, newPlan }
 *   "pbi_api"     { action, result }
 *   "complete"    { ok, summary, log, screenshot }
 *   "error"       { error }
 */

window.AgentLoop = class AgentLoop {
  constructor({ proxyEndpoint, apiKey, tabId, knowledge, onEvent } = {}) {
    this.proxy      = proxyEndpoint || "http://localhost:3003";
    this.apiKey     = apiKey || "";
    this.tabId      = tabId;
    this.knowledge  = knowledge || [];
    this.onEvent    = typeof onEvent === "function" ? onEvent : () => {};
    this.aborted      = false;
    this.maxSteps     = 24;
    this.maxRetries   = 2;
    this.maxReplans   = 2;      // prevent infinite replan loops
    this._streamAbort = null;   // AbortController for the active /stream fetch
    // Conversation history for multi-turn context (text messages only)
    this.history      = [];
  }

  abort() {
    this.aborted = true;
    this._streamAbort?.abort();  // cancel any in-flight streaming request
  }
  emit(type, data) { this.onEvent(type, data); }

  // ── Proxy ────────────────────────────────────────────────────────────────────

  async callProxy(payload) {
    const res = await fetch(`${this.proxy}/fallback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        apiKey:              this.apiKey || undefined,
        knowledge:           this._selectKnowledge(payload.prompt || payload.goal || ""),
        // Never send conversation history to the planner — it biases Claude toward text responses
        conversationHistory: payload.type === "action_plan" ? [] : this.history.slice(-6)
      }),
      signal: AbortSignal.timeout(90_000)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Proxy ${res.status}`);
    }
    return res.json();
  }

  // ── Knowledge selection: skills ranked by trigger match, then user notes ──────

  _selectKnowledge(prompt = "") {
    const lower = prompt.toLowerCase();
    const skillKnowledge = [];

    try {
      const engine = (typeof window !== "undefined") && window.PowerBISkillEngine;
      if (engine?.skills?.length) {
        const scored = engine.skills
          .map(skill => ({
            skill,
            hits: (skill.triggers || []).filter(t => lower.includes(t.toLowerCase())).length
          }))
          .filter(s => s.hits > 0)
          .sort((a, b) => b.hits - a.hits)
          .slice(0, 3);

        for (const { skill } of scored) {
          const rules = (skill.rules || []).slice(0, 6).join(" ");
          const tplKeys = Object.keys(skill.templates || {});
          const templateHint = tplKeys.length
            ? `Template (${tplKeys[0]}): ${String(Object.values(skill.templates)[0]).slice(0, 300)}`
            : "";
          skillKnowledge.push({
            title: skill.name,
            body:  `${rules}${templateHint ? "\n" + templateHint : ""}`
          });
        }
      }
    } catch (_) { /* not available */ }

    const userKnowledge = (this.knowledge || []).slice(0, 8 - skillKnowledge.length);
    return [...skillKnowledge, ...userKnowledge];
  }

  // ── Chrome message helpers ────────────────────────────────────────────────────

  relay(payload) {
    return new Promise(resolve =>
      chrome.runtime.sendMessage(
        { type: "RELAY_TO_CONTENT", tabId: this.tabId, payload },
        r => resolve(r)
      )
    );
  }

  async screenshot() {
    return new Promise(resolve =>
      chrome.runtime.sendMessage({ type: "SCREENSHOT_TAB", tabId: this.tabId },
        r => resolve(r?.ok ? r.dataUrl : null)
      )
    );
  }

  async pageState() {
    const r = await this.relay({ type: "ADAPTER_GET_STATE" });
    return r?.ok ? r.state : null;
  }

  async pbiStatus() {
    const r = await this.relay({ type: "PBI_API_STATUS" });
    return r?.ok ? r : null;
  }

  async pbiApiCall(type, params) {
    const r = await this.relay({ type: `PBI_API_${type}`, params });
    return r;
  }

  // ── Planning ─────────────────────────────────────────────────────────────────

  async plan(goal, state, shot) {
    const ctx = this._stateContext(state);
    const result = await this.callProxy({
      type: "action_plan",
      goal,
      prompt: goal,
      screenshot: shot ? { dataUrl: shot } : undefined,
      context: {
        pageContext: ctx,
        platform:   state?.platform,
        hasToken:   state?._hasToken || false   // tells planner REST API is available
      }
    });
    // Valid plan = has steps array
    if (result.json?.steps?.length) return result.json;

    // Claude returned text instead of JSON — retry once with an explicit JSON-only override
    const retry = await this.callProxy({
      type: "action_plan",
      goal: `[IMPORTANT: You must return ONLY a JSON object with a "steps" array. No prose. No explanation. JSON only.]\n\nGoal: ${goal}`,
      prompt: goal,
      screenshot: shot ? { dataUrl: shot } : undefined,
      context: {
        pageContext: ctx,
        platform:   state?.platform,
        hasToken:   state?._hasToken || false
      }
    });
    if (retry.json?.steps?.length) return retry.json;

    // Still no plan — treat as a text-only response
    return { _textOnly: true, text: result.text || "(no response)" };
  }

  // ── Verification ─────────────────────────────────────────────────────────────

  async verify(step, afterShot) {
    // No screenshot means we can't confirm success — treat as unknown, retry
    if (!afterShot) return { success: false, confidence: 0, next_action: "retry", what_changed: "Screenshot unavailable" };

    const result = await this.callProxy({
      type: "vision",
      prompt: `I just executed this browser action:
  type: ${step.type}
  target: ${step.target || "n/a"}
  text/keys: ${step.text || step.keys || "n/a"}
  reason: ${step.reason || "n/a"}

Look at the current screen. Did this action succeed?

Return ONLY valid JSON (no markdown):
{
  "success": true,
  "confidence": 0.9,
  "what_changed": "description of what changed on screen",
  "next_action": "continue",
  "issue": ""
}

next_action values: "continue" (success), "retry" (try again), "replan" (need different approach), "abort" (unrecoverable).`,
      screenshot: { dataUrl: afterShot }
    });

    if (result.json && typeof result.json.success === "boolean") return result.json;

    // Fallback: heuristic from text
    const txt = (result.text || "").toLowerCase();
    const ok  = !txt.includes("fail") && !txt.includes("error") && !txt.includes("not found");
    return { success: ok, confidence: 0.55, next_action: ok ? "continue" : "retry", what_changed: result.text?.slice(0, 150) };
  }

  // ── Re-planning ───────────────────────────────────────────────────────────────

  async replan(goal, done, failed, stateDesc, shot) {
    const result = await this.callProxy({
      type: "action_plan",
      goal: `REPLAN: ${goal}
Already done: ${done.map(s => `${s.type}:${s.target || s.text || ""}`).join(" → ")}
Failed step: ${failed.type}:${failed.target || ""} — error: ${failed._error || "unknown"}
Current state: ${stateDesc}
Generate a corrective plan for the remaining work. Skip completed steps.`,
      screenshot: shot ? { dataUrl: shot } : undefined
    });
    return result.json?.steps?.length ? result.json : null;
  }

  // ── Power BI REST API: create measure (most reliable path) ──────────────────

  async createMeasureViaApi(state, name, expression, formatString) {
    const ids   = state?._pbiIds || {};
    const wid   = ids.workspaceId;
    const rid   = ids.reportId;
    if (!wid || !rid) {
      return { ok: false, error: "Workspace / report IDs not found in URL" };
    }

    // Get datasetId
    const dsResp = await this.pbiApiCall("GET_DATASET_ID", { workspaceId: wid, reportId: rid });
    if (!dsResp?.ok || !dsResp.result) {
      return { ok: false, error: `Could not get datasetId: ${dsResp?.error}` };
    }
    const datasetId = dsResp.result;

    // Get tables to find a suitable one (prefer first fact/measure table)
    const tablesResp = await this.pbiApiCall("GET_TABLES", { workspaceId: wid, datasetId });
    const tables = tablesResp?.result?.value || [];
    // Prefer a table that looks like a measure table or the first available
    const tableName = tables.find(t => /measure|kpi|calc/i.test(t.name))?.name
                   || tables[0]?.name
                   || "Sales"; // last resort

    const r = await this.pbiApiCall("CREATE_MEASURE", {
      workspaceId: wid, datasetId, tableName,
      name, expression, formatString: formatString || ""
    });

    this.emit("pbi_api", { action: "CREATE_MEASURE", result: r });
    return r;
  }

  // ── DAX query execution ───────────────────────────────────────────────────────

  async executeDaxQuery(state, daxQuery) {
    const ids = state?._pbiIds || {};
    const wid = ids.workspaceId;
    const rid = ids.reportId;
    if (!wid || !rid) return { ok: false, error: "Not on a Power BI report page" };

    const dsResp = await this.pbiApiCall("GET_DATASET_ID", { workspaceId: wid, reportId: rid });
    if (!dsResp?.ok) return { ok: false, error: dsResp?.error };

    const r = await this.pbiApiCall("EXECUTE_DAX", { datasetId: dsResp.result, query: daxQuery });
    return r;
  }

  // ── Main entry point ─────────────────────────────────────────────────────────

  async run(goal, opts = {}) {
    this.aborted = false;
    const log = [];

    this.emit("start", { goal });

    try {
      // Gather context
      const state  = await this.pageState();
      const pbiSt  = await this.pbiStatus();
      if (state && pbiSt) {
        state._pbiIds = { workspaceId: pbiSt.workspaceId, reportId: pbiSt.reportId };
        state._hasToken = pbiSt.hasToken;
      }

      const shot = opts.withScreenshot ? await this.screenshot() : null;

      // Generate plan
      const planResult = await this.plan(goal, state, shot);

      // Pure text response — not an action goal
      if (planResult._textOnly) {
        this.history.push({ role: "user",      content: goal });
        this.history.push({ role: "assistant", content: planResult.text });
        this.emit("complete", { ok: true, textOnly: true, text: planResult.text, log: [] });
        return { type: "text", text: planResult.text };
      }

      this.emit("plan", { plan: planResult });

      let steps        = planResult.steps.slice(0, this.maxSteps);
      let totalExpected = steps.length;   // updated on replan so allDone stays accurate
      let completed    = [];
      let i            = 0;
      let replanCount  = 0;

      while (i < steps.length && !this.aborted) {
        const step    = steps[i];
        let   success = false;
        let   attempt = 0;
        let   lastVer = null;
        let   lastShot = null;

        while (attempt <= this.maxRetries && !this.aborted) {
          this.emit("step_start", { step, stepIndex: i, total: steps.length, attempt });

          // ── Special: create measure via REST API if token available ──────────
          if (step.type === "write_dax" && state?._hasToken && step.text) {
            // step.text may be "MeasureName = DAX_expression" — parse it out
            let measureName = step.measureName || step.name || "New Measure";
            let expression  = step.text || "";
            const eqIdx = expression.indexOf("=");
            const looksLikeMeasureDef =
              eqIdx > 0 && !expression.trim().toUpperCase().startsWith("EVALUATE");
            if (looksLikeMeasureDef) {
              const parsedName = expression.slice(0, eqIdx).trim();
              if (parsedName) measureName = parsedName;
              expression = expression.slice(eqIdx + 1).trim();
            }

            const apiResult = await this.createMeasureViaApi(state, measureName, expression, step.formatString);
            if (apiResult?.ok) {
              log.push({ step, method: "pbi_api", result: apiResult });
              completed.push(step);
              this.emit("step_done", { step, stepIndex: i, method: "pbi_api", result: apiResult });
              success = true;

              // Skip any DOM follow-up steps that are only needed when editing via UI
              const domFollowUpTypes = new Set(["new_measure", "write_measure_name", "commit_formula", "open_formula_bar"]);
              while (i + 1 < steps.length && domFollowUpTypes.has(steps[i + 1]?.type)) {
                i++;
                completed.push(steps[i]); // mark as done (skipped)
                log.push({ step: steps[i], method: "skipped_after_api" });
              }
              break;
            }
            // API failed — fall through to DOM execution
          }

          // ── DOM execution ────────────────────────────────────────────────────
          const execResp = await this.relay({
            type: "EXECUTOR_RUN_PLAN",
            plan: { steps: [step] },
            options: { stepDelay: 300 }
          });
          const execResult = execResp?.results?.[0] || { ok: false, error: execResp?.error || "no response" };
          step._error = execResult.error;

          await sleep(600); // let UI settle

          // ── Screenshot + verify ──────────────────────────────────────────────
          lastShot = await this.screenshot();
          lastVer  = await this.verify(step, lastShot);

          log.push({ step, attempt, execResult, verification: lastVer, screenshot: lastShot });

          if (lastVer.success) {
            completed.push(step);
            this.emit("step_done", { step, stepIndex: i, verification: lastVer, screenshot: lastShot });
            success = true;
            break;
          }

          if (lastVer.next_action === "abort") {
            this.emit("step_fail", { step, stepIndex: i, error: lastVer.issue, fatal: true });
            const summary = `Aborted: ${lastVer.issue || execResult.error || "unrecoverable failure"}`;
            this.emit("complete", { ok: false, summary, log, screenshot: lastShot });
            return { type: "complete", ok: false, summary, log };
          }

          if (lastVer.next_action === "replan") break;

          attempt++;
          if (attempt <= this.maxRetries) {
            this.emit("step_retry", { step, stepIndex: i, attempt });
            await sleep(1200);
          }
        }

        if (!success) {
          const errMsg = step._error || "verification failed";
          this.emit("step_fail", { step, stepIndex: i, error: errMsg });

          // Connection errors mean the content script isn't available — abort immediately
          const isConnectionError = /receiving end does not exist|could not establish connection/i.test(errMsg);

          // Attempt to replan remaining steps (with a cap to prevent infinite loops)
          if (!isConnectionError && i < steps.length - 1 && replanCount < this.maxReplans) {
            const nowShot   = await this.screenshot();
            const nowState  = await this.pageState();
            const stateDesc = this._stateContext(nowState);
            const newPlan   = await this.replan(goal, completed, step, stateDesc, nowShot);

            if (newPlan?.steps?.length) {
              replanCount++;
              this.emit("replan", { reason: errMsg, newPlan });
              steps = newPlan.steps.slice(0, this.maxSteps - completed.length);
              totalExpected = completed.length + steps.length; // update expected total
              i = 0;
              continue;
            }
          }

          if (isConnectionError) {
            const summary = "⚠️ Content script not connected. Please refresh the page (F5) and try again.";
            this.emit("complete", { ok: false, summary, log });
            return { type: "complete", ok: false, summary, log };
          }

          break; // Can't recover
        }

        i++;
      }

      // ── Final summary ────────────────────────────────────────────────────────
      const finalShot = await this.screenshot();
      const allDone   = completed.length >= totalExpected;

      let summary = `Completed ${completed.length} of ${planResult.steps.slice(0, this.maxSteps).length} steps.`;
      try {
        const sumResp = await this.callProxy({
          type:   "vision",
          prompt: `Goal: "${goal}"\nCompleted steps: ${completed.map(s => s.reason || `${s.type}:${s.target || s.text || ""}`).join("; ")}\n\nLooking at the screen now, write 2–3 sentences summarising what was accomplished.`,
          screenshot: finalShot ? { dataUrl: finalShot } : undefined
        });
        if (sumResp.text) summary = sumResp.text;
      } catch (_) {}

      this.history.push({ role: "user",      content: goal });
      this.history.push({ role: "assistant", content: summary });

      this.emit("complete", { ok: allDone, summary, log, screenshot: finalShot });
      return { type: "complete", ok: allDone, summary, log, screenshot: finalShot };

    } catch (err) {
      this.emit("error", { error: err.message });
      return { type: "error", error: err.message };
    }
  }

  // ── Conversation-only (no actions) ───────────────────────────────────────────

  async chat(userMessage, opts = {}) {
    const state = await this.pageState();
    const ctx   = this._stateContext(state);
    const shot  = opts.withScreenshot ? await this.screenshot() : null;

    this.history.push({ role: "user", content: userMessage });

    // Use streaming if a token callback is provided
    if (typeof opts.onToken === "function") {
      const reply = await this._streamChat(userMessage, ctx, shot, state, opts.onToken);
      this.history.push({ role: "assistant", content: reply });
      return { text: reply, json: null, screenshot: shot };
    }

    const result = await this.callProxy({
      type:   shot ? "vision" : "fallback",
      prompt: userMessage + (ctx ? `\n\nPage context:\n${ctx}` : ""),
      screenshot: shot ? { dataUrl: shot } : undefined,
      context: { platform: state?.platform, url: state?.url || "" }
    });

    const reply = result.text || "(no response)";
    this.history.push({ role: "assistant", content: reply });
    return { text: reply, json: result.json, screenshot: shot };
  }

  // ── Streaming chat helper ─────────────────────────────────────────────────

  async _streamChat(userMessage, ctx, shot, state, onToken) {
    // Create a cancellable abort controller (90 s hard timeout + user stop)
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 90_000);
    this._streamAbort = controller;

    const payload = {
      type:   shot ? "vision" : "fallback",
      prompt: userMessage + (ctx ? `\n\nPage context:\n${ctx}` : ""),
      screenshot: shot ? { dataUrl: shot } : undefined,
      context: { platform: state?.platform, url: state?.url || "" },
      apiKey:              this.apiKey || undefined,
      knowledge:           this._selectKnowledge(userMessage),
      conversationHistory: this.history.slice(-6)
    };

    try {
      const res = await fetch(`${this.proxy}/stream`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
        signal:  controller.signal
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Stream ${res.status}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = "";
      let   fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          let evt;
          try { evt = JSON.parse(jsonStr); } catch (_) { continue; }

          if (evt.error) throw new Error(evt.error);
          if (evt.token) { fullText += evt.token; onToken(evt.token); }
          if (evt.done)  { fullText = evt.text || fullText; break; }
        }
      }

      return fullText || "(no response)";
    } finally {
      clearTimeout(timeoutId);
      this._streamAbort = null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  _stateContext(state) {
    if (!state) return "";
    const parts = [];
    if (state.platform)        parts.push(`Platform: ${state.platform}`);
    if (state.mode)            parts.push(`Mode: ${state.mode}`);
    if (state.page)            parts.push(`Page: ${state.page}`);
    if (state.pages?.length)   parts.push(`Pages: ${state.pages.slice(0, 5).join(", ")}`);
    if (state.visuals?.length) parts.push(`Visuals: ${state.visuals.slice(0, 5).map(v => v.title).join(", ")}`);
    if (state.formulaBarDax)   parts.push(`Formula bar: ${state.formulaBarDax.slice(0, 80)}`);
    if (state.editorText)      parts.push(`SQL editor: ${state.editorText.slice(0, 80)}`);
    return parts.join(" | ");
  }
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
