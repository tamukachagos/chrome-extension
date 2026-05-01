(() => {
  if (window.__powerBiWebCopilotLoaded) {
    window.dispatchEvent(new CustomEvent("pbi-copilot-toggle"));
    return;
  }

  window.__powerBiWebCopilotLoaded = true;

  const STORAGE_KEYS = {
    knowledge: "pbiKnowledge",
    settings: "pbiSettings"
  };

  const DEFAULT_SETTINGS = {
    settingsVersion: 2,
    aiEndpoint: "",
    aiMode: "local",
    fallbackEnabled: false,
    fallbackEndpoint: "http://localhost:8787/fallback",
    fallbackThreshold: 72,
    anthropicModel: "claude-sonnet-4-6",
    activeSkills: [
      "architect-mode",
      "dax-expert",
      "visual-design",
      "semantic-model",
      "kpi-glossary",
      "performance",
      "power-query",
      "security-rls",
      "service-ops"
    ]
  };

  const state = {
    open: false,
    activeTab: "ask",
    context: captureContext(),
    knowledge: [],
    rulePacks: null,
    settings: { ...DEFAULT_SETTINGS },
    lastScreenshot: null,
    currentPlan: null,
    actLog: [],
    stopRequested: false,
    failureLog: []
  };

  const rootHost = document.createElement("div");
  rootHost.id = "pbi-copilot-root";
  document.documentElement.appendChild(rootHost);
  const root = rootHost.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: light;
        --pbi-bg: #fbfaf7;
        --pbi-panel: #ffffff;
        --pbi-ink: #171717;
        --pbi-muted: #626262;
        --pbi-line: #dfd8c8;
        --pbi-accent: #f2c811;
        --pbi-accent-2: #2563eb;
        --pbi-green: #138a5b;
        --pbi-red: #b42318;
        --pbi-soft: #f6f2e7;
        --pbi-code: #111827;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      button,
      input,
      textarea,
      select {
        font: inherit;
      }

      .launcher {
        position: fixed;
        top: 45%;
        right: 0;
        z-index: 2147483646;
        display: grid;
        place-items: center;
        width: 44px;
        height: 74px;
        border: 1px solid rgba(0, 0, 0, 0.16);
        border-right: 0;
        border-radius: 8px 0 0 8px;
        background: var(--pbi-accent);
        color: #111;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
        cursor: pointer;
        font-weight: 800;
        letter-spacing: 0;
      }

      .launcher span {
        writing-mode: vertical-rl;
        transform: rotate(180deg);
        font-size: 13px;
      }

      .shell {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 2147483647;
        display: none;
        width: min(460px, calc(100vw - 28px));
        height: min(760px, calc(100vh - 40px));
        overflow: hidden;
        border: 1px solid rgba(0, 0, 0, 0.18);
        border-radius: 8px;
        background: var(--pbi-bg);
        color: var(--pbi-ink);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.26);
      }

      .shell.open {
        display: flex;
        flex-direction: column;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 14px 12px;
        border-bottom: 1px solid var(--pbi-line);
        background: #fffdf7;
      }

      .brand {
        min-width: 0;
      }

      .brand strong {
        display: block;
        font-size: 15px;
        line-height: 1.2;
      }

      .brand span {
        display: block;
        margin-top: 2px;
        color: var(--pbi-muted);
        font-size: 12px;
        line-height: 1.35;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 320px;
      }

      .icon-row {
        display: flex;
        gap: 6px;
        flex: 0 0 auto;
      }

      .icon-btn {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 1px solid var(--pbi-line);
        border-radius: 6px;
        background: #fff;
        color: var(--pbi-ink);
        cursor: pointer;
      }

      .icon-btn:hover {
        background: var(--pbi-soft);
      }

      .tabs {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        border-bottom: 1px solid var(--pbi-line);
        background: #fff;
      }

      .tab {
        min-width: 0;
        border: 0;
        border-right: 1px solid var(--pbi-line);
        background: #fff;
        color: var(--pbi-muted);
        cursor: pointer;
        padding: 10px 4px 9px;
        font-size: 12px;
        font-weight: 700;
      }

      .tab:last-child {
        border-right: 0;
      }

      .tab.active {
        background: var(--pbi-accent);
        color: #111;
      }

      .body {
        flex: 1;
        overflow: auto;
        padding: 14px;
      }

      .section {
        display: none;
      }

      .section.active {
        display: block;
      }

      .field {
        margin-bottom: 12px;
      }

      label {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 6px;
        color: #2f2f2f;
        font-size: 12px;
        font-weight: 800;
      }

      label span {
        color: var(--pbi-muted);
        font-weight: 600;
      }

      input,
      textarea,
      select {
        width: 100%;
        border: 1px solid #cfc7b7;
        border-radius: 6px;
        background: #fff;
        color: var(--pbi-ink);
        padding: 9px 10px;
        outline: none;
        font-size: 13px;
      }

      textarea {
        min-height: 92px;
        resize: vertical;
        line-height: 1.42;
      }

      input:focus,
      textarea:focus,
      select:focus {
        border-color: var(--pbi-accent-2);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
      }

      .grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 12px 0;
      }

      .btn {
        border: 1px solid #b9ad95;
        border-radius: 6px;
        background: #fff;
        color: #171717;
        cursor: pointer;
        padding: 9px 11px;
        font-size: 13px;
        font-weight: 800;
      }

      .btn.primary {
        background: var(--pbi-accent);
        border-color: #d7b100;
      }

      .btn.blue {
        background: var(--pbi-accent-2);
        border-color: var(--pbi-accent-2);
        color: #fff;
      }

      .btn:hover {
        filter: brightness(0.98);
      }

      .result {
        display: none;
        margin-top: 12px;
      }

      .result.visible {
        display: block;
      }

      .result-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }

      .result-header strong {
        font-size: 13px;
      }

      pre {
        max-height: 300px;
        overflow: auto;
        margin: 0;
        border: 1px solid #cfc7b7;
        border-radius: 6px;
        background: var(--pbi-code);
        color: #f8fafc;
        padding: 12px;
        font: 12px/1.5 Consolas, "Cascadia Mono", "SFMono-Regular", Menlo, monospace;
        white-space: pre-wrap;
      }

      .note {
        border: 1px solid #d6e4f7;
        border-left: 4px solid var(--pbi-accent-2);
        border-radius: 6px;
        background: #f3f8ff;
        color: #17324d;
        padding: 10px 11px;
        font-size: 12px;
        line-height: 1.45;
      }

      .context-card,
      .knowledge-card {
        border: 1px solid var(--pbi-line);
        border-radius: 6px;
        background: #fff;
        padding: 10px 11px;
        margin-bottom: 10px;
      }

      .context-card strong,
      .knowledge-card strong {
        display: block;
        margin-bottom: 4px;
        font-size: 12px;
      }

      .context-card p,
      .knowledge-card p {
        margin: 0;
        color: var(--pbi-muted);
        font-size: 12px;
        line-height: 1.45;
      }

      .pill-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }

      .pill {
        border: 1px solid var(--pbi-line);
        border-radius: 999px;
        background: #fffdf7;
        color: #3f3f3f;
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 700;
      }

      .skill-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
        margin-top: 8px;
      }

      .skill-card {
        border: 1px solid var(--pbi-line);
        border-radius: 6px;
        background: #fff;
        padding: 9px 10px;
      }

      .checkbox-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        color: #262626;
        font-size: 12px;
        line-height: 1.35;
      }

      .checkbox-row input {
        width: 16px;
        height: 16px;
        margin-top: 1px;
        flex: 0 0 auto;
      }

      .checkbox-row strong {
        display: block;
        margin-bottom: 2px;
        font-size: 12px;
      }

      .checkbox-row span {
        display: block;
        color: var(--pbi-muted);
      }

      .act-screenshot {
        width: 100%;
        border-radius: 6px;
        border: 1px solid #cfc7b7;
        display: none;
        margin-top: 10px;
      }

      .el-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 0;
        border-bottom: 1px solid var(--pbi-line);
        font-size: 12px;
      }

      .el-row:last-child {
        border-bottom: 0;
      }

      .el-tag {
        flex: 0 0 auto;
        color: var(--pbi-muted);
        font-family: Consolas, monospace;
        font-size: 11px;
      }

      .el-label {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .el-list {
        max-height: 180px;
        overflow: auto;
        margin-top: 8px;
      }

      .step-card {
        border: 1px solid var(--pbi-line);
        border-radius: 6px;
        background: #fff;
        padding: 9px 10px;
        margin-bottom: 6px;
        display: flex;
        gap: 8px;
        align-items: flex-start;
      }

      .step-card.step-running {
        border-color: var(--pbi-accent-2);
        background: #f3f8ff;
      }

      .step-card.step-done {
        border-color: var(--pbi-green);
        opacity: 0.7;
      }

      .step-card.step-skipped {
        opacity: 0.45;
      }

      .step-num {
        flex: 0 0 auto;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--pbi-soft);
        color: var(--pbi-muted);
        font-size: 11px;
        font-weight: 800;
        display: grid;
        place-items: center;
      }

      .step-body {
        flex: 1;
        min-width: 0;
      }

      .step-desc {
        font-size: 12px;
        font-weight: 700;
        margin-bottom: 2px;
      }

      .step-detail {
        font-size: 11px;
        color: var(--pbi-muted);
      }

      .step-actions {
        display: flex;
        gap: 4px;
        flex: 0 0 auto;
      }

      .step-btn {
        border: 1px solid #b9ad95;
        border-radius: 5px;
        background: #fff;
        color: #171717;
        cursor: pointer;
        padding: 3px 7px;
        font-size: 11px;
        font-weight: 700;
      }

      .step-btn.approve {
        background: var(--pbi-accent);
        border-color: #d7b100;
      }

      .step-btn.skip {
        color: var(--pbi-muted);
      }

      .log-entry {
        display: flex;
        gap: 8px;
        align-items: baseline;
        padding: 4px 0;
        border-bottom: 1px solid var(--pbi-line);
        font-size: 11px;
      }

      .log-entry:last-child {
        border-bottom: 0;
      }

      .log-time {
        flex: 0 0 auto;
        color: var(--pbi-muted);
        font-family: Consolas, monospace;
      }

      .log-type {
        flex: 0 0 auto;
        font-weight: 700;
      }

      .log-msg {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--pbi-muted);
      }

      .log-ok { color: var(--pbi-green); }
      .log-err { color: var(--pbi-red); }

      .footer {
        border-top: 1px solid var(--pbi-line);
        background: #fffdf7;
        color: var(--pbi-muted);
        padding: 8px 12px;
        font-size: 11px;
        line-height: 1.35;
      }

      .toast {
        position: fixed;
        right: 28px;
        bottom: 24px;
        z-index: 2147483647;
        display: none;
        max-width: 320px;
        border-radius: 6px;
        background: #111827;
        color: #fff;
        box-shadow: 0 12px 36px rgba(0, 0, 0, 0.24);
        padding: 10px 12px;
        font: 12px/1.4 Inter, ui-sans-serif, system-ui, sans-serif;
      }

      .toast.visible {
        display: block;
      }

      @media (max-width: 560px) {
        .shell {
          inset: 8px;
          width: auto;
          height: auto;
        }

        .grid-2 {
          grid-template-columns: 1fr;
        }

        .tabs {
          grid-template-columns: repeat(3, 1fr);
          grid-template-rows: repeat(2, auto);
        }

        .tab {
          border-bottom: 1px solid var(--pbi-line);
        }
      }
    </style>

    <button class="launcher" id="launcher" title="Open Power BI Copilot"><span>BI</span></button>

    <aside class="shell" id="shell" aria-label="Power BI Web Copilot">
      <header class="header">
        <div class="brand">
          <strong>Power BI Web Copilot</strong>
          <span id="contextLine">Reading page context...</span>
        </div>
        <div class="icon-row">
          <button class="icon-btn" id="refreshContext" title="Refresh page context">↻</button>
          <button class="icon-btn" id="closePanel" title="Close">×</button>
        </div>
      </header>

      <nav class="tabs" aria-label="Power BI Copilot tools">
        <button class="tab active" data-tab="ask">Ask</button>
        <button class="tab" data-tab="measures">Measures</button>
        <button class="tab" data-tab="visuals">Visuals</button>
        <button class="tab" data-tab="model">Model</button>
        <button class="tab" data-tab="train">Train</button>
        <button class="tab" data-tab="act">Act</button>
      </nav>

      <main class="body">
        <section class="section active" data-section="ask">
          <div class="field">
            <label for="askPrompt">Power BI task <span>visual, DAX, model, debug</span></label>
            <textarea id="askPrompt" placeholder="Example: Create a measure for YoY revenue growth and recommend a visual by region."></textarea>
          </div>
          <div class="actions">
            <button class="btn primary" id="askGenerate">Generate expert answer</button>
            <button class="btn" data-fill="measure">Measure prompt</button>
            <button class="btn" data-fill="visual">Visual prompt</button>
          </div>
          <div class="context-card">
            <strong>Current page</strong>
            <p id="contextSummary">No context captured yet.</p>
            <div class="pill-row" id="contextPills"></div>
          </div>
          <div class="result" id="askResult">
            <div class="result-header">
              <strong>Recommendation</strong>
              <button class="btn" data-copy="#askOutput">Copy</button>
            </div>
            <pre id="askOutput"></pre>
          </div>
        </section>

        <section class="section" data-section="measures">
          <div class="grid-2">
            <div class="field">
              <label for="measureName">Measure name</label>
              <input id="measureName" placeholder="Total Sales">
            </div>
            <div class="field">
              <label for="measureType">Pattern</label>
              <select id="measureType">
                <option value="sum">SUM base measure</option>
                <option value="countrows">COUNTROWS</option>
                <option value="distinctcount">DISTINCTCOUNT</option>
                <option value="average">AVERAGE</option>
                <option value="ratio">Ratio / percent</option>
                <option value="ytd">Year-to-date (YTD)</option>
                <option value="mtd">Month-to-date (MTD)</option>
                <option value="qtd">Quarter-to-date (QTD)</option>
                <option value="yoy">Year-over-year % (YoY)</option>
                <option value="qoq">Quarter-over-quarter % (QoQ)</option>
                <option value="rolling">Rolling 12-month</option>
                <option value="movingavg">3-month moving average</option>
                <option value="cumulative">Cumulative running total</option>
                <option value="budgetvariance">Budget variance ($ and %)</option>
                <option value="rankx">RANKX ranking</option>
                <option value="topn">Top N contribution</option>
              </select>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="factTable">Fact table</label>
              <input id="factTable" placeholder="Sales">
            </div>
            <div class="field">
              <label for="valueColumn">Value column or base measure</label>
              <input id="valueColumn" placeholder="SalesAmount or [Total Sales]">
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="dateColumn">Date column</label>
              <input id="dateColumn" placeholder="'Date'[Date]">
            </div>
            <div class="field">
              <label for="denominator">Denominator / comparison</label>
              <input id="denominator" placeholder="[Total Target]">
            </div>
          </div>
          <div class="actions">
            <button class="btn primary" id="generateMeasure">Generate DAX</button>
            <button class="btn" id="validateMeasure">Review DAX</button>
          </div>
          <div class="field">
            <label for="customDax">DAX to review <span>optional</span></label>
            <textarea id="customDax" placeholder="Paste a DAX measure here for review."></textarea>
          </div>
          <div class="result" id="measureResult">
            <div class="result-header">
              <strong>Measure output</strong>
              <button class="btn" data-copy="#measureOutput">Copy</button>
            </div>
            <pre id="measureOutput"></pre>
          </div>
        </section>

        <section class="section" data-section="visuals">
          <div class="field">
            <label for="visualQuestion">Business question</label>
            <textarea id="visualQuestion" placeholder="Example: Which suppliers drive the most late deliveries and how is that changing over time?"></textarea>
          </div>
          <div class="field">
            <label for="availableFields">Available fields <span>tables, columns, measures</span></label>
            <textarea id="availableFields" placeholder="Supplier[Name], Delivery[Late Flag], Delivery[Date], [Late Delivery %], [Total Orders]"></textarea>
          </div>
          <div class="actions">
            <button class="btn primary" id="generateVisual">Recommend visual</button>
            <button class="btn" id="generatePage">Design report page</button>
          </div>
          <div class="result" id="visualResult">
            <div class="result-header">
              <strong>Visual plan</strong>
              <button class="btn" data-copy="#visualOutput">Copy</button>
            </div>
            <pre id="visualOutput"></pre>
          </div>
        </section>

        <section class="section" data-section="model">
          <div class="field">
            <label for="modelDescription">Model notes</label>
            <textarea id="modelDescription" placeholder="Describe your tables, relationships, grain, and any issue you are seeing."></textarea>
          </div>
          <div class="actions">
            <button class="btn primary" id="reviewModel">Review model</button>
            <button class="btn" id="relationshipChecklist">Relationship checklist</button>
          </div>
          <div class="note">
            This local MVP gives modeling guidance and DAX patterns. Directly writing measures into Power BI Service needs Microsoft sign-in plus Power BI/XMLA permissions.
          </div>
          <div class="result" id="modelResult">
            <div class="result-header">
              <strong>Model guidance</strong>
              <button class="btn" data-copy="#modelOutput">Copy</button>
            </div>
            <pre id="modelOutput"></pre>
          </div>
        </section>

        <section class="section" data-section="train">
          <div class="context-card">
            <strong>Deterministic skills</strong>
            <p>These run first in the browser. Anthropic is only used as a fallback when confidence is low.</p>
            <div class="skill-grid" id="skillList"></div>
          </div>

          <div class="context-card">
            <strong>Anthropic fallback</strong>
            <p>Use a local proxy endpoint so your API key is not stored inside the extension.</p>
            <div class="field">
              <div class="checkbox-row">
                <input type="checkbox" id="fallbackEnabled">
                <div>
                  <strong>Enable fallback</strong>
                  <span>Call the configured endpoint when deterministic confidence is below the threshold.</span>
                </div>
              </div>
            </div>
            <div class="field">
              <label for="fallbackEndpoint">Fallback endpoint</label>
              <input id="fallbackEndpoint" placeholder="http://localhost:8787/fallback">
            </div>
            <div class="grid-2">
              <div class="field">
                <label for="fallbackThreshold">Fallback threshold</label>
                <input id="fallbackThreshold" type="number" min="1" max="100" step="1">
              </div>
              <div class="field">
                <label for="anthropicModel">Anthropic model</label>
                <input id="anthropicModel" placeholder="claude-sonnet-4-6">
              </div>
            </div>
            <div class="actions">
              <button class="btn blue" id="saveAiSettings">Save fallback settings</button>
            </div>
          </div>

          <div class="field">
            <label for="knowledgeTitle">Training title</label>
            <input id="knowledgeTitle" placeholder="Company revenue definition">
          </div>
          <div class="field">
            <label for="knowledgeBody">Business rule or Power BI standard</label>
            <textarea id="knowledgeBody" placeholder="Example: Revenue excludes returns, uses invoice date, and should always be filtered to posted invoices."></textarea>
          </div>
          <div class="actions">
            <button class="btn primary" id="saveKnowledge">Save training note</button>
            <button class="btn" id="exportKnowledge">Export notes</button>
            <button class="btn" id="clearKnowledge">Clear custom notes</button>
          </div>
          <div id="knowledgeList"></div>
          <hr style="margin:12px 0;border:0;border-top:1px solid var(--pbi-line)">
          <div style="font-size:12px;font-weight:800;margin-bottom:6px">Failure Log</div>
          <div class="actions" style="gap:6px">
            <button class="btn" id="exportFailuresBtn">Export Failed Cases</button>
            <button class="btn" id="clearFailuresBtn">Clear Failures</button>
          </div>
          <div id="failureCount" style="font-size:11px;color:var(--pbi-muted);margin-top:4px"></div>
        </section>

        <section class="section" data-section="act">
          <!-- Goal -->
          <div class="field">
            <label for="actGoal">Goal <span>describe what you want to automate</span></label>
            <textarea id="actGoal" rows="3" placeholder="Example: Open the modeling tab, create a new measure called Total Revenue, paste the DAX formula, and save it."></textarea>
          </div>
          <!-- Screenshot row -->
          <div class="actions" style="gap:6px;flex-wrap:wrap">
            <button class="btn primary" id="actCaptureBtn">Capture Screen</button>
            <button class="btn" id="actAnalyzeBtn">Analyze Screen</button>
            <button class="btn blue" id="actPlanBtn">Generate Plan</button>
          </div>
          <img class="act-screenshot" id="actScreenshot" alt="Screenshot preview">
          <!-- Vision result -->
          <div id="actVisionResult" style="display:none;margin-top:10px;border:1px solid var(--pbi-line);border-radius:6px;background:#fff;padding:10px">
            <div style="font-size:12px;font-weight:700;margin-bottom:6px">Screen Analysis</div>
            <pre id="actVisionOutput" style="max-height:160px;font-size:11px;"></pre>
          </div>
          <!-- Action plan -->
          <div id="actPlanArea" style="margin-top:10px;display:none">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <strong style="font-size:12px">Action Plan</strong>
              <div style="display:flex;gap:6px">
                <button class="btn" id="approveAllBtn" style="padding:3px 8px;font-size:11px">Approve All</button>
                <button class="btn blue" id="actRunBtn" style="padding:3px 8px;font-size:11px">Run Approved</button>
                <button class="btn" id="actStopBtn" style="padding:3px 8px;font-size:11px;background:var(--pbi-red);color:#fff;border-color:var(--pbi-red)">Stop</button>
              </div>
            </div>
            <div id="planSteps"></div>
            <div id="planStatus" style="display:none;margin-top:6px;font-size:12px;color:var(--pbi-muted)"></div>
          </div>
          <hr style="margin:12px 0;border:0;border-top:1px solid var(--pbi-line)">
          <!-- Deploy DAX -->
          <div style="font-size:12px;font-weight:800;margin-bottom:6px">Deploy DAX Measure</div>
          <div class="field">
            <textarea id="deployDaxInput" rows="4" placeholder="Paste DAX measure here..."></textarea>
          </div>
          <div class="actions" style="gap:6px">
            <button class="btn primary" id="deployDaxBtn">Deploy to Power BI</button>
          </div>
          <div id="deployDaxStatus" style="display:none;font-size:12px;margin-top:6px;padding:6px 8px;border-radius:4px;background:var(--pbi-soft)"></div>
          <hr style="margin:12px 0;border:0;border-top:1px solid var(--pbi-line)">
          <!-- DOM Scanner -->
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <strong style="font-size:12px">DOM Scanner</strong>
            <div style="display:flex;gap:4px">
              <button class="btn" id="scanAllBtn" style="padding:3px 7px;font-size:11px">All</button>
              <button class="btn" id="scanPbiBtn" style="padding:3px 7px;font-size:11px">PBI Only</button>
            </div>
          </div>
          <div class="el-list" id="pageElementsList"></div>
          <hr style="margin:12px 0;border:0;border-top:1px solid var(--pbi-line)">
          <!-- Action Log -->
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <strong style="font-size:12px">Action Log</strong>
            <button class="btn" id="clearLogBtn" style="padding:2px 7px;font-size:11px">Clear</button>
          </div>
          <div id="actLogList" style="max-height:140px;overflow:auto"></div>
        </section>
      </main>

      <footer class="footer">
        Local mode: generates guidance in your browser. Add an API/backend later for live Power BI writes and stronger AI reasoning.
      </footer>
    </aside>

    <div class="toast" id="toast"></div>
  `;

  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => Array.from(root.querySelectorAll(selector));

  const elements = {
    launcher: $("#launcher"),
    shell: $("#shell"),
    contextLine: $("#contextLine"),
    contextSummary: $("#contextSummary"),
    contextPills: $("#contextPills"),
    toast: $("#toast")
  };

  loadStorage();
  loadRulePacks();
  bindEvents();
  renderContext();
  renderKnowledge();
  renderSkills();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "PBI_COPILOT_TOGGLE") {
      togglePanel();
    }
  });

  window.addEventListener("pbi-copilot-toggle", togglePanel);

  function bindEvents() {
    elements.launcher.addEventListener("click", togglePanel);
    $("#closePanel").addEventListener("click", () => setPanel(false));
    $("#refreshContext").addEventListener("click", () => {
      state.context = captureContext();
      renderContext();
      toast("Power BI page context refreshed.");
    });

    $$(".tab").forEach((button) => {
      button.addEventListener("click", () => setActiveTab(button.dataset.tab));
    });

    $$("[data-fill]").forEach((button) => {
      button.addEventListener("click", () => {
        const prompt = button.dataset.fill === "measure"
          ? "Create a reusable DAX measure for total revenue, then explain how to validate it."
          : "Recommend a Power BI visual for comparing performance across categories and over time.";
        $("#askPrompt").value = prompt;
      });
    });

    $("#askGenerate").addEventListener("click", async () => {
      const prompt = $("#askPrompt").value.trim();
      if (!prompt) return toast("Tell the copilot what you want to build.");
      showResult("#askResult", "#askOutput", "Working through deterministic skills...");
      const output = await generateExpertAnswer(prompt);
      showResult("#askResult", "#askOutput", output);
    });

    $("#generateMeasure").addEventListener("click", () => {
      const output = generateMeasure({
        name: $("#measureName").value.trim(),
        type: $("#measureType").value,
        table: $("#factTable").value.trim(),
        value: $("#valueColumn").value.trim(),
        date: $("#dateColumn").value.trim(),
        denominator: $("#denominator").value.trim()
      });
      showResult("#measureResult", "#measureOutput", output);
    });

    $("#validateMeasure").addEventListener("click", () => {
      const dax = $("#customDax").value.trim() || $("#measureOutput").textContent.trim();
      if (!dax) return toast("Paste or generate a DAX measure first.");
      showResult("#measureResult", "#measureOutput", reviewDax(dax));
    });

    $("#generateVisual").addEventListener("click", () => {
      const question = $("#visualQuestion").value.trim();
      const fields = $("#availableFields").value.trim();
      if (!question) return toast("Add the business question first.");
      showResult("#visualResult", "#visualOutput", recommendVisual(question, fields));
    });

    $("#generatePage").addEventListener("click", () => {
      const question = $("#visualQuestion").value.trim();
      const fields = $("#availableFields").value.trim();
      if (!question) return toast("Add the report goal first.");
      showResult("#visualResult", "#visualOutput", designReportPage(question, fields));
    });

    $("#reviewModel").addEventListener("click", () => {
      const description = $("#modelDescription").value.trim();
      if (!description) return toast("Describe the model or issue first.");
      showResult("#modelResult", "#modelOutput", reviewModel(description));
    });

    $("#relationshipChecklist").addEventListener("click", () => {
      showResult("#modelResult", "#modelOutput", relationshipChecklist());
    });

    $("#saveKnowledge").addEventListener("click", saveKnowledge);
    $("#exportKnowledge").addEventListener("click", exportKnowledge);
    $("#clearKnowledge").addEventListener("click", clearKnowledge);
    $("#saveAiSettings").addEventListener("click", saveAiSettings);

    $$("[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        const target = $(button.dataset.copy);
        const text = target?.textContent || "";
        if (!text.trim()) return toast("Nothing to copy yet.");
        await navigator.clipboard.writeText(text);
        toast("Copied.");
      });
    });

    // ── Act tab ──────────────────────────────────────────────────────────

    $("#actCaptureBtn")?.addEventListener("click", async () => {
      const btn = $("#actCaptureBtn");
      btn.textContent = "Capturing..."; btn.disabled = true;
      try {
        const res = await captureScreenshot();
        if (res.ok) { state.lastScreenshot = res.dataUrl; updateScreenshotPreview(res.dataUrl); toast("Screenshot captured."); }
        else { toast("Screenshot failed: " + res.error); }
      } catch (err) { toast("Error: " + err.message); }
      finally { btn.textContent = "Capture Screen"; btn.disabled = false; }
    });

    $("#actAnalyzeBtn")?.addEventListener("click", async () => {
      const btn = $("#actAnalyzeBtn");
      btn.textContent = "Analyzing..."; btn.disabled = true;
      try {
        if (!state.lastScreenshot) {
          const res = await captureScreenshot();
          if (res.ok) { state.lastScreenshot = res.dataUrl; updateScreenshotPreview(res.dataUrl); }
        }
        const goal = $("#actGoal")?.value || "";
        const visionSchema = '{"summary":"","detected_powerbi_state":"","visible_visuals":[],"visible_errors":[],"fields_or_measures_seen":[],"layout_issues":[],"recommended_next_actions":[],"requires_action_plan":true}';
        const prompt = `Analyze this Power BI screenshot. User goal: "${goal}". Return ONLY valid JSON matching this schema: ${visionSchema}`;
        const text = await callVisionApi(prompt, state.lastScreenshot);
        const visionResult = $("#actVisionResult");
        const visionOutput = $("#actVisionOutput");
        if (visionResult) visionResult.style.display = "block";
        if (visionOutput) visionOutput.textContent = text;
        toast("Screen analyzed.");
      } catch (err) { toast("Analysis error: " + err.message); captureFailureEvent("vision", "", {}, {}, err.message); }
      finally { btn.textContent = "Analyze Screen"; btn.disabled = false; }
    });

    $("#actPlanBtn")?.addEventListener("click", async () => {
      const btn = $("#actPlanBtn");
      const goal = ($("#actGoal")?.value || "").trim();
      if (!goal) { toast("Enter a goal first."); return; }
      btn.textContent = "Generating..."; btn.disabled = true;
      try {
        if (!state.lastScreenshot) {
          const res = await captureScreenshot();
          if (res.ok) { state.lastScreenshot = res.dataUrl; updateScreenshotPreview(res.dataUrl); }
        }
        const plan = await callActionPlanApi(goal, state.lastScreenshot);
        state.currentPlan = plan;
        renderActionPlan(plan);
        const planArea = $("#actPlanArea");
        if (planArea) planArea.style.display = "block";
        toast(`Plan ready: ${plan.steps.length} steps`);
      } catch (err) { toast("Plan error: " + err.message); captureFailureEvent("action_plan", goal, {}, {}, err.message); }
      finally { btn.textContent = "Generate Plan"; btn.disabled = false; }
    });

    $("#actRunBtn")?.addEventListener("click", () => runApprovedSteps());
    $("#actStopBtn")?.addEventListener("click", () => { state.stopRequested = true; toast("Stopping..."); });
    $("#approveAllBtn")?.addEventListener("click", () => { if (state.currentPlan) renderActionPlan(state.currentPlan); });
    $("#deployDaxBtn")?.addEventListener("click", async () => {
      const dax = ($("#deployDaxInput")?.value || "").trim();
      if (!dax) { toast("Paste DAX first."); return; }
      await deployDaxMeasure(dax);
    });
    $("#scanAllBtn")?.addEventListener("click", () => { renderPageElements(readPageElements(false)); });
    $("#scanPbiBtn")?.addEventListener("click", () => { renderPageElements(readPageElements(true)); });
    $("#clearLogBtn")?.addEventListener("click", () => { state.actLog = []; renderActLog(); });
    $("#exportFailuresBtn")?.addEventListener("click", () => exportFailureCases());
    $("#clearFailuresBtn")?.addEventListener("click", () => {
      state.failureLog = [];
      chrome.storage.local.remove("pbiFailures");
      const fc = $("#failureCount"); if (fc) fc.textContent = "0 failures stored.";
      toast("Failure log cleared.");
    });
  }

  function setPanel(open) {
    state.open = open;
    elements.shell.classList.toggle("open", open);
    elements.launcher.style.display = open ? "none" : "grid";
  }

  function togglePanel() {
    setPanel(!state.open);
  }

  function setActiveTab(tab) {
    state.activeTab = tab;
    $$(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    $$(".section").forEach((section) => section.classList.toggle("active", section.dataset.section === tab));
  }

  function loadStorage() {
    chrome.storage.local.get([STORAGE_KEYS.knowledge, STORAGE_KEYS.settings], (result) => {
      state.knowledge = Array.isArray(result[STORAGE_KEYS.knowledge]) ? result[STORAGE_KEYS.knowledge] : [];
      const storedSettings = result[STORAGE_KEYS.settings] || {};
      const needsMigration = !storedSettings.settingsVersion || storedSettings.settingsVersion < DEFAULT_SETTINGS.settingsVersion;
      state.settings = { ...DEFAULT_SETTINGS, ...storedSettings };
      if (!Array.isArray(state.settings.activeSkills)) {
        state.settings.activeSkills = DEFAULT_SETTINGS.activeSkills;
      }
      if (needsMigration) {
        state.settings.activeSkills = Array.from(new Set([...DEFAULT_SETTINGS.activeSkills, ...state.settings.activeSkills]));
        state.settings.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
        saveStorage();
      }
      renderKnowledge();
      renderSkills();
    });
  }

  async function loadRulePacks() {
    if (!window.PowerBIRuleLoader?.loadRulePacks) return;

    try {
      state.rulePacks = await window.PowerBIRuleLoader.loadRulePacks();
    } catch (error) {
      console.warn("Power BI rule packs failed to load", error);
    }
  }

  function saveStorage() {
    chrome.storage.local.set({
      [STORAGE_KEYS.knowledge]: state.knowledge,
      [STORAGE_KEYS.settings]: state.settings
    });
  }

  function captureContext() {
    const selectedText = String(window.getSelection?.() || "").trim();
    const title = document.title || "Power BI";
    const url = location.href;
    const visibleText = getVisibleText();
    const likelyFields = extractLikelyFields(visibleText);
    const pageMode = inferPowerBiMode(url, visibleText);

    return {
      title,
      url,
      selectedText,
      pageMode,
      likelyFields,
      capturedAt: new Date().toLocaleString()
    };
  }

  function getVisibleText() {
    const candidates = Array.from(document.querySelectorAll("h1,h2,h3,[aria-label],[title],button,span,div"))
      .slice(0, 1800)
      .map((node) => node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || "")
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter((text) => text.length >= 2 && text.length <= 90);

    return Array.from(new Set(candidates)).slice(0, 350).join(" | ");
  }

  function extractLikelyFields(text) {
    const matches = text.match(/\b[A-Z][A-Za-z0-9_ ]{1,38}\[[A-Za-z0-9_ %$-]{1,48}\]|\[[A-Za-z0-9_ %$-]{2,48}\]/g) || [];
    const words = text.split("|")
      .map((item) => item.trim())
      .filter((item) => /sales|revenue|cost|margin|date|customer|supplier|product|region|order|quantity|amount|profit|forecast|actual|target/i.test(item))
      .slice(0, 18);
    return Array.from(new Set([...matches, ...words])).slice(0, 24);
  }

  function inferPowerBiMode(url, text) {
    if (/reportEmbed/i.test(url)) return "Embedded report";
    if (/groups\/me/i.test(url)) return "My workspace";
    if (/reports\//i.test(url)) return /edit|build|visualizations|fields/i.test(text) ? "Report editing" : "Report viewing";
    if (/datasets|semantic/i.test(url)) return "Semantic model";
    return "Power BI Service";
  }

  function renderContext() {
    const context = state.context;
    elements.contextLine.textContent = `${context.pageMode} · ${context.title}`;
    elements.contextSummary.textContent = [
      `Mode: ${context.pageMode}`,
      `Selected text: ${context.selectedText ? trim(context.selectedText, 90) : "none"}`,
      `Captured: ${context.capturedAt}`
    ].join(" | ");
    elements.contextPills.innerHTML = "";
    context.likelyFields.slice(0, 10).forEach((field) => {
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = field;
      elements.contextPills.appendChild(pill);
    });
  }

  function renderKnowledge() {
    const list = $("#knowledgeList");
    if (!list) return;
    list.innerHTML = "";

    if (!state.knowledge.length) {
      const empty = document.createElement("div");
      empty.className = "note";
      empty.textContent = "No training notes yet. Add business definitions, report standards, table meanings, and DAX conventions here.";
      list.appendChild(empty);
      return;
    }

    state.knowledge.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "knowledge-card";
      card.innerHTML = `
        <strong></strong>
        <p></p>
        <div class="actions">
          <button class="btn" data-delete-knowledge="${index}">Delete</button>
        </div>
      `;
      card.querySelector("strong").textContent = item.title || `Training note ${index + 1}`;
      card.querySelector("p").textContent = item.body || "";
      card.querySelector("button").addEventListener("click", () => {
        state.knowledge.splice(index, 1);
        saveStorage();
        renderKnowledge();
      });
      list.appendChild(card);
    });
  }

  function renderSkills() {
    const list = $("#skillList");
    if (!list) return;

    const engine = window.PowerBISkillEngine;
    const skills = engine?.skills || [];
    const activeSkills = new Set(state.settings.activeSkills || DEFAULT_SETTINGS.activeSkills);
    list.innerHTML = "";

    if (!skills.length) {
      const empty = document.createElement("div");
      empty.className = "note";
      empty.textContent = "No deterministic skills were loaded.";
      list.appendChild(empty);
      return;
    }

    skills.forEach((skill) => {
      const card = document.createElement("div");
      card.className = "skill-card";
      card.innerHTML = `
        <div class="checkbox-row">
          <input type="checkbox">
          <div>
            <strong></strong>
            <span></span>
          </div>
        </div>
      `;
      const checkbox = card.querySelector("input");
      checkbox.checked = activeSkills.has(skill.id);
      checkbox.addEventListener("change", () => {
        const next = new Set(state.settings.activeSkills || []);
        if (checkbox.checked) next.add(skill.id);
        else next.delete(skill.id);
        state.settings.activeSkills = Array.from(next);
        saveStorage();
      });
      card.querySelector("strong").textContent = skill.name;
      card.querySelector("span").textContent = skill.description;
      list.appendChild(card);
    });

    const fallbackEnabled = $("#fallbackEnabled");
    const fallbackEndpoint = $("#fallbackEndpoint");
    const fallbackThreshold = $("#fallbackThreshold");
    const anthropicModel = $("#anthropicModel");
    if (fallbackEnabled) fallbackEnabled.checked = Boolean(state.settings.fallbackEnabled);
    if (fallbackEndpoint) fallbackEndpoint.value = state.settings.fallbackEndpoint || DEFAULT_SETTINGS.fallbackEndpoint;
    if (fallbackThreshold) fallbackThreshold.value = String(state.settings.fallbackThreshold || DEFAULT_SETTINGS.fallbackThreshold);
    if (anthropicModel) anthropicModel.value = state.settings.anthropicModel || DEFAULT_SETTINGS.anthropicModel;
  }

  function saveAiSettings() {
    const threshold = Number($("#fallbackThreshold").value || DEFAULT_SETTINGS.fallbackThreshold);
    state.settings = {
      ...state.settings,
      fallbackEnabled: $("#fallbackEnabled").checked,
      fallbackEndpoint: $("#fallbackEndpoint").value.trim() || DEFAULT_SETTINGS.fallbackEndpoint,
      fallbackThreshold: Math.max(1, Math.min(100, threshold)),
      anthropicModel: $("#anthropicModel").value.trim() || DEFAULT_SETTINGS.anthropicModel
    };
    saveStorage();
    renderSkills();
    toast("Fallback settings saved.");
  }

  function saveKnowledge() {
    const title = $("#knowledgeTitle").value.trim();
    const body = $("#knowledgeBody").value.trim();
    if (!title || !body) return toast("Add a title and a rule to train the copilot.");

    state.knowledge.unshift({ title, body, createdAt: new Date().toISOString() });
    $("#knowledgeTitle").value = "";
    $("#knowledgeBody").value = "";
    saveStorage();
    renderKnowledge();
    toast("Training note saved.");
  }

  async function exportKnowledge() {
    const payload = JSON.stringify(state.knowledge, null, 2);
    await navigator.clipboard.writeText(payload);
    toast("Training notes copied as JSON.");
  }

  function clearKnowledge() {
    const confirmed = window.confirm("Clear all training notes stored in this browser?");
    if (!confirmed) return;
    state.knowledge = [];
    saveStorage();
    renderKnowledge();
    toast("Training notes cleared.");
  }

  function showResult(resultSelector, outputSelector, text) {
    const result = $(resultSelector);
    const output = $(outputSelector);
    output.textContent = text;
    result.classList.add("visible");
  }

  async function generateExpertAnswer(prompt) {
    const deterministic = getDeterministicAnswer(prompt);
    const localPattern = buildExpertAnswer(prompt);
    const localAnswer = deterministic.text;

    const shouldFallback =
      state.settings.fallbackEnabled
      && state.settings.fallbackEndpoint
      && deterministic.confidence < Number(state.settings.fallbackThreshold || DEFAULT_SETTINGS.fallbackThreshold);

    if (!shouldFallback) return localAnswer;

    try {
      const aiText = await callFallback(prompt, deterministic, localPattern);
      return [
        localAnswer,
        "",
        "Anthropic fallback answer",
        "=========================",
        aiText
      ].join("\n");
    } catch (error) {
      return [
        localAnswer,
        "",
        "Fallback failed",
        "===============",
        error.message || String(error)
      ].join("\n");
    }
  }

  function getDeterministicAnswer(prompt) {
    const engine = window.PowerBISkillEngine;
    if (!engine?.composeDeterministicAnswer) {
      return {
        text: "Deterministic skill engine is not loaded.",
        confidence: 0,
        analysis: null
      };
    }

    return engine.composeDeterministicAnswer({
      prompt,
      context: state.context,
      knowledge: state.knowledge,
      activeSkillIds: state.settings.activeSkills
    });
  }

  async function callFallback(prompt, deterministic, localPattern) {
    const response = await fetch(state.settings.fallbackEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        provider: "anthropic",
        model: state.settings.anthropicModel || DEFAULT_SETTINGS.anthropicModel,
        prompt,
        deterministic,
        localPattern,
        context: state.context,
        knowledge: state.knowledge,
        activeSkills: state.settings.activeSkills
      })
    });

    if (!response.ok) {
      throw new Error(`Fallback endpoint returned HTTP ${response.status}.`);
    }

    const data = await response.json();
    const text = data.text || data.content || data.message;
    if (!text) throw new Error("Fallback endpoint did not return a text field.");
    return text;
  }

  function buildExpertAnswer(prompt) {
    const lower = prompt.toLowerCase();
    if (/measure|dax|calculate|yoy|ytd|mtd|ratio|percent|margin/.test(lower)) {
      return [
        "Power BI expert answer",
        "",
        "Recommended approach:",
        "- Start with a simple reusable base measure.",
        "- Build derived measures from that base measure instead of repeating column aggregations.",
        "- Use DIVIDE for ratios and a proper Date table for time intelligence.",
        "",
        "Suggested DAX:",
        generateMeasureFromPrompt(prompt),
        "",
        "Validation:",
        "- Put the base measure in a table by date/category and compare to source totals.",
        "- Test blank, zero, and filtered cases.",
        "- Check whether slicers should affect the measure. If not, use REMOVEFILTERS or ALL selectively.",
        "",
        "Training notes used:",
        knowledgeDigest()
      ].join("\n");
    }

    if (/visual|chart|dashboard|report|page|layout|kpi|matrix|slicer/.test(lower)) {
      return [
        "Power BI expert answer",
        "",
        recommendVisual(prompt, state.context.likelyFields.join(", ")),
        "",
        "Report polish:",
        "- Put the headline KPI in the upper-left scan path.",
        "- Keep slicers aligned and limited to decision-driving filters.",
        "- Use conditional formatting only where it changes interpretation.",
        "",
        "Training notes used:",
        knowledgeDigest()
      ].join("\n");
    }

    if (/model|relationship|star|schema|table|filter|many|grain/.test(lower)) {
      return reviewModel(prompt);
    }

    return [
      "Power BI expert answer",
      "",
      "I would handle this as a report-building workflow:",
      "1. Define the business question and decision the visual should support.",
      "2. Confirm the grain of the fact table and available dimensions.",
      "3. Create base measures first, then derived measures.",
      "4. Choose the simplest visual that answers the question.",
      "5. Validate totals against the source and test slicer behavior.",
      "",
      "Page context:",
      `- ${state.context.pageMode}`,
      `- ${state.context.title}`,
      "",
      "Useful next prompt:",
      "Create DAX measures and a report page layout for: [your business question]."
    ].join("\n");
  }

  function generateMeasureFromPrompt(prompt) {
    const name = titleCase(
      prompt.match(/(?:measure|metric|kpi)\s+(?:for|called|named)?\s*([a-z0-9 %_-]{3,40})/i)?.[1]
      || prompt.match(/(?:total|sum of|revenue|sales|margin|orders|cost|profit)[a-z0-9 %_-]{0,35}/i)?.[0]
      || "Generated Measure"
    );

    if (/yoy|year over year/.test(prompt.toLowerCase())) {
      return `${name} YoY % =\nVAR CurrentValue = [${name}]\nVAR PriorValue = CALCULATE([${name}], SAMEPERIODLASTYEAR('Date'[Date]))\nRETURN\n    DIVIDE(CurrentValue - PriorValue, PriorValue)`;
    }

    if (/margin|percent|ratio|rate/.test(prompt.toLowerCase())) {
      return `${name} % =\nDIVIDE([${name} Numerator], [${name} Denominator])`;
    }

    return `${name} =\nSUM('Fact Table'[Amount])`;
  }

  function generateMeasure(input) {
    const name = input.name || defaultMeasureName(input.type);
    const table = cleanIdentifier(input.table || "Fact Table");
    const value = input.value || "Amount";
    const date = input.date || "'Date'[Date]";
    const denominator = input.denominator || "[Denominator Measure]";
    const columnRef = value.startsWith("[") ? value : `'${table}'[${stripBrackets(value)}]`;

    const baseExpr = value.startsWith("[") ? value : `SUM(${columnRef})`;
    const patterns = {
      sum: `// Base measure — always create this first\n${name} =\nSUM(${columnRef})`,
      countrows: `// Row count — use COUNTROWS not COUNT on a table\n${name} =\nCOUNTROWS('${table}')`,
      distinctcount: `// Distinct count — use integer key column for best performance\n${name} =\nDISTINCTCOUNT(${columnRef})`,
      average: `// Simple average — for weighted average use DIVIDE(SUM(num), SUM(denom))\n${name} =\nAVERAGE(${columnRef})`,
      ratio: `// Safe ratio — DIVIDE handles zero denominator automatically\n${name} =\nDIVIDE(\n    ${value.startsWith("[") ? value : `[${name} Numerator]`},\n    ${denominator}\n)`,
      ytd: `// Year-to-date — requires continuous marked Date table\n${name} =\nCALCULATE(\n    ${baseExpr},\n    DATESYTD(${date})\n)`,
      mtd: `// Month-to-date\n${name} =\nCALCULATE(\n    ${baseExpr},\n    DATESMTD(${date})\n)`,
      qtd: `// Quarter-to-date\n${name} =\nCALCULATE(\n    ${baseExpr},\n    DATESQTD(${date})\n)`,
      yoy: `// Year-over-year % — VAR pattern caches base measure for performance\n${name} YoY % =\nVAR CurrentValue = ${baseExpr}\nVAR PriorValue =\n    CALCULATE(\n        ${baseExpr},\n        SAMEPERIODLASTYEAR(${date})\n    )\nRETURN\n    DIVIDE(CurrentValue - PriorValue, PriorValue)`,
      qoq: `// Quarter-over-quarter %\n${name} QoQ % =\nVAR CurrentValue = ${baseExpr}\nVAR PriorValue =\n    CALCULATE(\n        ${baseExpr},\n        DATEADD(${date}, -1, QUARTER)\n    )\nRETURN\n    DIVIDE(CurrentValue - PriorValue, PriorValue)`,
      rolling: `// Rolling 12-month total\n${name} Rolling 12M =\nCALCULATE(\n    ${baseExpr},\n    DATESINPERIOD(${date}, MAX(${date}), -12, MONTH)\n)`,
      movingavg: `// 3-month moving average\n${name} 3M Avg =\nDIVIDE(\n    CALCULATE(${baseExpr}, DATESINPERIOD(${date}, MAX(${date}), -3, MONTH)),\n    3\n)`,
      cumulative: `// Cumulative running total (use DATESYTD for calendar year)\n${name} Cumulative =\nCALCULATE(\n    ${baseExpr},\n    DATESYTD(${date})\n)`,
      budgetvariance: `// Budget variance — show both absolute and %\n${name} vs Budget =\n    ${value.startsWith("[") ? value : `[${name}]`} - ${denominator}\n${name} vs Budget % =\n    DIVIDE(\n        ${value.startsWith("[") ? value : `[${name}]`} - ${denominator},\n        ${denominator}\n    )`,
      rankx: `// RANKX — use Dense to avoid gaps on ties\n${name} Rank =\nRANKX(\n    ALL('${table}'[${stripBrackets(value) || "Name"}]),\n    ${baseExpr},\n    ,\n    DESC,\n    Dense\n)`,
      topn: `// Top N contribution — combine with a What-If parameter for dynamic N\n${name} Top 10 =\nCALCULATE(\n    ${baseExpr},\n    TOPN(10, ALL('${table}'), ${baseExpr}, DESC)\n)`
    };

    return [
      patterns[input.type] || patterns.sum,
      "",
      "Expert notes:",
      "- Format percent/ratio measures as Percentage (0.00%) in Power BI format pane.",
      "- Keep this base measure separate — derived measures should reference it.",
      "- Confirm the fact table grain before writing any measure.",
      "- For time intelligence, use a continuous Date table marked as Date table.",
      "- Prefix helper/intermediate measures with _ to sort them to the top.",
      "- Test with no slicers, a single date slicer, and a multi-select slicer.",
      "",
      "Validation query (paste into DAX Studio):",
      "EVALUATE",
      "SUMMARIZECOLUMNS(",
      `    ${date},`,
      `    "${name}", [${name}]`,
      ")",
      `ORDER BY ${date}`
    ].join("\n");
  }

  function reviewDax(dax) {
    const deterministic = getDeterministicAnswer(`DAX:\n${dax}`);
    return deterministic.text;
  }

  function recommendVisual(question, fields) {
    const lower = question.toLowerCase();
    const visualType = chooseVisualType(lower);
    const fieldList = fields ? fields.split(/[,|\n]/).map((item) => item.trim()).filter(Boolean) : state.context.likelyFields;

    return [
      "Recommended visual",
      `Type: ${visualType}`,
      "",
      "Why:",
      visualReason(visualType),
      "",
      "Field wells:",
      ...fieldWellPlan(visualType, fieldList),
      "",
      "Measures to create:",
      ...measureSuggestions(lower).map((item) => `- ${item}`),
      "",
      "Formatting:",
      "- Use a direct title that states the question answered.",
      "- Sort by the decision metric, descending for rankings.",
      "- Use data labels only when they help comparison.",
      "- Keep colors consistent across the page.",
      "",
      "Interactions:",
      "- Add slicers for date, region, product/category, and status only if they change decisions.",
      "- Check cross-filter behavior with nearby KPI cards and detail tables."
    ].join("\n");
  }

  function designReportPage(goal, fields) {
    return [
      "Power BI report page design",
      "",
      `Goal: ${goal}`,
      "",
      "Layout:",
      "1. KPI row: 3-4 cards for the headline metrics.",
      "2. Trend visual: line chart for the primary metric over time.",
      "3. Breakdown visual: clustered bar chart for top categories, suppliers, products, or regions.",
      "4. Detail visual: matrix/table for drillable operational records.",
      "5. Slicers: date, business unit/region, status, category.",
      "",
      recommendVisual(goal, fields),
      "",
      "Quality checks:",
      "- Every visual should answer a different part of the decision.",
      "- Avoid duplicate visuals that show the same ranking with different decoration.",
      "- Verify totals with the same slicer state a business user will use."
    ].join("\n");
  }

  function reviewModel(description) {
    const deterministic = getDeterministicAnswer(`Modeling:\n${description}`);
    return deterministic.text;
  }

  function relationshipChecklist() {
    return [
      "Relationship checklist",
      "",
      "- Does every fact table have a clear grain?",
      "- Are dimension keys unique?",
      "- Are fact foreign keys complete and typed consistently?",
      "- Is the Date table continuous and marked?",
      "- Are relationships single-direction unless intentionally modeled otherwise?",
      "- Are inactive relationships documented and used with USERELATIONSHIP?",
      "- Are many-to-many relationships replaced by bridge tables where possible?",
      "- Are hidden technical columns removed from the report field list?",
      "- Do base measures reconcile to source-system totals?",
      "- Do slicers affect only the visuals they should affect?"
    ].join("\n");
  }

  function chooseVisualType(lowerQuestion) {
    if (/trend|over time|monthly|daily|weekly|year|yoy|growth/.test(lowerQuestion)) return "Line chart";
    if (/rank|top|bottom|compare|by region|by product|by supplier|category/.test(lowerQuestion)) return "Clustered bar chart";
    if (/share|mix|composition|percent of total/.test(lowerQuestion)) return "100% stacked bar chart";
    if (/relationship|correlation|outlier|scatter/.test(lowerQuestion)) return "Scatter chart";
    if (/detail|record|list|export|transaction/.test(lowerQuestion)) return "Table";
    if (/pivot|matrix|cross|by month and/.test(lowerQuestion)) return "Matrix";
    if (/kpi|scorecard|headline|single number/.test(lowerQuestion)) return "Card";
    if (/map|location|state|country|city/.test(lowerQuestion)) return "Filled map";
    return "Clustered column chart";
  }

  function visualReason(type) {
    const reasons = {
      "Line chart": "Trends are easiest to read when time runs left to right and the metric movement is continuous.",
      "Clustered bar chart": "Bar charts make category comparison and ranking easier than pie or donut charts.",
      "100% stacked bar chart": "This emphasizes relative mix across categories while controlling for different totals.",
      "Scatter chart": "Scatter plots reveal relationship, clusters, and outliers between two measures.",
      "Table": "A table is best when users need row-level detail, lookup, or export-like inspection.",
      "Matrix": "A matrix is best for grouped comparisons across two dimensions with expandable detail.",
      "Card": "A card focuses attention on one headline metric.",
      "Filled map": "A map is useful only when geography itself changes the decision.",
      "Clustered column chart": "Column charts work well for compact category comparison, especially with short labels."
    };
    return reasons[type] || reasons["Clustered column chart"];
  }

  function fieldWellPlan(type, fields) {
    const dims = fields.filter((field) => !/^\[|%|total|sum|count|amount|revenue|sales|cost|profit|margin/i.test(field));
    const measures = fields.filter((field) => /^\[|%|total|sum|count|amount|revenue|sales|cost|profit|margin/i.test(field));
    const firstDim = dims[0] || "Primary category/dimension";
    const secondDim = dims[1] || "Optional legend/category";
    const firstMeasure = measures[0] || "[Primary Metric]";
    const secondMeasure = measures[1] || "[Secondary Metric]";

    if (type === "Line chart") return [`- X-axis: Date field`, `- Y-axis: ${firstMeasure}`, `- Legend: ${secondDim}`];
    if (type === "Scatter chart") return [`- X-axis: ${firstMeasure}`, `- Y-axis: ${secondMeasure}`, `- Details: ${firstDim}`, `- Size: [Volume Measure]`];
    if (type === "Matrix") return [`- Rows: ${firstDim}`, `- Columns: Date hierarchy or ${secondDim}`, `- Values: ${firstMeasure}`];
    if (type === "Table") return [`- Columns: ${[firstDim, secondDim, firstMeasure].join(", ")}`, "- Conditional formatting: metric status or variance"];
    if (type === "Card") return [`- Field: ${firstMeasure}`, "- Optional reference label: selected period or filter context"];
    if (type === "Filled map") return [`- Location: Geography field`, `- Color saturation: ${firstMeasure}`, `- Tooltips: ${secondMeasure}`];
    return [`- Axis: ${firstDim}`, `- Values: ${firstMeasure}`, `- Legend: ${secondDim}`, "- Tooltips: supporting metrics and variance"];
  }

  function measureSuggestions(lowerQuestion) {
    const suggestions = ["Base count/total measure for the fact table"];
    if (/revenue|sales|amount/.test(lowerQuestion)) suggestions.push("Total Revenue = SUM('Sales'[RevenueAmount])");
    if (/margin|profit/.test(lowerQuestion)) suggestions.push("Gross Margin % = DIVIDE([Gross Margin], [Total Revenue])");
    if (/late|delay|sla|quality/.test(lowerQuestion)) suggestions.push("Late Rate % = DIVIDE([Late Count], [Total Count])");
    if (/target|plan|budget|variance/.test(lowerQuestion)) suggestions.push("Variance % = DIVIDE([Actual] - [Target], [Target])");
    if (/trend|growth|yoy|year/.test(lowerQuestion)) suggestions.push("YoY % = DIVIDE([Current] - [Prior Year], [Prior Year])");
    return suggestions;
  }

  function knowledgeDigest() {
    if (!state.knowledge.length) return "- No custom training notes saved yet.";
    return state.knowledge.slice(0, 5).map((item) => `- ${item.title}: ${item.body}`).join("\n");
  }

  function defaultMeasureName(type) {
    const names = {
      sum: "Total Amount",
      countrows: "Row Count",
      distinctcount: "Distinct Count",
      average: "Average Amount",
      ratio: "Rate %",
      ytd: "YTD Amount",
      mtd: "MTD Amount",
      qtd: "QTD Amount",
      yoy: "YoY Growth %",
      qoq: "QoQ Growth %",
      rolling: "Rolling 12M Amount",
      movingavg: "3M Moving Average",
      cumulative: "Cumulative Total",
      budgetvariance: "Variance vs Budget",
      rankx: "Rank",
      topn: "Top 10 Total"
    };
    return names[type] || "New Measure";
  }

  function cleanIdentifier(value) {
    return value.replace(/^'+|'+$/g, "").replace(/\]/g, "").trim() || "Fact Table";
  }

  function stripBrackets(value) {
    return value.replace(/^\[/, "").replace(/\]$/, "").trim();
  }

  function titleCase(value) {
    return value
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  }

  function trim(value, max) {
    return value.length > max ? `${value.slice(0, max - 3)}...` : value;
  }

  // ── Screenshot ─────────────────────────────────────────────────────────

  async function captureScreenshot() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "PBI_CAPTURE_VISIBLE_TAB" }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error || "Screenshot failed"));
        resolve(res);
      });
    });
  }

  // ── Vision API ─────────────────────────────────────────────────────────

  async function callVisionApi(prompt, screenshotDataUrl) {
    const endpoint = state.settings.fallbackEndpoint || "http://localhost:8787/fallback";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "vision",
        prompt,
        screenshot: { dataUrl: screenshotDataUrl, mimeType: "image/png" },
        context: state.context,
        knowledge: state.knowledge,
        model: state.settings.anthropicModel || "claude-sonnet-4-6"
      })
    });
    if (!response.ok) throw new Error(`Vision endpoint HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    return data.text || JSON.stringify(data.json || data);
  }

  // ── Action Planner API ────────────────────────────────────────────────

  async function callActionPlanApi(goal, screenshotDataUrl) {
    const endpoint = state.settings.fallbackEndpoint || "http://localhost:8787/fallback";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "action_plan",
        goal,
        screenshot: screenshotDataUrl ? { dataUrl: screenshotDataUrl, mimeType: "image/png" } : null,
        context: state.context,
        availableActions: ["click","double_click","right_click","type","key","scroll","wait","screenshot","drag"],
        knowledge: state.knowledge,
        model: state.settings.anthropicModel || "claude-sonnet-4-6"
      })
    });
    if (!response.ok) throw new Error(`Planner endpoint HTTP ${response.status}`);
    const data = await response.json();
    if (data.error) throw new Error(data.error);
    const raw = data.text || "";
    let plan;
    try {
      plan = data.json || JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");
    } catch { throw new Error("Could not parse JSON plan from response."); }
    if (!Array.isArray(plan.steps)) throw new Error("Plan has no steps array.");
    // Validate steps
    const validTypes = new Set(["click","double_click","right_click","type","key","scroll","wait","screenshot","drag"]);
    const HIGH_RISK_WORDS = /delete|remove|publish|save|overwrite|export|share|replace|submit|apply changes|manage access/i;
    plan.steps = plan.steps.map((s, i) => {
      const type = (s.type || s.action || "").toLowerCase().replace(/ /g, "_");
      if (!validTypes.has(type)) s._invalid = true;
      if (HIGH_RISK_WORDS.test(s.reason || s.target || "")) s.risk_level = "high";
      s.requires_approval = s.requires_approval !== false;
      s.approved = false; s.done = false; s.skipped = false;
      s.id = s.id || `STEP_${String(i+1).padStart(3,"0")}`;
      s.type = type;
      return s;
    });
    return plan;
  }

  // ── Action Plan UI ─────────────────────────────────────────────────────

  function renderActionPlan(plan) {
    const container = $("#planSteps");
    if (!container) return;
    container.innerHTML = "";
    state.stopRequested = false;

    if (plan.summary) {
      const sum = document.createElement("div");
      sum.className = "note"; sum.style.marginBottom = "8px";
      sum.textContent = `${plan.summary} | Risk: ${plan.risk_level || "unknown"}`;
      container.appendChild(sum);
    }

    const HIGH_RISK_WORDS = /delete|remove|publish|save|overwrite|export|share|replace|submit|apply changes|manage access/i;

    plan.steps.forEach((step, i) => {
      const isHighRisk = step.risk_level === "high" || HIGH_RISK_WORDS.test((step.reason || "") + " " + (step.target || ""));
      const riskColor = step.risk_level === "high" ? "var(--pbi-red)" : step.risk_level === "medium" ? "#b45309" : "var(--pbi-green)";

      const card = document.createElement("div");
      card.className = "step-card";
      card.id = `step-card-${i}`;
      if (step._invalid) card.style.opacity = "0.4";
      card.innerHTML = `
        <span class="step-num">${i + 1}</span>
        <div class="step-body">
          <div class="step-desc"></div>
          <div class="step-detail"></div>
          <div class="step-risk" style="font-size:10px;font-weight:700;margin-top:2px;color:${riskColor}"></div>
        </div>
        <div class="step-actions">
          <button class="step-btn approve" ${step._invalid ? "disabled" : ""}>Approve</button>
          <button class="step-btn skip">Skip</button>
        </div>
      `;
      card.querySelector(".step-desc").textContent = step.reason || step.type || "step";
      const details = [step.type?.toUpperCase() || "?"];
      if (step.target) details.push(`→ ${step.target}`);
      if (step.text) details.push(`"${step.text.slice(0,40)}"`);
      if (step.keys) details.push(step.keys);
      if (step.duration_ms) details.push(`${step.duration_ms}ms`);
      card.querySelector(".step-detail").textContent = details.join(" ");
      card.querySelector(".step-risk").textContent = `Risk: ${step.risk_level || "low"}${isHighRisk ? " ⚠ requires approval" : ""}`;

      const approveBtn = card.querySelector(".approve");
      const skipBtn = card.querySelector(".skip");
      approveBtn.addEventListener("click", () => {
        step.approved = !step.approved;
        approveBtn.textContent = step.approved ? "Approved ✓" : "Approve";
        approveBtn.style.cssText = step.approved ? "background:var(--pbi-green);color:#fff;border-color:var(--pbi-green)" : "";
      });
      skipBtn.addEventListener("click", () => {
        step.skipped = true; step.approved = false;
        card.classList.add("step-skipped"); approveBtn.disabled = true; skipBtn.disabled = true;
      });
      container.appendChild(card);
    });

    const approveAll = $("#approveAllBtn");
    if (approveAll) {
      approveAll.addEventListener("click", () => {
        plan.steps.forEach((s, i) => {
          if (!s.skipped && !s._invalid) { s.approved = true; }
          const btn = $(`#step-card-${i}`)?.querySelector(".approve");
          if (btn && !btn.disabled) { btn.textContent = "Approved ✓"; btn.style.cssText = "background:var(--pbi-green);color:#fff;border-color:var(--pbi-green)"; }
        });
      });
    }
  }

  async function runApprovedSteps() {
    if (!state.currentPlan) return;
    const steps = state.currentPlan.steps.filter((s) => s.approved && !s.done && !s.skipped && !s._invalid);
    const planStatus = $("#planStatus");
    state.stopRequested = false;

    if (!steps.length) { if (planStatus) planStatus.textContent = "No approved steps to run."; return; }

    // Before screenshot for medium/high risk plans
    if (["medium","high"].includes(state.currentPlan.risk_level)) {
      try { const s = await captureScreenshot(); if (s.ok) state.lastScreenshot = s.dataUrl; } catch {}
    }

    for (const step of steps) {
      if (state.stopRequested) { if (planStatus) planStatus.textContent = "Stopped by user."; return; }
      const card = $(`#step-card-${state.currentPlan.steps.indexOf(step)}`);
      if (card) card.classList.add("step-running");
      if (planStatus) planStatus.textContent = `Step ${step.id || step.n}: ${step.reason || step.type}...`;

      try {
        const result = await executeStep(step);
        step.done = true;
        if (card) { card.classList.remove("step-running"); card.classList.add("step-done"); }
        logAction(step.type, step.target || step.text || "", result);
      } catch (err) {
        if (card) card.classList.remove("step-running");
        logAction(step.type, step.target || "", "ERROR: " + err.message);
        if (planStatus) planStatus.textContent = `Step ${step.id || step.n} failed: ${err.message}. Stopped.`;
        captureFailureEvent("action_plan", JSON.stringify(step), {}, {}, err.message);
        // After screenshot on failure
        try { const s = await captureScreenshot(); if (s.ok) { state.lastScreenshot = s.dataUrl; updateScreenshotPreview(s.dataUrl); } } catch {}
        return;
      }
      await wait(120);
    }

    // After screenshot for medium/high risk
    if (["medium","high"].includes(state.currentPlan.risk_level)) {
      try { const s = await captureScreenshot(); if (s.ok) state.lastScreenshot = s.dataUrl; } catch {}
    }
    if (planStatus) planStatus.textContent = `All ${steps.length} steps complete.`;
  }

  // ── Power BI State Detector ────────────────────────────────────────────

  function isPowerBILoading() {
    const indicators = [
      '[role="progressbar"]',
      '[class*="spinner"]',
      '[class*="loading"]',
      '[class*="progress"]',
      '[aria-busy="true"]',
      '[class*="loadingOverlay"]',
      '[class*="busy"]'
    ];
    for (const sel of indicators) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return true;
    }
    const text = document.body.innerText || "";
    if (/loading\.\.\.|please wait/i.test(text)) return true;
    return false;
  }

  function waitForPowerBIIdle(timeoutMs = 8000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (!isPowerBILoading()) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 200);
      };
      setTimeout(check, 300);
    });
  }

  function detectPowerBIVisualErrors() {
    const errorPhrases = [
      "Something went wrong",
      "Can't display the visual",
      "This visual has exceeded",
      "Couldn't load the data",
      "See details",
      "Query exceeded",
      "The visual has timed out",
      "Data reduction was applied"
    ];
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      for (const phrase of errorPhrases) {
        if (t.includes(phrase) && !found.includes(phrase)) found.push(phrase);
      }
    }
    return found;
  }

  function detectPowerBIEditorOpen() {
    return !!(
      document.querySelector('[class*="monaco-editor"]') ||
      document.querySelector('[aria-label*="DAX"]') ||
      document.querySelector('[aria-label*="formula bar"]') ||
      document.querySelector('[data-testid*="formula"]')
    );
  }

  function detectPowerBIPanes() {
    return {
      formatPane: !!document.querySelector('[aria-label*="Format"]'),
      fieldsPane: !!document.querySelector('[aria-label*="Fields"]'),
      filterPane: !!document.querySelector('[aria-label*="Filter"]'),
      visualsPane: !!document.querySelector('[aria-label*="Visualizations"]')
    };
  }

  function findElementByLabel(label) {
    if (!label) return null;
    const lower = label.toLowerCase();
    const candidates = Array.from(document.querySelectorAll('button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],[aria-label],[title]'));
    return candidates.sort((a, b) => {
      const scoreEl = (el) => {
        const a2 = (el.getAttribute("aria-label") || "").toLowerCase();
        const t = (el.getAttribute("title") || "").toLowerCase();
        const tx = (el.textContent || "").replace(/\s+/g," ").trim().toLowerCase();
        if (a2 === lower || t === lower || tx === lower) return 100;
        if (a2.includes(lower) || t.includes(lower)) return 60;
        if (tx.includes(lower) && tx.length < 80) return 40;
        return 0;
      };
      return scoreEl(b) - scoreEl(a);
    }).find(el => {
      const a2 = (el.getAttribute("aria-label") || "").toLowerCase();
      const t = (el.getAttribute("title") || "").toLowerCase();
      const tx = (el.textContent || "").replace(/\s+/g," ").trim().toLowerCase();
      return a2.includes(lower) || t.includes(lower) || (tx.includes(lower) && tx.length < 80);
    }) || null;
  }

  async function executeStep(step) {
    if (state.stopRequested) throw new Error("Stopped by user.");
    const type = (step.type || step.action || "").toLowerCase().replace(/ /g, "_");

    // Wait for Power BI to be idle before each step
    await waitForPowerBIIdle(5000);

    switch (type) {
      case "click": {
        let el = step.selector ? document.querySelector(step.selector) : null;
        if (!el && step.target) el = findElementByLabel(step.target);
        if (!el && step.x != null) return clickAtCoord(step.x, step.y, "left", false);
        if (!el) throw new Error(`click: no element found for target="${step.target}" selector="${step.selector}"`);
        el.scrollIntoView({ block: "center" });
        el.focus(); el.click();
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return `Clicked: ${step.target || step.selector}`;
      }
      case "double_click": {
        let el = step.selector ? document.querySelector(step.selector) : findElementByLabel(step.target);
        if (!el && step.x != null) return clickAtCoord(step.x, step.y, "left", true);
        if (!el) throw new Error(`double_click: no element for "${step.target}"`);
        el.focus();
        el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
        return `Double-clicked: ${step.target || step.selector}`;
      }
      case "right_click": {
        let el = step.selector ? document.querySelector(step.selector) : findElementByLabel(step.target);
        if (!el) throw new Error(`right_click: no element for "${step.target}"`);
        el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        return `Right-clicked: ${step.target || step.selector}`;
      }
      case "type": {
        let el = step.selector ? document.querySelector(step.selector) : null;
        if (!el && step.target) el = findElementByLabel(step.target) || document.activeElement;
        if (!el || el === document.body) el = document.querySelector('[contenteditable="true"]') || document.querySelector('input:not([type="hidden"])');
        if (!el) throw new Error("type: no input element found");
        el.focus();
        if (el.getAttribute("contenteditable") === "true") {
          document.execCommand("selectAll", false);
          document.execCommand("insertText", false, step.text || "");
        } else {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
            || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
          if (setter) setter.call(el, step.text || ""); else el.value = step.text || "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return `Typed ${(step.text||"").length} chars`;
      }
      case "key": {
        const combo = step.keys || step.text || "";
        return pressKeyCombo(combo);
      }
      case "scroll": {
        const target = step.selector ? document.querySelector(step.selector) : null;
        if (target) target.scrollBy(step.dx || 0, step.dy || 300);
        else window.scrollBy(step.dx || 0, step.dy || 300);
        return `Scrolled`;
      }
      case "wait": {
        await wait(step.duration_ms || 500);
        await waitForPowerBIIdle(5000);
        return `Waited ${step.duration_ms || 500}ms`;
      }
      case "screenshot": {
        const res = await captureScreenshot();
        if (res.ok) { state.lastScreenshot = res.dataUrl; updateScreenshotPreview(res.dataUrl); }
        return res.ok ? "Screenshot captured" : `Screenshot failed: ${res.error}`;
      }
      case "drag": {
        const startX = step.x || 0, startY = step.y || 0;
        const endX = startX + (step.dx || 0), endY = startY + (step.dy || 0);
        const origin = document.elementFromPoint(startX, startY);
        if (!origin) throw new Error(`drag: no element at (${startX},${startY})`);
        origin.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: startX, clientY: startY }));
        for (let i = 1; i <= 5; i++) {
          const ix = startX + (endX - startX) * (i / 5);
          const iy = startY + (endY - startY) * (i / 5);
          origin.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: ix, clientY: iy }));
          await wait(20);
        }
        const dest = document.elementFromPoint(endX, endY) || origin;
        dest.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: endX, clientY: endY }));
        return `Dragged from (${startX},${startY}) to (${endX},${endY})`;
      }
      default:
        throw new Error(`Unknown action type: ${type}`);
    }
  }

  // ── Screenshot preview helper ──────────────────────────────────────────

  function updateScreenshotPreview(dataUrl) {
    const img = $("#actScreenshot");
    if (!img) return;
    img.src = dataUrl;
    img.style.display = "block";
  }

  // ── DAX Deploy Workflow ────────────────────────────────────────────────

  async function deployDaxMeasure(daxText) {
    const deployStatus = $("#deployDaxStatus");
    const setStatus = (msg, isErr) => {
      if (deployStatus) { deployStatus.textContent = msg; deployStatus.style.color = isErr ? "var(--pbi-red)" : "var(--pbi-green)"; deployStatus.style.display = "block"; }
      logAction("deploy_dax", msg.slice(0,40), isErr ? "ERROR" : "OK");
    };

    if (!daxText?.trim()) { setStatus("No DAX text provided.", true); return; }

    setStatus("Capturing before screenshot...");
    let beforeUrl = null;
    try { const s = await captureScreenshot(); if (s.ok) beforeUrl = s.dataUrl; } catch {}

    setStatus("Looking for New measure button...");
    await waitForPowerBIIdle(5000);
    const newMeasureLabels = ["New measure", "New Measure", "Add measure", "Neues Measure"];
    let clicked = false;
    for (const lbl of newMeasureLabels) {
      const el = findElementByLabel(lbl);
      if (el) { el.click(); clicked = true; break; }
    }
    if (!clicked) { setStatus("Could not find 'New measure' button. Open the Modeling tab first.", true); return; }

    setStatus("Waiting for DAX editor...");
    await wait(800);
    await waitForPowerBIIdle(5000);

    if (!detectPowerBIEditorOpen()) {
      setStatus("DAX editor did not open. Try clicking the measure editor manually.", true);
      return;
    }

    setStatus("Selecting all and typing DAX...");
    const editor = document.querySelector('[class*="monaco-editor"] [contenteditable="true"]')
      || document.querySelector('[contenteditable="true"]');
    if (!editor) { setStatus("DAX editor element not found.", true); return; }
    editor.focus();
    document.execCommand("selectAll", false);
    await wait(100);
    document.execCommand("insertText", false, daxText);
    await wait(300);

    setStatus("Waiting for Power BI to process...");
    await waitForPowerBIIdle(6000);

    const errors = detectPowerBIVisualErrors();
    if (errors.length) { setStatus(`Errors detected: ${errors[0]}`, true); return; }

    setStatus("Capturing after screenshot...");
    try { const s = await captureScreenshot(); if (s.ok) state.lastScreenshot = s.dataUrl; } catch {}

    setStatus("DAX deployed. Review the measure name and save manually.");
    captureFailureEvent("dax", daxText, {}, { status: "deployed" }, "DAX deploy workflow completed");
  }

  // ── Failure Capture ────────────────────────────────────────────────────

  async function captureFailureEvent(type, input, engineOutput, claudeOutput, expectedBehavior) {
    const event = {
      id: `fail_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      type,
      input: String(input).slice(0, 2000),
      context: { url: location.href, pageMode: state.context?.pageMode, title: document.title },
      screenshot: state.lastScreenshot
        ? { capturedAt: new Date().toISOString(), hasImage: true }
        : { hasImage: false },
      engineOutput,
      claudeOutput,
      expectedBehavior,
      actionLog: state.actLog.slice(0, 20),
      createdAt: new Date().toISOString()
    };
    state.failureLog.unshift(event);
    if (state.failureLog.length > 100) state.failureLog.pop();
    // Persist to chrome.storage.local
    chrome.storage.local.get(["pbiFailures"], (result) => {
      const existing = Array.isArray(result.pbiFailures) ? result.pbiFailures : [];
      const updated = [event, ...existing].slice(0, 200);
      chrome.storage.local.set({ pbiFailures: updated });
    });
  }

  async function loadFailureLog() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["pbiFailures"], (result) => {
        state.failureLog = Array.isArray(result.pbiFailures) ? result.pbiFailures : [];
        resolve(state.failureLog);
      });
    });
  }

  function exportFailureCases() {
    const blob = new Blob([JSON.stringify(state.failureLog, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `pbi_failures_${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  // ── DOM Scanner ────────────────────────────────────────────────────────

  function readPageElements(pbiOnly) {
    const selector = pbiOnly
      ? '[class*="visual"],[class*="pane"],[class*="slicer"],[aria-label],[data-testid],[role="button"],[role="tab"]'
      : 'button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],[aria-label]';

    const seen = new Map();
    document.querySelectorAll(selector).forEach((el) => {
      const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70);
      const role = el.getAttribute("role") || el.tagName.toLowerCase();
      if (label && label.length > 1 && !seen.has(label)) seen.set(label, { label, role, el });
    });

    return Array.from(seen.values()).slice(0, 60);
  }

  function renderPageElements(items) {
    const list = $("#pageElementsList");
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="note">No interactive elements found. Refresh the context first.</div>';
      return;
    }
    list.innerHTML = "";
    items.forEach(({ label, role }) => {
      const row = document.createElement("div");
      row.className = "el-row";
      row.innerHTML = `<span class="el-tag"></span><span class="el-label" title=""></span><button class="btn" style="padding:3px 7px;font-size:11px;flex:0 0 auto;">Click</button>`;
      row.querySelector(".el-tag").textContent = role;
      const labelEl = row.querySelector(".el-label");
      labelEl.textContent = label;
      labelEl.title = label;
      row.querySelector(".btn").addEventListener("click", () => {
        const result = findAndActElement(label, "click");
        toast(result.slice(0, 60));
      });
      list.appendChild(row);
    });
  }

  // ── Element finder & actor ─────────────────────────────────────────────

  function findAndActElement(label, action) {
    const lower = label.toLowerCase();
    const candidates = Array.from(
      document.querySelectorAll('button,input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],[aria-label],[title]')
    );
    const scored = candidates.map((el) => {
      const a = (el.getAttribute("aria-label") || "").toLowerCase();
      const t = (el.getAttribute("title") || "").toLowerCase();
      const tx = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      let score = 0;
      if (a === lower || t === lower || tx === lower) score = 100;
      else if (a.includes(lower) || t.includes(lower)) score = 60;
      else if (tx.includes(lower) && tx.length < 80) score = 40;
      return { el, score };
    }).filter((e) => e.score > 0).sort((a, b) => b.score - a.score);

    if (!scored.length) return `No element matched "${label}".`;

    const { el } = scored[0];
    const name = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50);

    el.scrollIntoView({ block: "center", behavior: "smooth" });

    if (action === "highlight") {
      const prev = el.style.outline;
      el.style.outline = "3px solid #f2c811";
      setTimeout(() => { el.style.outline = prev; }, 2000);
      return `Highlighted: ${name}`;
    }

    if (action === "rightclick") {
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      logAction("rightclick", name, "OK");
      return `Right-clicked: ${name}`;
    }

    if (action === "doubleclick") {
      el.focus();
      el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      logAction("doubleclick", name, "OK");
      return `Double-clicked: ${name}`;
    }

    // Default: left click
    el.focus();
    el.click();
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    logAction("click", name, "OK");
    return `Clicked: ${name}`;
  }

  // ── Coordinate click ───────────────────────────────────────────────────

  function coordAction(isDouble, isRight) {
    const x = parseFloat($("#coordX").value);
    const y = parseFloat($("#coordY").value);
    if (isNaN(x) || isNaN(y)) return "Enter X and Y coordinates.";
    return clickAtCoord(x, y, isRight ? "right" : "left", isDouble);
  }

  function clickAtCoord(x, y, button, isDouble) {
    const el = document.elementFromPoint(x, y);
    const label = el ? (el.getAttribute("aria-label") || el.tagName).slice(0, 40) : `(${x},${y})`;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: button === "right" ? 2 : 0 };

    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      if (button === "right") {
        el.dispatchEvent(new MouseEvent("contextmenu", opts));
      } else if (isDouble) {
        el.dispatchEvent(new MouseEvent("dblclick", opts));
      } else {
        el.focus();
        el.click();
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
      }
    }

    const type = isDouble ? "doubleclick" : button === "right" ? "rightclick" : "click";
    logAction(type, `(${x},${y}) → ${label}`, el ? "OK" : "No element at coords");
    return `${type} at (${x},${y}): ${label}`;
  }

  // ── Keyboard ───────────────────────────────────────────────────────────

  function pressKeyCombo(combo) {
    if (!combo) return "No key combo specified.";

    const parts = combo.split("+");
    const keyPart = parts[parts.length - 1];
    const opts = {
      bubbles: true,
      cancelable: true,
      key: keyPart,
      ctrlKey: /ctrl/i.test(combo),
      shiftKey: /shift/i.test(combo),
      altKey: /alt/i.test(combo),
      metaKey: /meta|cmd/i.test(combo)
    };

    const target = document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", opts));
    target.dispatchEvent(new KeyboardEvent("keypress", opts));
    target.dispatchEvent(new KeyboardEvent("keyup", opts));
    logAction("key", combo, "OK");
    return `Key sent: ${combo}`;
  }

  // ── Scroll ─────────────────────────────────────────────────────────────

  function scrollPage(direction, amount) {
    const map = { up: [0, -amount], down: [0, amount], left: [-amount, 0], right: [amount, 0] };
    const [dx, dy] = map[direction] || [0, amount];
    window.scrollBy(dx, dy);
    logAction("scroll", `${direction} ${amount}px`, "OK");
    toast(`Scrolled ${direction} ${amount}px`);
  }

  // ── Type / clear ───────────────────────────────────────────────────────

  function typeIntoField(targetLabel, text) {
    let el = null;
    if (targetLabel) {
      const lower = targetLabel.toLowerCase();
      el = Array.from(document.querySelectorAll('input,textarea,[contenteditable="true"]')).find((node) => {
        const a = (node.getAttribute("aria-label") || node.getAttribute("placeholder") || node.getAttribute("title") || "").toLowerCase();
        return a.includes(lower);
      });
    }
    if (!el) el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) {
      el = document.querySelector('[contenteditable="true"]') || document.querySelector('input:not([type="hidden"])');
    }
    if (!el) { toast("No input field found. Click on a field in Power BI first."); return; }

    el.focus();
    if (el.getAttribute("contenteditable") === "true") {
      document.execCommand("insertText", false, text);
      logAction("type", "contenteditable", text.slice(0, 30));
      toast(`Typed into editor: ${text.slice(0, 30)}`);
      return;
    }

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    logAction("type", targetLabel || "focused field", text.slice(0, 30));
    toast(`Typed: ${text.slice(0, 30)}`);
  }

  function clearFieldByLabel(targetLabel) {
    let el = null;
    if (targetLabel) {
      const lower = targetLabel.toLowerCase();
      el = Array.from(document.querySelectorAll('input,textarea')).find((node) => {
        const a = (node.getAttribute("aria-label") || node.getAttribute("placeholder") || "").toLowerCase();
        return a.includes(lower);
      });
    }
    if (!el) el = document.activeElement;
    if (!el || el === document.body) { toast("No field selected."); return; }
    el.focus();
    el.select?.();
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    logAction("clear", targetLabel || "focused field", "OK");
    toast("Field cleared.");
  }

  // ── Power BI shortcuts ─────────────────────────────────────────────────

  function pbiShortcut(labels, description) {
    for (const label of labels) {
      const result = findAndActElement(label, "click");
      if (!result.startsWith("No element matched")) {
        const fb = $("#pbiActionFeedback");
        fb.textContent = result;
        fb.style.display = "block";
        return true;
      }
    }
    const fb = $("#pbiActionFeedback");
    fb.textContent = `Could not find ${description}. The pane may already be open or the label differs in your Power BI version.`;
    fb.style.display = "block";
    toast(`${description} not found.`);
    return false;
  }

  // ── Utilities ──────────────────────────────────────────────────────────

  function showExecFeedback(message) {
    const fb = $("#execFeedback");
    if (!fb) return;
    fb.textContent = message;
    fb.style.display = "block";
    toast(message.slice(0, 60));
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Action log ─────────────────────────────────────────────────────────

  function logAction(type, target, result) {
    const ok = !String(result).toUpperCase().startsWith("ERROR") && !String(result).startsWith("No element");
    state.actLog.unshift({
      time: new Date().toLocaleTimeString(),
      type,
      target: String(target).slice(0, 40),
      result: String(result).slice(0, 60),
      ok
    });
    if (state.actLog.length > 60) state.actLog.pop();
    renderActLog();
  }

  function renderActLog() {
    const list = $("#actLogList");
    if (!list) return;
    if (!state.actLog.length) {
      list.innerHTML = '<div style="font-size:12px;color:var(--pbi-muted);padding:4px 0;">No actions yet.</div>';
      return;
    }
    list.innerHTML = state.actLog.map((entry) => `
      <div class="log-entry">
        <span class="log-time">${entry.time}</span>
        <span class="log-type ${entry.ok ? "log-ok" : "log-err"}">${entry.type}</span>
        <span class="log-msg" title="${entry.target}: ${entry.result}">${entry.target} — ${entry.result}</span>
      </div>
    `).join("");
  }

  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2200);
  }
})();
