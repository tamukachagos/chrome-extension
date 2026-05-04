/**
 * tableauAdapter.js — Tableau Embedding API integration (content script)
 *
 * Supports:
 *   - Tableau Cloud / Server embedded views (Embedding API v3 + legacy JS API v1)
 *   - Tableau Public (DOM-level read + limited interaction)
 *
 * Exposed on window.__tableauAdapter.
 * Message handler: responds to { type: "TABLEAU_*" } messages.
 *
 * What this enables (that was previously impossible):
 *   - Read all sheets, filters, parameters, marks from the live viz
 *   - Apply dashboard filters programmatically ("filter to Q4 2024")
 *   - Navigate between sheets / tabs
 *   - Change parameter values
 *   - Select/highlight marks for focused analysis
 *   - Export the current view as an image
 *   - Surface full page state (sheet names, filter values, active data)
 *   - Power the insight engine with current filter context
 */

(function () {
  if (window.__tableauAdapter) return;

  // ── API detection ─────────────────────────────────────────────────────────────

  function getVizElement() {
    // Embedding API v3: <tableau-viz> custom element
    const v3 = document.querySelector("tableau-viz, tableau-authoring-viz");
    if (v3) return { el: v3, version: 3 };
    // Legacy JS API v1: window.tableau.VizManager
    if (window.tableau?.VizManager) {
      const vizzes = window.tableau.VizManager.getVizzes();
      if (vizzes?.length) return { el: vizzes[0], version: 1 };
    }
    return null;
  }

  function getWorkbook(vizInfo) {
    if (!vizInfo) return null;
    const { el, version } = vizInfo;
    if (version === 3) return el.workbook || null;
    if (version === 1) return el.getWorkbook?.() || null;
    return null;
  }

  function getActiveSheet(vizInfo) {
    const wb = getWorkbook(vizInfo);
    if (!wb) return null;
    return wb.activeSheet || wb.getActiveSheet?.() || null;
  }

  function sheetName(sheet) {
    return sheet?.name || sheet?.getName?.() || "";
  }

  function sheetType(sheet) {
    return sheet?.sheetType || sheet?.getSheetType?.() || "unknown";
  }

  // ── DOM fallback for Tableau Public ──────────────────────────────────────────
  // When the embedding API is unavailable, extract state from the DOM.

  function domPageState() {
    const state = { platform: "tableau", source: "dom", hasViz: false };

    // Sheet tabs
    const tabEls = document.querySelectorAll(
      ".tabNav li, [data-tb-test-id*='tab-'], .tab-text, .tab-viz-nav li"
    );
    state.sheets = Array.from(tabEls).map(el => el.textContent.trim()).filter(Boolean);

    const activeTab = document.querySelector(
      ".tabNav .tab-selected, [data-tb-test-id*='tab-active'], .tab-viz-nav .active"
    );
    state.activeSheet = activeTab?.textContent.trim() || "";

    // Filters (rendered as dropdowns or quick filter cards)
    const filterEls = document.querySelectorAll(
      "[class*='filter'] [class*='title'], [data-tb-test-id*='filter-name']"
    );
    state.filters = Array.from(filterEls).map(el => el.textContent.trim()).filter(Boolean);

    // Marks / tooltips surfaced
    const markEls = document.querySelectorAll("[class*='mark-label'], [class*='viz-marks-label']");
    state.visibleMarks = Array.from(markEls).slice(0, 20).map(el => el.textContent.trim());

    state.url   = location.href;
    state.title = document.title;
    state.hasViz = state.sheets.length > 0;
    return state;
  }

  // ── Main adapter ──────────────────────────────────────────────────────────────

  const adapter = {

    // Full page state — used by the side panel for context
    async getPageState() {
      const vizInfo = getVizElement();
      if (!vizInfo) return domPageState();

      const wb    = getWorkbook(vizInfo);
      const sheet = getActiveSheet(vizInfo);
      const state = {
        platform:    "tableau",
        source:      `api-v${vizInfo.version}`,
        hasViz:      true,
        activeSheet: sheetName(sheet),
        sheetType:   sheetType(sheet),
        url:         location.href,
        title:       document.title,
        sheets:      [],
        filters:     [],
        parameters:  []
      };

      try {
        // Sheets
        const sheetsInfo = wb?.publishedSheetsInfo || wb?.getPublishedSheetsInfo?.() || [];
        state.sheets = sheetsInfo.map(s => ({
          name: sheetName(s),
          type: sheetType(s)
        }));
      } catch (_) {}

      try {
        // Filters on active sheet
        const filters = await (sheet?.getFiltersAsync?.() || Promise.resolve([]));
        state.filters = filters.map(f => ({
          fieldName:     f.fieldName   || f.getFieldName?.()   || "",
          filterType:    f.filterType  || f.getFilterType?.()  || "",
          appliedValues: (f.appliedValues || f.getAppliedValues?.() || []).map(v =>
            v.formattedValue || v.value || String(v)
          ).slice(0, 10)
        }));
      } catch (_) {}

      try {
        // Parameters
        const params = await (wb?.getParametersAsync?.() || Promise.resolve([]));
        state.parameters = params.map(p => ({
          name:         p.name         || p.getName?.()         || "",
          currentValue: p.currentValue || p.getCurrentValue?.() || "",
          dataType:     p.dataType     || p.getDataType?.()     || ""
        }));
      } catch (_) {}

      return state;
    },

    // Navigate to a named sheet
    async activateSheet(name) {
      const vizInfo = getVizElement();
      const wb = getWorkbook(vizInfo);
      if (!wb) throw new Error("Tableau workbook not found — is this an embedded viz?");
      await (wb.activateSheetAsync?.(name) || Promise.reject(new Error("activateSheetAsync not available")));
      return { ok: true, sheet: name };
    },

    // Apply a filter to the active sheet
    async applyFilter(fieldName, values, updateType = "replace") {
      const vizInfo = getVizElement();
      const sheet   = getActiveSheet(vizInfo);
      if (!sheet) throw new Error("No active Tableau sheet");

      // Normalise to array
      const vals = Array.isArray(values) ? values : [values];

      // Try Embedding API v3 filter methods
      if (sheet.applyFilterAsync) {
        const FilterUpdateType = window.tableau?.FilterUpdateType || {
          REPLACE: "replace", ADD: "add", REMOVE: "remove", ALL: "all"
        };
        const mode = FilterUpdateType[updateType.toUpperCase()] || FilterUpdateType.REPLACE || "replace";
        await sheet.applyFilterAsync(fieldName, vals, mode);
        return { ok: true, fieldName, values: vals, mode };
      }

      // DOM fallback: find quick-filter dropdown and select the value
      const filterContainers = document.querySelectorAll("[class*='quick-filter'], [data-tb-test-id*='filter']");
      for (const container of filterContainers) {
        const label = container.querySelector("[class*='title'], [class*='label']");
        if (!label || !label.textContent.toLowerCase().includes(fieldName.toLowerCase())) continue;
        // Try checkbox list
        const checkboxes = container.querySelectorAll("input[type='checkbox']");
        for (const cb of checkboxes) {
          const cbLabel = cb.closest("label") || cb.nextElementSibling;
          const cbText  = cbLabel?.textContent.trim() || "";
          if (vals.some(v => String(v).toLowerCase() === cbText.toLowerCase())) {
            if (!cb.checked) cb.click();
          } else if (updateType === "replace" && cb.checked) {
            cb.click(); // deselect
          }
        }
        return { ok: true, method: "dom", fieldName, values: vals };
      }

      throw new Error(`Could not apply filter — field "${fieldName}" not found on active sheet`);
    },

    // Remove a filter
    async clearFilter(fieldName) {
      const vizInfo = getVizElement();
      const sheet   = getActiveSheet(vizInfo);
      if (sheet?.clearFilterAsync) {
        await sheet.clearFilterAsync(fieldName);
        return { ok: true };
      }
      return this.applyFilter(fieldName, [], "all");
    },

    // Set a parameter value
    async setParameter(name, value) {
      const vizInfo = getVizElement();
      const wb = getWorkbook(vizInfo);
      if (!wb) throw new Error("No Tableau workbook");
      if (wb.changeParameterValueAsync) {
        await wb.changeParameterValueAsync(name, value);
        return { ok: true, name, value };
      }
      throw new Error("changeParameterValueAsync not available");
    },

    // Get current filter values
    async getFilters() {
      const vizInfo = getVizElement();
      const sheet   = getActiveSheet(vizInfo);
      if (!sheet?.getFiltersAsync) return [];
      const filters = await sheet.getFiltersAsync();
      return filters.map(f => ({
        fieldName:     f.fieldName   || f.getFieldName?.()   || "",
        appliedValues: (f.appliedValues || f.getAppliedValues?.() || []).map(v =>
          v.formattedValue || String(v)
        )
      }));
    },

    // Select marks matching a value
    async selectMarks(fieldName, values) {
      const vizInfo = getVizElement();
      const sheet   = getActiveSheet(vizInfo);
      if (!sheet?.selectMarksByValueAsync) throw new Error("selectMarksByValueAsync not available");
      const SelectionUpdateType = window.tableau?.SelectionUpdateType || { REPLACE: "replace" };
      const criteria = [{ fieldName, value: Array.isArray(values) ? values : [values] }];
      await sheet.selectMarksByValueAsync(criteria, SelectionUpdateType.REPLACE || "replace");
      return { ok: true };
    },

    // Export current view as image (opens download)
    async exportImage() {
      const vizInfo = getVizElement();
      if (vizInfo?.el?.exportImageAsync) {
        await vizInfo.el.exportImageAsync();
        return { ok: true, method: "api" };
      }
      // DOM fallback: find export button
      const exportBtn = document.querySelector(
        "[data-tb-test-id='toolbar-download-image'], [class*='download-image'], [aria-label*='Download image']"
      );
      if (exportBtn) { exportBtn.click(); return { ok: true, method: "dom" }; }
      throw new Error("Export image not available");
    },

    // Get summary data from active sheet (Embedding API v3 only)
    async getSummaryData(maxRows = 100) {
      const vizInfo = getVizElement();
      const sheet   = getActiveSheet(vizInfo);
      if (!sheet?.getSummaryDataAsync) throw new Error("getSummaryDataAsync not available (requires Embedding API v3)");
      const data = await sheet.getSummaryDataAsync({ maxRows });
      const columns = (data.columns || []).map(c => c.fieldName || c.name || "");
      const rows    = (data.data || []).map(row =>
        Object.fromEntries(row.map((cell, i) => [columns[i], cell.formattedValue || cell.value]))
      );
      return { columns, rows, totalRowCount: data.totalRowCount };
    }
  };

  window.__tableauAdapter = adapter;

  // ── Message handler ───────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg?.type?.startsWith("TABLEAU_")) return;

    const dispatch = {
      TABLEAU_GET_STATE:      () => adapter.getPageState(),
      TABLEAU_GET_FILTERS:    () => adapter.getFilters(),
      TABLEAU_APPLY_FILTER:   () => adapter.applyFilter(msg.fieldName, msg.values, msg.updateType),
      TABLEAU_CLEAR_FILTER:   () => adapter.clearFilter(msg.fieldName),
      TABLEAU_ACTIVATE_SHEET: () => adapter.activateSheet(msg.name),
      TABLEAU_SET_PARAMETER:  () => adapter.setParameter(msg.name, msg.value),
      TABLEAU_SELECT_MARKS:   () => adapter.selectMarks(msg.fieldName, msg.values),
      TABLEAU_EXPORT_IMAGE:   () => adapter.exportImage(),
      TABLEAU_GET_DATA:       () => adapter.getSummaryData(msg.maxRows || 100),
    };

    const fn = dispatch[msg.type];
    if (!fn) {
      sendResponse({ ok: false, error: `Unknown Tableau message type: ${msg.type}` });
      return true;
    }

    fn()
      .then(result => sendResponse({ ok: true, result }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  });

  // Auto-detect and report viz load to side panel
  function notifyVizLoaded() {
    const vizInfo = getVizElement();
    if (!vizInfo) return;
    adapter.getPageState()
      .then(state => chrome.runtime.sendMessage({ type: "TABLEAU_VIZ_LOADED", state }).catch(() => {}))
      .catch(() => {});
  }

  // Tableau Embedding API v3 fires a "firstinteractive" event on the element
  document.querySelectorAll("tableau-viz, tableau-authoring-viz").forEach(el => {
    el.addEventListener("firstinteractive", notifyVizLoaded, { once: true });
  });

  // MutationObserver: watch for tableau-viz being added dynamically
  new MutationObserver(() => {
    const el = document.querySelector("tableau-viz:not([data-__da-watched])");
    if (el) {
      el.setAttribute("data-__da-watched", "1");
      el.addEventListener("firstinteractive", notifyVizLoaded, { once: true });
    }
  }).observe(document.body || document.documentElement, { childList: true, subtree: true });

  // Also try immediately (for already-loaded vizzes)
  setTimeout(notifyVizLoaded, 2000);
})();
