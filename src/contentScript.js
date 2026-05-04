/**
 * contentScript.js — minimal content-script shim
 *
 * The full floating-panel UI has been replaced by the persistent Chrome
 * side panel (src/sidepanel.html). This file now only:
 *   1. Guards against double-injection
 *   2. Loads the advanced DAX rules into PowerBIDaxEngine (Power BI pages only)
 *   3. Wires the legacy pbi-copilot-toggle event to a no-op so old bookmarks don't throw
 */

(function () {
  if (window.__dataAnalystContentLoaded) return;
  window.__dataAnalystContentLoaded = true;

  // Load advanced rules into the DAX engine once the rule loader and engine are ready
  function tryLoadAdvancedRules() {
    if (
      window.PowerBIRuleLoader?.loadRulePacks &&
      window.PowerBIDaxEngine?.setRules
    ) {
      // Load rules_advanced.json (the 91-rule training set) if available
      const advUrl = chrome.runtime.getURL("training/rules_advanced.json");
      fetch(advUrl)
        .then(r => r.ok ? r.json() : null)
        .then(rules => {
          if (Array.isArray(rules) && rules.length) {
            window.PowerBIDaxEngine.setRules(rules);
          } else {
            // Fall back to the standard rule packs
            window.PowerBIRuleLoader.loadRulePacks().catch(() => {});
          }
        })
        .catch(() => {
          window.PowerBIRuleLoader.loadRulePacks().catch(() => {});
        });
    }
  }

  // ruleLoader / daxEngine are loaded before contentScript in the manifest
  if (document.readyState === "complete" || document.readyState === "interactive") {
    tryLoadAdvancedRules();
  } else {
    document.addEventListener("DOMContentLoaded", tryLoadAdvancedRules, { once: true });
  }

  // Suppress legacy toggle event so old in-page bookmarks don't throw errors
  window.addEventListener("pbi-copilot-toggle", () => {}, { passive: true });
})();
