/**
 * insightEngine.js — Natural-language → data → insight pipeline
 * Loaded in sidepanel.html before sidepanel.js.
 *
 * Given a question like "Why did revenue drop last week?", this engine:
 *   1. Classifies: does answering this require querying data?
 *   2. If yes: asks Claude to write the right DAX or SQL query
 *   3. Executes the query (DAX via Power BI API, SQL via proxy)
 *   4. Asks Claude to interpret the result and answer the question
 *   5. Returns: { explanation, dataTable, followUps, anomalies }
 *
 * Also handles:
 *   - WoW / MoM / QoQ comparison generation
 *   - Anomaly detection on time-series data
 *   - Multi-step insight chains ("drill-down" when the first answer raises more questions)
 */

window.InsightEngine = class InsightEngine {
  constructor({ proxy, apiKey, pbiState, sqlConn, knowledge } = {}) {
    this.proxy     = proxy     || "http://localhost:3003";
    this.apiKey    = apiKey    || "";
    this.pbiState  = pbiState  || {};   // { hasToken, workspaceId, reportId, datasetId, platform }
    this.sqlConn   = sqlConn   || "";
    this.knowledge = knowledge || [];
  }

  // ── Core: answer a question that may need data ──────────────────────────────

  async answer(question, opts = {}) {
    const { pageContext = "", onToken, pbiRelay } = opts;

    // Step 1: classify + plan the query
    const plan = await this._planQuery(question, pageContext);

    if (!plan.needsData) {
      // Pure conceptual question — stream a direct answer
      return { type: "text", explanation: plan.answer };
    }

    // Step 2: generate the query
    const queryResult = await this._generateQuery(question, plan, pageContext);
    if (!queryResult.query) {
      return { type: "text", explanation: "I need to query data to answer this but couldn't build a suitable query. Could you share more context about your data model?" };
    }

    // Step 3: execute
    let dataTable = null;
    let execError = null;
    try {
      if (queryResult.queryType === "tableau" && pbiRelay) {
        dataTable = await this._executeTableau(pbiRelay);
      } else if (queryResult.queryType === "dax" && pbiRelay) {
        dataTable = await this._executeDax(queryResult.query, pbiRelay);
      } else if (queryResult.queryType === "sql" && this.sqlConn) {
        dataTable = await this._executeSql(queryResult.query);
      }
    } catch (e) {
      execError = e.message;
    }

    // Step 4: interpret
    const explanation = await this._interpret(question, queryResult.query, dataTable, execError, pageContext, onToken);

    // Step 5: detect anomalies in the result
    const anomalies = dataTable ? this._detectAnomalies(dataTable) : [];

    // Step 6: suggest follow-ups
    const followUps = this._suggestFollowUps(question, plan, dataTable, anomalies);

    return {
      type:        "insight",
      explanation,
      query:       queryResult.query,
      queryType:   queryResult.queryType,
      dataTable,
      anomalies,
      followUps,
      error:       execError
    };
  }

  // ── Narrate an entire report (multiple pages) ────────────────────────────────

  async narrateReport(pages, opts = {}) {
    // pages: [{ pageName, screenshot (dataUrl) }]
    const { style = "executive" } = opts;
    if (!pages?.length) return { narrative: "No pages provided." };

    const res = await fetch(`${this.proxy}/narrate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        apiKey:    this.apiKey,
        pages,
        style,
        knowledge: this.knowledge.slice(0, 5)
      }),
      signal: AbortSignal.timeout(120_000)
    });
    if (!res.ok) throw new Error(`Narrate failed: ${res.status}`);
    return res.json();
  }

  // ── Anomaly detection on time-series data ────────────────────────────────────

  async detectAnomaliesFromServer(series, kpiName, unit) {
    const res = await fetch(`${this.proxy}/anomaly`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ apiKey: this.apiKey, series, kpiName, unit }),
      signal:  AbortSignal.timeout(30_000)
    });
    if (!res.ok) throw new Error(`Anomaly check failed: ${res.status}`);
    return res.json();
  }

  // ── Step 1: classify ─────────────────────────────────────────────────────────

  async _planQuery(question, pageContext) {
    // Tableau: always pull live viz data — no DAX/SQL needed
    if (this.pbiState?.platform === "tableau") {
      return {
        needsData:  true,
        queryType:  "tableau",
        intent:     "tableau_summary",
        entities:   [],
        timeScope:  "all_time"
      };
    }

    const res = await this._callProxy({
      type:   "fallback",
      prompt: `You are a data analyst assistant. Classify this question and plan the analysis.

Question: "${question}"
${pageContext ? `Current page context: ${pageContext}` : ""}

Return ONLY valid JSON (no markdown):
{
  "needsData": true,
  "queryType": "dax|sql|none",
  "intent": "trend|comparison|ranking|anomaly|definition|procedure",
  "entities": ["revenue", "last week"],
  "timeScope": "last_7_days|last_month|last_quarter|ytd|all_time|custom",
  "answer": "(only if needsData=false — answer directly here)"
}

needsData = false only for conceptual questions ("what is gross margin?", "how does CALCULATE work?").
For any question requiring actual numbers from data, needsData = true.`
    });
    try {
      return res.json || { needsData: false, answer: res.text };
    } catch (_) {
      return { needsData: false, answer: res.text };
    }
  }

  // ── Step 2: generate query ───────────────────────────────────────────────────

  async _generateQuery(question, plan, pageContext) {
    // Tableau: no query to generate — we'll pull data directly from the viz
    const isTableau = this.pbiState?.platform === "tableau";
    if (isTableau) {
      return { query: null, queryType: "tableau" };
    }

    const isPbi = this.pbiState?.platform === "power_bi" || this.pbiState?.hasToken;
    const queryType = plan.queryType === "sql" && this.sqlConn ? "sql" : (isPbi ? "dax" : "sql");

    const res = await this._callProxy({
      type:   "fallback",
      prompt: `Write a ${queryType.toUpperCase()} query to answer this question:
"${question}"

${pageContext ? `Data model context:\n${pageContext}` : ""}
${plan.entities?.length ? `Key entities: ${plan.entities.join(", ")}` : ""}
${plan.timeScope ? `Time scope: ${plan.timeScope}` : ""}

Return ONLY the executable query — no explanation, no markdown fences.
For DAX: must start with EVALUATE.
For SQL: must start with SELECT or WITH.`,
      queryType
    });

    // Extract the raw query from the text (strip any accidental backtick fences)
    const rawText = (res.text || "").trim();
    const query = rawText
      .replace(/^```(?:dax|sql)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    return { query: query || null, queryType };
  }

  // ── Step 3a: execute Tableau summary data ────────────────────────────────────
  // Pulls getSummaryDataAsync() from the active viz via the content script relay.

  async _executeTableau(pbiRelay, maxRows = 200) {
    const r = await pbiRelay({ type: "TABLEAU_GET_DATA", maxRows });
    if (!r?.ok) throw new Error(r?.error || "TABLEAU_GET_DATA failed");
    const result = r.result || {};
    const columns  = result.columns || [];
    const rowObjs  = (result.rows || []).slice(0, maxRows);
    return { columns, rows: rowObjs, rowCount: result.totalRowCount || rowObjs.length };
  }

  // ── Step 3c: execute DAX ─────────────────────────────────────────────────────

  async _executeDax(query, pbiRelay) {
    const { workspaceId, datasetId } = this.pbiState;
    if (!datasetId) throw new Error("No datasetId available — open a Power BI report first");

    const r = await pbiRelay({ type: "PBI_API_EXECUTE_DAX", params: { datasetId, query } });
    if (!r?.ok) throw new Error(r?.error || "DAX execution failed");

    const rows = r.result || [];
    if (!rows.length) return { columns: [], rows: [], rowCount: 0 };
    const columns = Object.keys(rows[0]);
    return { columns, rows, rowCount: rows.length, rawRows: rows };
  }

  // ── Step 3d: execute SQL ──────────────────────────────────────────────────────

  async _executeSql(query) {
    const res = await fetch(`${this.proxy}/query-sql`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ connectionString: this.sqlConn, sql: query, maxRows: 200 }),
      signal:  AbortSignal.timeout(35_000)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "SQL execution failed");
    // Convert columnar to row-objects
    const { columns = [], rows = [] } = data;
    const rowObjects = rows.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
    return { columns, rows: rowObjects, rowCount: data.rowCount || rows.length };
  }

  // ── Step 4: interpret result ─────────────────────────────────────────────────

  async _interpret(question, query, dataTable, execError, pageContext, onToken) {
    let dataStr = "";
    if (execError) {
      dataStr = `\n\nQuery execution failed: ${execError}`;
    } else if (dataTable?.rows?.length) {
      dataStr = `\n\nQuery returned ${dataTable.rowCount} row(s):\n${
        JSON.stringify(dataTable.rows.slice(0, 30), null, 2)
      }`;
    } else if (dataTable) {
      dataStr = "\n\nQuery returned no rows.";
    }

    const prompt = `You ran a data query to answer: "${question}"

Query: ${query}${dataStr}

Now answer the question in plain English:
- Lead with the direct answer (1-2 sentences)
- If there are trends, anomalies, or notable patterns, explain them
- If the query failed, explain what went wrong and suggest what to check
- If data looks healthy, say so
- Suggest 1-2 follow-up analyses if relevant
- Be concise — 150 words max`;

    if (typeof onToken === "function") {
      // Streaming interpret
      let fullText = "";
      const payload = {
        type: "fallback", prompt,
        apiKey: this.apiKey,
        knowledge: this.knowledge.slice(0, 5)
      };
      const res = await fetch(`${this.proxy}/stream`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(60_000)
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Stream ${res.status}`);
      }
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.token) { fullText += evt.token; onToken(evt.token); }
            if (evt.done)  fullText = evt.text || fullText;
          } catch (_) {}
        }
      }
      return fullText;
    } else {
      const res = await this._callProxy({ type: "fallback", prompt });
      return res.text || "(no interpretation)";
    }
  }

  // ── Client-side anomaly detection ────────────────────────────────────────────

  _detectAnomalies(dataTable) {
    if (!dataTable?.rows?.length) return [];
    const anomalies = [];

    // Find numeric columns
    const numericCols = (dataTable.columns || Object.keys(dataTable.rows[0] || {})).filter(c => {
      return dataTable.rows.slice(0, 5).every(r => r[c] === null || typeof r[c] === "number");
    });

    for (const col of numericCols) {
      const values = dataTable.rows.map(r => r[col]).filter(v => v !== null && v !== undefined);
      if (values.length < 3) continue;

      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      const std = Math.sqrt(variance);

      values.forEach((v, i) => {
        const z = std > 0 ? Math.abs((v - mean) / std) : 0;
        if (z > 2.5) {
          anomalies.push({
            column: col,
            index:  i,
            value:  v,
            mean:   Math.round(mean * 100) / 100,
            zScore: Math.round(z * 100) / 100,
            direction: v > mean ? "high" : "low"
          });
        }
      });

      // Period-over-period change detection
      if (values.length >= 2) {
        const last  = values[values.length - 1];
        const prev  = values[values.length - 2];
        if (prev !== 0) {
          const pctChange = ((last - prev) / Math.abs(prev)) * 100;
          if (Math.abs(pctChange) >= 20) {
            anomalies.push({
              column: col,
              type:   "period_change",
              pctChange: Math.round(pctChange * 10) / 10,
              from:   prev,
              to:     last
            });
          }
        }
      }
    }

    return anomalies;
  }

  // ── Suggest follow-up questions ───────────────────────────────────────────────

  _suggestFollowUps(question, plan, dataTable, anomalies) {
    const followUps = [];
    const q = question.toLowerCase();

    if (q.includes("revenue") || q.includes("sales")) {
      followUps.push("Break this down by product category");
      followUps.push("How does this compare to the same period last year?");
    }
    if (q.includes("why") || q.includes("drop") || q.includes("decline")) {
      followUps.push("Which segment drove the change?");
      followUps.push("Is the trend consistent across regions?");
    }
    if (q.includes("top") || q.includes("best") || q.includes("worst")) {
      followUps.push("Show the bottom performers too");
      followUps.push("How has ranking changed over time?");
    }
    if (anomalies.length) {
      followUps.push(`Investigate the ${anomalies[0].direction} outlier in ${anomalies[0].column}`);
    }
    if (dataTable?.rowCount > 20) {
      followUps.push("Filter to the top 10 for clarity");
    }

    return followUps.slice(0, 3);
  }

  // ── Proxy helper ─────────────────────────────────────────────────────────────

  async _callProxy(payload) {
    const res = await fetch(`${this.proxy}/fallback`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        ...payload,
        apiKey:    this.apiKey,
        knowledge: this._selectKnowledge(payload.prompt, payload.queryType)
      }),
      signal:  AbortSignal.timeout(60_000)
    });
    if (!res.ok) throw new Error(`Proxy ${res.status}`);
    return res.json();
  }

  // ── Knowledge selection: skills + user notes, ranked by relevance ─────────────

  _selectKnowledge(prompt = "", queryType = "") {
    const lower = (prompt + " " + queryType).toLowerCase();

    // Pull skill rules from PowerBISkillEngine if available in this context
    const skillKnowledge = [];
    try {
      const engine = (typeof window !== "undefined") && window.PowerBISkillEngine;
      if (engine?.skills?.length) {
        // Score each skill by how many triggers match the prompt
        const scored = engine.skills.map(skill => {
          const hits = (skill.triggers || []).filter(t => lower.includes(t.toLowerCase())).length;
          return { skill, hits };
        }).filter(s => s.hits > 0)
          .sort((a, b) => b.hits - a.hits)
          .slice(0, 3);                             // top 3 skills

        for (const { skill } of scored) {
          // Build a compact knowledge entry from the skill's rules + top template
          const rules = (skill.rules || []).slice(0, 6).join(" ");
          const tplKeys = Object.keys(skill.templates || {});
          const templateHint = tplKeys.length
            ? `Template example (${tplKeys[0]}): ${String(Object.values(skill.templates)[0]).slice(0, 300)}`
            : "";
          skillKnowledge.push({
            title: skill.name,
            body:  `${rules}${templateHint ? "\n" + templateHint : ""}`
          });
        }
      }
    } catch (_) { /* PowerBISkillEngine not available — no-op */ }

    // Merge with user-defined knowledge, cap total at 8 entries
    const userKnowledge = (this.knowledge || []).slice(0, 8 - skillKnowledge.length);
    return [...skillKnowledge, ...userKnowledge];
  }
};
