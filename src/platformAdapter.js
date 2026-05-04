/**
 * platformAdapter.js — Platform detection and DOM extraction
 * Runs as a content script on every page. Detects Power BI, Tableau, SQL tools,
 * and exposes a unified read/write API that the side panel consumes via RELAY_TO_CONTENT.
 *
 * Exposed on window.__dataAnalystAdapter (content-script scope).
 * Message handler: chrome.runtime.onMessage listens for { type: "ADAPTER_*" } calls.
 */

(function () {
  if (window.__dataAnalystAdapter) return; // Already loaded

  // ── Platform detection ────────────────────────────────────────────────────────

  const PLATFORMS = {
    POWER_BI:     "power_bi",
    TABLEAU:      "tableau",
    LOOKER:       "looker",
    SQL_SERVER:   "sql_server",
    METABASE:     "metabase",
    UNKNOWN:      "unknown"
  };

  function detectPlatform() {
    const host = location.hostname;
    const path = location.pathname;

    if (host.includes("powerbi.com") || host.includes("app.powerbi.com"))
      return PLATFORMS.POWER_BI;
    if (host.includes("tableau.com") || host.includes("public.tableau.com"))
      return PLATFORMS.TABLEAU;
    if (host.includes("looker.com") || document.querySelector('meta[name="viewport"][content*="looker"]'))
      return PLATFORMS.LOOKER;
    if (host.includes("metabase"))
      return PLATFORMS.METABASE;
    // SQL Server Management Studio / Azure Data Studio embedded SQL editors
    if (host.includes("portal.azure.com") && path.includes("sql"))
      return PLATFORMS.SQL_SERVER;
    // Monaco editor = likely a SQL/code editor
    if (document.querySelector(".monaco-editor"))
      return PLATFORMS.SQL_SERVER;
    return PLATFORMS.UNKNOWN;
  }

  // ── Generic DOM helpers ───────────────────────────────────────────────────────

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }
  function qsa(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }
  function textOf(el) {
    return el ? el.textContent.trim() : "";
  }
  function attrOf(el, attr) {
    return el ? (el.getAttribute(attr) || "") : "";
  }

  // ── Power BI DOM extraction ───────────────────────────────────────────────────

  const PBI = {
    // Detect what mode the report is in
    getMode() {
      if (qs('[data-testid="edit-mode-button"], .editModeButton, [aria-label*="Edit report"]'))
        return "view"; // Button to enter edit exists → currently in view
      if (qs('[data-testid="save-button"], [aria-label*="Save"], .saveButton'))
        return "edit";
      return "view";
    },

    // Current page / tab name
    getActivePage() {
      const active = qs('.reportPageNavigator .active, [role="tab"][aria-selected="true"], .pageTab.selected');
      return textOf(active) || null;
    },

    // All report pages
    getPages() {
      const tabs = qsa('.reportPageNavigator [role="tab"], .pageTab, [class*="pageNavItem"]');
      return tabs.map(t => textOf(t)).filter(Boolean);
    },

    // Visuals on the canvas (identified by their container divs)
    getVisuals() {
      const visualEls = qsa('[data-testid="visual-container"], [class*="visualContainer"], [class*="visual-"]');
      return visualEls.slice(0, 40).map((el, i) => {
        const titleEl = el.querySelector('[class*="title"], [data-testid="visual-title"]');
        const typeEl  = el.querySelector('[class*="visual-type"], [data-visual-type]');
        return {
          index: i,
          title: textOf(titleEl) || `Visual ${i + 1}`,
          type:  attrOf(typeEl, "data-visual-type") || "unknown",
          rect:  el.getBoundingClientRect()
        };
      });
    },

    // Fields pane — tables and fields listed in the data pane
    getFields() {
      const result = { tables: [] };
      const tableEls = qsa('[class*="fieldListGroupHeader"], [data-testid*="table-header"], [class*="tableItem"]');
      tableEls.slice(0, 50).forEach(tableEl => {
        const tableName = textOf(tableEl);
        const fieldContainer = tableEl.closest('[class*="fieldListGroup"]') || tableEl.parentElement;
        const fieldEls = fieldContainer
          ? qsa('[class*="fieldItem"], [data-testid*="field-item"]', fieldContainer)
          : [];
        result.tables.push({
          name: tableName,
          fields: fieldEls.slice(0, 100).map(f => textOf(f)).filter(Boolean)
        });
      });
      return result;
    },

    // Read the DAX formula currently in the formula bar
    getFormulaBarDax() {
      // Try every known selector in priority order (Power BI changes these frequently)
      const candidates = [
        // data-testid variants (most stable)
        '[data-testid="formula-bar-inner-editor"]',
        '[data-testid="formula-bar"] [contenteditable]',
        // class-based
        '.formula-bar-editor [contenteditable]',
        '.formula-bar-editor',
        '.formulaBar [contenteditable]',
        '.formulaBarExpression [contenteditable]',
        '[class*="formulaBarEditor"] [contenteditable]',
        '[class*="formulaBarEditor"]',
        // Monaco (DAX editor in new measure dialog)
        '[class*="dax-editor"] .monaco-editor .view-lines',
        '.monaco-editor .view-lines',
        // legacy textarea
        'textarea[class*="formulaBar"]',
        'textarea[class*="dax"]',
      ];
      for (const sel of candidates) {
        const fb = qs(sel);
        if (!fb) continue;
        if (fb.classList.contains("view-lines")) {
          return qsa(".view-line", fb).map(l => l.textContent).join("\n") || null;
        }
        const val = fb.textContent || fb.value || null;
        if (val && val.trim()) return val;
      }
      return null;
    },

    // Read the measure name from the formula bar name input
    getMeasureNameInFormulaBar() {
      const candidates = [
        '[data-testid="measure-name-input"]',
        '[aria-label="Measure name"]',
        '[aria-label="Name"] input',
        '[placeholder*="Measure name"]',
        'input[class*="measureName"]',
        'input[class*="formulaBarName"]',
        '.formulaBar input[type="text"]',
        '[data-testid="formula-bar"] input[type="text"]',
      ];
      for (const sel of candidates) {
        const el = qs(sel);
        if (el) return el.value || el.textContent || null;
      }
      return null;
    },

    // Selected visual's field wells
    getSelectedVisualFields() {
      const wells = qsa('[class*="fieldWell"], [data-testid*="field-well"]');
      const result = {};
      wells.forEach(well => {
        const label = textOf(well.querySelector('[class*="wellLabel"], [class*="label"]')) || "field";
        const chips = qsa('[class*="fieldChip"], [class*="chip"]', well).map(c => textOf(c));
        if (chips.length) result[label] = chips;
      });
      return result;
    },

    // Filters pane
    getFilters() {
      const filterCards = qsa('[class*="filterCard"], [data-testid*="filter-card"]');
      return filterCards.slice(0, 20).map(fc => ({
        field: textOf(fc.querySelector('[class*="filterHeader"], [class*="title"]')),
        type:  attrOf(fc, "data-filter-type") || "unknown"
      }));
    },

    // Measure editor (when a measure is selected / new measure dialog open)
    getMeasureEditorDax() {
      // Dedicated measure editor dialog
      const editor = qs(
        '[class*="measureDialog"] [contenteditable], ' +
        '[aria-label*="measure"] [contenteditable], ' +
        '[class*="measureEditor"] .monaco-editor .view-lines'
      );
      if (!editor) return null;
      if (editor.classList.contains("view-lines")) {
        return qsa(".view-line", editor).map(l => l.textContent).join("\n");
      }
      return editor.textContent || null;
    },

    // Snapshot of the full page state
    getPageState() {
      return {
        platform: PLATFORMS.POWER_BI,
        mode:    PBI.getMode(),
        page:    PBI.getActivePage(),
        pages:   PBI.getPages(),
        visuals: PBI.getVisuals(),
        fields:  PBI.getFields(),
        filters: PBI.getFilters(),
        selectedVisualFields: PBI.getSelectedVisualFields(),
        formulaBarDax: PBI.getFormulaBarDax(),
        measureEditorDax: PBI.getMeasureEditorDax(),
        formulaBarMeasureName: PBI.getMeasureNameInFormulaBar(),
        url: location.href,
        title: document.title
      };
    },

    // Write DAX into formula bar (hardened with many fallback selectors)
    writeDaxToFormulaBar(dax) {
      const candidates = [
        '[data-testid="formula-bar-inner-editor"]',
        '[data-testid="formula-bar"] [contenteditable]',
        '.formula-bar-editor [contenteditable]',
        '.formula-bar-editor',
        '.formulaBar [contenteditable]',
        '.formulaBarExpression [contenteditable]',
        '[class*="formulaBarEditor"] [contenteditable]',
        '[class*="formulaBarEditor"]',
        'textarea[class*="formulaBar"]',
        'textarea[class*="dax"]',
      ];
      let fb = null;
      for (const sel of candidates) {
        const el = qs(sel);
        if (el) { fb = el; break; }
      }
      if (!fb) return { ok: false, error: "Formula bar not found. Make sure a measure is selected in the Fields pane first." };

      fb.focus();
      // Approach 1: execCommand (works for contentEditable)
      const selResult = document.execCommand("selectAll", false, null);
      const insertResult = document.execCommand("insertText", false, dax);

      // Approach 2: if execCommand didn't insert (read-only contentEditable or textarea)
      if (!selResult || !insertResult) {
        if (fb.tagName === "TEXTAREA" || fb.tagName === "INPUT") {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set
            || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(fb, dax);
          } else {
            fb.value = dax;
          }
        } else {
          // contentEditable — try keyboard shortcut path
          fb.textContent = dax;
        }
      }

      fb.dispatchEvent(new InputEvent("input",  { bubbles: true, composed: true, data: dax, inputType: "insertText" }));
      fb.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    },

    // Set the measure name in the formula bar
    writeMeasureName(name) {
      const candidates = [
        '[data-testid="measure-name-input"]',
        '[aria-label="Measure name"]',
        '[aria-label="Name"] input',
        '[placeholder*="Measure name"]',
        'input[class*="measureName"]',
        'input[class*="formulaBarName"]',
        '.formulaBar input[type="text"]',
        '[data-testid="formula-bar"] input[type="text"]',
      ];
      for (const sel of candidates) {
        const el = qs(sel);
        if (!el) continue;
        el.focus();
        // Use native setter so React/Angular state updates
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        if (nativeSetter) nativeSetter.call(el, name);
        else el.value = name;
        el.dispatchEvent(new InputEvent("input",  { bubbles: true, composed: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      return { ok: false, error: "Measure name input not found" };
    },

    // Click the commit (✓) button to save the formula bar change
    commitFormulaBar() {
      const candidates = [
        '[data-testid="commit-formula"]',
        '[aria-label="Commit"]',
        '[aria-label="Apply"]',
        '[title="Commit"]',
        '[title="Apply"]',
        '.formulaBar [class*="commit"]',
        '[class*="formulaBarCommit"]',
        '[class*="formulaBar"] [class*="confirm"]',
        // checkmark icon buttons near the formula bar
        '[data-testid="formula-bar"] button:first-of-type',
      ];
      for (const sel of candidates) {
        const btn = qs(sel);
        if (btn) { btn.click(); return { ok: true }; }
      }
      // Fallback: press Enter in formula bar
      const fb = qs('[data-testid="formula-bar-inner-editor"], .formulaBar [contenteditable]');
      if (fb) {
        fb.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
        return { ok: true, method: "keyboard" };
      }
      return { ok: false, error: "Commit button not found" };
    },

    // Click the "New measure" button (or trigger via right-click context menu)
    clickNewMeasure() {
      // ── Pass 1: direct selector candidates ─────────────────────────────────────
      const selectors = [
        '[data-testid="new-measure-button"]',
        '[data-testid="newMeasureButton"]',
        '[aria-label="New measure"]',
        '[aria-label*="New measure"]',
        'button[title="New measure"]',
        'button[title*="New measure"]',
        '[class*="newMeasure"]',
        '[class*="new-measure"]',
        '[role="button"][aria-label*="New measure"]',
        // Ribbon / toolbar buttons
        '[class*="ribbon"] button',
        '[class*="Ribbon"] button',
        '[class*="toolbar"] button',
        '[role="toolbar"] button',
        '[role="group"] button',
      ];
      for (const sel of selectors) {
        const candidates = qsa(sel);
        for (const el of candidates) {
          const label = (el.getAttribute("aria-label") || "").toLowerCase();
          const title = (el.getAttribute("title") || "").toLowerCase();
          const text  = el.textContent.trim().toLowerCase();
          if (label.includes("new measure") || title.includes("new measure") || text === "new measure") {
            el.click();
            return { ok: true, selector: sel };
          }
        }
      }

      // ── Pass 2: scan ALL buttons / interactive elements by text ────────────────
      const allInteractive = qsa('button, [role="button"], [role="menuitem"], [role="option"]');
      for (const el of allInteractive) {
        const text  = el.textContent.trim().toLowerCase();
        const label = (el.getAttribute("aria-label") || "").toLowerCase();
        const title = (el.getAttribute("title") || "").toLowerCase();
        if (text === "new measure" || label.includes("new measure") || title.includes("new measure")) {
          el.click();
          return { ok: true, method: "text-scan" };
        }
      }

      // ── Pass 3: right-click the first table in the Data/Fields pane ────────────
      // Power BI surfaces "New measure" via right-click on a table name
      const tablePaneSelectors = [
        '[data-testid*="table-header"]',
        '[class*="fieldListGroupHeader"]',
        '[class*="tableItem"]',
        '[class*="modelEntity"]',
        '[class*="entityHeader"]',
        '[class*="dataViewpane"] [role="treeitem"]',
        '[class*="fieldsPane"] [role="treeitem"]',
        '[class*="dataPane"] [role="treeitem"]',
        '[role="tree"] [role="treeitem"]',
      ];
      let tableEl = null;
      for (const sel of tablePaneSelectors) {
        const els = qsa(sel);
        if (els.length) { tableEl = els[0]; break; }
      }

      if (tableEl) {
        tableEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        return { ok: false, error: "Triggered right-click on table — waiting for context menu. Re-run the step." };
      }

      return { ok: false, error: "New measure button not found. Please ensure you are in Edit mode, then right-click a table in the Data pane and choose New Measure." };
    },

    // Find and click a visual by title (partial match)
    clickVisualByTitle(title) {
      const lc = title.toLowerCase();
      const visualEls = qsa('[data-testid="visual-container"], [class*="visualContainer"]');
      for (const el of visualEls) {
        const titleEl = el.querySelector('[class*="title"], [data-testid="visual-title"]');
        if (titleEl && textOf(titleEl).toLowerCase().includes(lc)) {
          el.click();
          return { ok: true, title: textOf(titleEl) };
        }
      }
      return { ok: false, error: `Visual "${title}" not found` };
    }
  };

  // ── Tableau DOM extraction ────────────────────────────────────────────────────

  const TABLEAU = {
    // Async variant — used when tableauAdapter is available (returns a Promise)
    async getPageStateAsync() {
      if (window.__tableauAdapter) {
        try {
          const state = await window.__tableauAdapter.getPageState();
          // Guarantee the standard envelope shape
          return {
            platform:    PLATFORMS.TABLEAU,
            source:      state.source || "api",
            hasViz:      state.hasViz !== false,
            activeSheet: state.activeSheet || "",
            sheetType:   state.sheetType   || "unknown",
            sheets:      state.sheets      || [],
            filters:     state.filters     || [],
            parameters:  state.parameters  || [],
            url:         location.href,
            title:       document.title
          };
        } catch (_) {
          // fall through to DOM fallback
        }
      }
      return this.getPageState();
    },

    // Synchronous DOM-level fallback (Tableau Public or when adapter not yet ready)
    getPageState() {
      const sheets      = qsa('[class*="tab-vizNav"] li, [data-tb-test-id*="sheet"]');
      const activeSheet = qs('[class*="tab-vizNav"] .tab-active, [data-tb-test-id*="sheet-active"]');
      const filters     = qsa('[class*="filter-shelf"] [class*="filter-item"]');

      return {
        platform:    PLATFORMS.TABLEAU,
        source:      "dom",
        hasViz:      sheets.length > 0 || Boolean(document.querySelector("tableau-viz")),
        activeSheet: textOf(activeSheet),
        sheets:      sheets.map(s => textOf(s)).filter(Boolean),
        filters:     filters.map(f => textOf(f)).filter(Boolean),
        parameters:  [],
        url:         location.href,
        title:       document.title
      };
    }
  };

  // ── Monaco / SQL editor extraction ───────────────────────────────────────────

  const SQL = {
    getEditorText() {
      // Monaco editor (Azure Data Studio, SSMS web, many SQL tools)
      const monacoEl = qs(".monaco-editor .view-lines");
      if (monacoEl) {
        return qsa(".view-line", monacoEl).map(l => l.textContent).join("\n");
      }
      // CodeMirror
      const cm = qs(".CodeMirror");
      if (cm && cm.CodeMirror) return cm.CodeMirror.getValue();
      // Fallback: textarea with SQL-ish class
      const ta = qs('textarea[class*="sql"], textarea[class*="query"], textarea[class*="editor"]');
      if (ta) return ta.value;
      return null;
    },

    getPageState() {
      return {
        platform: PLATFORMS.SQL_SERVER,
        editorText: SQL.getEditorText(),
        url: location.href,
        title: document.title
      };
    },

    writeToEditor(sql) {
      // Monaco
      if (window.monaco) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          models[0].setValue(sql);
          return { ok: true };
        }
      }
      // Textarea fallback
      const ta = qs('textarea[class*="sql"], textarea[class*="query"], textarea[class*="editor"]');
      if (ta) {
        ta.focus();
        ta.select();
        document.execCommand("insertText", false, sql);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        return { ok: true };
      }
      return { ok: false, error: "SQL editor not found" };
    }
  };

  // ── Error detection ──────────────────────────────────────────────────────────

  function detectErrors() {
    const errors = [];

    // Power BI error banners / notifications
    const errorEls = qsa(
      '[class*="errorBanner"], [class*="errorNotification"], [class*="notification-error"], ' +
      '[role="alert"], [class*="pbi-error"], [data-testid*="error"]'
    );
    errorEls.forEach(el => {
      const txt = textOf(el);
      if (txt && txt.length > 3) errors.push({ type: "banner", text: txt.slice(0, 200) });
    });

    // Formula bar red highlight (DAX error)
    const fbError = qs(
      '[class*="formulaBar"][class*="error"], [class*="formulaBar"] [class*="error"], ' +
      '[data-testid="formula-bar"] [class*="invalid"]'
    );
    if (fbError) errors.push({ type: "formula_bar", text: textOf(fbError).slice(0, 100) || "DAX error" });

    // Loading/busy states (not an error but useful context)
    const loading = qs('[class*="loading"], [class*="spinner"], [aria-busy="true"]');
    if (loading) errors.push({ type: "loading", text: "Page is still loading" });

    return errors;
  }

  // ── Power BI URL parsing ──────────────────────────────────────────────────────

  function parsePbiUrl() {
    const m = location.pathname.match(
      /\/groups\/([0-9a-f-]+)\/(?:reports|datasets)\/([0-9a-f-]+)/i
    );
    return {
      workspaceId: m ? m[1] : null,
      reportId:    m ? m[2] : null
    };
  }

  // ── Unified adapter ───────────────────────────────────────────────────────────

  const adapter = {
    platform: detectPlatform(),

    // Async version — used internally so Tableau can await the adapter API
    async getPageStateAsync() {
      switch (this.platform) {
        case PLATFORMS.POWER_BI: {
          const state = PBI.getPageState();
          Object.assign(state, parsePbiUrl());
          state.errors = detectErrors();
          return state;
        }
        case PLATFORMS.TABLEAU: {
          const state = await TABLEAU.getPageStateAsync();
          state.errors = detectErrors();
          return state;
        }
        case PLATFORMS.SQL_SERVER:
        case PLATFORMS.METABASE: {
          const state = SQL.getPageState();
          state.errors = detectErrors();
          return state;
        }
        default:
          return {
            platform: PLATFORMS.UNKNOWN,
            url:      location.href,
            title:    document.title,
            errors:   detectErrors(),
            bodyText: document.body.innerText.slice(0, 2000)
          };
      }
    },

    // Synchronous fallback — kept for backward compatibility
    getPageState() {
      let state;
      switch (this.platform) {
        case PLATFORMS.POWER_BI:
          state = PBI.getPageState();
          Object.assign(state, parsePbiUrl());
          state.errors = detectErrors();
          return state;
        case PLATFORMS.TABLEAU:
          state = TABLEAU.getPageState();
          state.errors = detectErrors();
          return state;
        case PLATFORMS.SQL_SERVER:
        case PLATFORMS.METABASE:
          state = SQL.getPageState();
          state.errors = detectErrors();
          return state;
        default:
          return {
            platform: PLATFORMS.UNKNOWN,
            url:      location.href,
            title:    document.title,
            errors:   detectErrors(),
            bodyText: document.body.innerText.slice(0, 2000)
          };
      }
    },

    detectErrors,

    // Extract modelContext for daxEngine.analyzeRuleMatches
    getModelContext() {
      if (this.platform !== PLATFORMS.POWER_BI) return {};
      const fields = PBI.getFields();
      // Build columnTypes from field list heuristics
      const columnTypes = {};
      fields.tables.forEach(table => {
        table.fields.forEach(field => {
          // Heuristics: date fields, numeric fields
          if (/date|time|year|month|quarter|week/i.test(field)) {
            columnTypes[`${table.name}[${field}]`] = "datetime";
          } else if (/amount|qty|quantity|count|price|cost|revenue|sales|balance|total|num|id$/i.test(field)) {
            columnTypes[`${table.name}[${field}]`] = "decimal";
          } else {
            columnTypes[`${table.name}[${field}]`] = "text";
          }
        });
      });
      return { columnTypes };
    },

    // Platform-specific writes
    writeDax(dax) {
      if (this.platform !== PLATFORMS.POWER_BI)
        return { ok: false, error: "DAX writing only supported on Power BI" };
      // Try formula bar first
      const r1 = PBI.writeDaxToFormulaBar(dax);
      if (r1.ok) return r1;
      // Try measure editor if it is open
      if (PBI.getMeasureEditorDax() !== null) {
        const editor = qs(
          '[class*="measureDialog"] [contenteditable], ' +
          '[aria-label*="measure"] [contenteditable]'
        );
        if (editor) {
          editor.focus();
          document.execCommand("selectAll");
          document.execCommand("insertText", false, dax);
          editor.dispatchEvent(new Event("input", { bubbles: true }));
          return { ok: true };
        }
      }
      return { ok: false, error: "Formula bar not found. Select a measure first." };
    },

    writeSQL(sql) {
      return SQL.writeToEditor(sql);
    },

    clickNewMeasure() {
      return PBI.clickNewMeasure();
    },

    writeMeasureName(name) {
      if (this.platform !== PLATFORMS.POWER_BI)
        return { ok: false, error: "Only supported on Power BI" };
      return PBI.writeMeasureName(name);
    },

    commitFormulaBar() {
      if (this.platform !== PLATFORMS.POWER_BI)
        return { ok: false, error: "Only supported on Power BI" };
      return PBI.commitFormulaBar();
    },

    clickVisualByTitle(title) {
      return PBI.clickVisualByTitle(title);
    }
  };

  window.__dataAnalystAdapter = adapter;

  // ── Content-script message handler ───────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = message?.type;

    if (type === "ADAPTER_GET_STATE") {
      // Use async path so Tableau can await the Embedding API
      adapter.getPageStateAsync()
        .then(state => sendResponse({ ok: true, state }))
        .catch(e    => {
          // Sync fallback on error
          try { sendResponse({ ok: true, state: adapter.getPageState() }); }
          catch (e2) { sendResponse({ ok: false, error: e2.message }); }
        });
      return true; // keep channel open for async response
      return true;
    }

    if (type === "ADAPTER_GET_MODEL_CONTEXT") {
      try {
        sendResponse({ ok: true, modelContext: adapter.getModelContext() });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }

    if (type === "ADAPTER_WRITE_DAX") {
      try {
        sendResponse(adapter.writeDax(message.dax));
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }

    if (type === "ADAPTER_WRITE_SQL") {
      try {
        sendResponse(adapter.writeSQL(message.sql));
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }

    if (type === "ADAPTER_CLICK_NEW_MEASURE") {
      try {
        sendResponse(adapter.clickNewMeasure());
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }

    if (type === "ADAPTER_WRITE_MEASURE_NAME") {
      try {
        sendResponse(adapter.writeMeasureName(message.name));
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }

    if (type === "ADAPTER_COMMIT_FORMULA") {
      try {
        sendResponse(adapter.commitFormulaBar());
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }

    if (type === "ADAPTER_CLICK_VISUAL") {
      try {
        sendResponse(adapter.clickVisualByTitle(message.title));
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }

    // Ping — used by side panel to confirm content script is loaded
    if (type === "ADAPTER_PING") {
      const ids = adapter.platform === "power_bi" ? parsePbiUrl() : {};
      sendResponse({ ok: true, platform: adapter.platform, ...ids });
      return true;
    }

    if (type === "ADAPTER_DETECT_ERRORS") {
      try {
        sendResponse({ ok: true, errors: detectErrors() });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }
  });
})();
