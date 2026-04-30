chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["pbiKnowledge"], (result) => {
    if (!Array.isArray(result.pbiKnowledge)) {
      chrome.storage.local.set({
        pbiKnowledge: [
          {
            title: "Measure naming",
            body: "Use clear business names like Total Sales, Gross Margin %, YoY Revenue Growth. Prefix hidden helper measures with an underscore."
          },
          {
            title: "Visual design",
            body: "Prefer bar and column charts for comparison, line charts for trends, cards for headline KPIs, matrices for detailed cross-tab analysis, and scatter charts for relationship/outlier analysis."
          },
          {
            title: "DAX safety",
            body: "Use DIVIDE instead of / for ratios, keep base measures reusable, and use a marked date table for time intelligence."
          }
        ],
        pbiSettings: {
          settingsVersion: 2,
          aiEndpoint: "",
          aiMode: "local",
          fallbackEnabled: false,
          fallbackEndpoint: "http://localhost:8787/fallback",
          fallbackThreshold: 72,
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
        }
      });
    }
  });
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;

  chrome.tabs.sendMessage(tab.id, { type: "PBI_COPILOT_TOGGLE" }, () => {
    if (chrome.runtime.lastError) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/ruleLoader.js", "src/skills.js", "src/contentScript.js"]
      });
    }
  });
});
