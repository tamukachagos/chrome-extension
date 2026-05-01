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
          fallbackEndpoint: "http://localhost:3003/fallback",
          fallbackThreshold: 92,
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;

  if (type === "PBI_CAPTURE_VISIBLE_TAB" || type === "TAKE_SCREENSHOT") {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, dataUrl, capturedAt: new Date().toISOString() });
      }
    });
    return true;
  }

  // Proxy fetch requests through the service worker to avoid mixed-content blocks
  // when content scripts on HTTPS pages try to reach http://localhost
  if (type === "PBI_PROXY_FETCH") {
    const { url, body } = message;
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

const PBI_SCRIPTS = [
  "src/daxEngine.js",
  "src/ruleLoader.js",
  "src/skills.js",
  "src/contentScript.js"
];

function isPowerBiTab(url) {
  return url && (url.startsWith("https://app.powerbi.com/") || url.includes(".powerbi.com/"));
}

// Returns false for chrome://, edge://, about:, chrome-extension://, and other
// restricted schemes where scripting.executeScript will always fail and log errors.
function isInjectablePage(url) {
  if (!url) return false;
  const blocked = ["chrome://", "chrome-extension://", "edge://", "about:", "data:", "javascript:", "file:///"];
  return !blocked.some(prefix => url.startsWith(prefix));
}

// Auto-inject when a Power BI tab finishes loading
// Debounce per tab to avoid double-injecting on SPA navigations
const _injected = new Set();
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isPowerBiTab(tab.url)) {
    if (_injected.has(tabId)) return; // already injected this session
    _injected.add(tabId);
    chrome.scripting.executeScript({
      target: { tabId },
      files: PBI_SCRIPTS
    }).catch(() => {});
  }
});

// Clear injection record when tab navigates to a new page
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    _injected.delete(tabId); // allow re-inject on next complete
  }
});

chrome.tabs.onRemoved.addListener(tabId => _injected.delete(tabId));

// Also inject into any already-open Power BI tabs on startup
chrome.runtime.onStartup.addListener(() => {
  chrome.tabs.query({ url: ["https://app.powerbi.com/*", "https://*.powerbi.com/*"] }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.scripting.executeScript({ target: { tabId: tab.id }, files: PBI_SCRIPTS }).catch(() => {});
      }
    }
  });
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;

  // Never try to inject into restricted pages — doing so logs an error every time
  if (!isInjectablePage(tab.url)) return;

  chrome.tabs.sendMessage(tab.id, { type: "PBI_COPILOT_TOGGLE" }, () => {
    if (chrome.runtime.lastError) {
      // Content script not present — inject fresh (only on injectable pages)
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: PBI_SCRIPTS
      }).catch(() => {});
    }
  });
});
