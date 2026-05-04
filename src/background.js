/**
 * background.js — Service worker
 *
 * Responsibilities:
 *   1. Message hub (RELAY_TO_CONTENT, SCREENSHOT_TAB, etc.)
 *   2. KPI monitoring — Chrome alarms poll KPIs against thresholds every N minutes
 *   3. Session memory — persist conversation history so panel can resume after close
 *   4. Badge — shows count of active alerts
 *   5. Workspace refresh tracking
 */

// ── Install defaults ──────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["pbiKnowledge"], (result) => {
    if (!Array.isArray(result.pbiKnowledge)) {
      chrome.storage.local.set({
        pbiKnowledge: [
          { title: "Measure naming", body: "Use clear business names like Total Sales, Gross Margin %, YoY Revenue Growth. Prefix hidden helper measures with an underscore." },
          { title: "Visual design", body: "Prefer bar and column charts for comparison, line charts for trends, cards for headline KPIs, matrices for detailed cross-tab analysis, and scatter charts for relationship/outlier analysis." },
          { title: "DAX safety", body: "Use DIVIDE instead of / for ratios, keep base measures reusable, and use a marked date table for time intelligence." }
        ],
        pbiSettings: {
          settingsVersion: 4,
          proxyEndpoint: "http://localhost:3003",
          aiMode: "claude",
          activeSkills: ["architect-mode","dax-expert","visual-design","semantic-model","kpi-glossary","performance","power-query","security-rls","service-ops"],
          monitoring: { enabled: false, intervalMinutes: 30 }
        },
        kpiRegistry:   [],
        kpiAlerts:     [],
        modelMemory:   {},
        sessionMemory: {}   // keyed by host, stores conversation history
      });
    }
  });

  // (Re)create KPI monitoring alarm on install/update
  chrome.alarms.create("kpi-monitor", { periodInMinutes: 30 });
  chrome.alarms.create("kpi-digest",  { periodInMinutes: 60 * 24 }); // daily digest
});

// ── KPI monitoring ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "kpi-monitor") await runKpiMonitor();
  if (alarm.name === "kpi-digest")  await runDailyDigest();
});

async function runKpiMonitor() {
  const data = await chrome.storage.local.get(["kpiRegistry", "pbiSettings", "kpiAlerts"]);
  const settings = data.pbiSettings || {};
  if (!settings.monitoring?.enabled) return;

  const kpis = (data.kpiRegistry || []).filter(
    k => k.monitoring?.enabled && k.dax && k.monitoring?.pbiIds?.datasetId
  );
  if (!kpis.length) return;

  // Read token from session storage (persisted by pbiApi.js when it captures one)
  const session = await chrome.storage.session.get(["pbiToken", "pbiTokenAt"]).catch(() => ({}));
  const token   = session.pbiToken;
  const tokenAge = Date.now() - (session.pbiTokenAt || 0);
  if (!token || tokenAge > 55 * 60 * 1000) return; // token expired

  const existingAlerts = data.kpiAlerts || [];
  const newAlerts = [...existingAlerts];
  let alertsFired = 0;

  for (const kpi of kpis) {
    try {
      const value = await pollKpiValue(kpi, token);
      if (value === null) continue;

      const { threshold, direction = "below", changeThresholdPct } = kpi.monitoring;
      let triggered = false;
      let reason = "";

      if (direction === "below" && value < threshold) {
        triggered = true;
        reason = `${kpi.name} is ${value} — below threshold ${threshold}`;
      } else if (direction === "above" && value > threshold) {
        triggered = true;
        reason = `${kpi.name} is ${value} — above threshold ${threshold}`;
      } else if (direction === "change_pct" && changeThresholdPct) {
        // Compare to last known value
        const lastAlert = existingAlerts.find(a => a.kpiId === kpi.id);
        const lastVal   = lastAlert?.lastValue;
        if (lastVal !== undefined && lastVal !== null) {
          const pctChange = Math.abs((value - lastVal) / (lastVal || 1)) * 100;
          if (pctChange >= changeThresholdPct) {
            triggered = true;
            reason = `${kpi.name} changed ${pctChange.toFixed(1)}% (${lastVal} → ${value})`;
          }
        }
      }

      // Update or insert alert record
      const alertIdx = newAlerts.findIndex(a => a.kpiId === kpi.id);
      const alertRecord = {
        kpiId:       kpi.id,
        kpiName:     kpi.name,
        triggered,
        reason,
        lastValue:   value,
        checkedAt:   new Date().toISOString()
      };
      if (alertIdx >= 0) newAlerts[alertIdx] = alertRecord;
      else newAlerts.push(alertRecord);

      if (triggered) {
        alertsFired++;
        chrome.notifications.create(`kpi-${kpi.id}-${Date.now()}`, {
          type:    "basic",
          iconUrl: "icons/icon48.png",
          title:   "⚠️ KPI Alert — Data Analyst AI",
          message: reason,
          buttons: [{ title: "Open Report" }]
        });
        // Broadcast to side panel so it can update UI and trigger Slack
        chrome.runtime.sendMessage({
          type:      "KPI_ALERT",
          kpiId:     kpi.id,
          kpiName:   kpi.name,
          value,
          threshold: kpi.monitoring.threshold,
          direction: kpi.monitoring.direction,
          reason
        }).catch(() => {}); // silently ignore if side panel is not open
      }
    } catch (e) {
      console.warn(`[KPI Monitor] Failed to poll ${kpi.name}:`, e.message);
    }
  }

  await chrome.storage.local.set({ kpiAlerts: newAlerts });
  updateBadge(newAlerts.filter(a => a.triggered).length);
}

async function pollKpiValue(kpi, token) {
  const { datasetId } = kpi.monitoring.pbiIds;
  const dax  = kpi.dax || `EVALUATE ROW("Value", [${kpi.name}])`;
  const res  = await fetch(`https://api.powerbi.com/v1.0/myorg/datasets/${datasetId}/executeQueries`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ queries: [{ query: dax }], serializerSettings: { includeNulls: true } })
  });
  if (!res.ok) return null;
  const data = await res.json();
  const row  = data?.results?.[0]?.tables?.[0]?.rows?.[0];
  if (!row) return null;
  const firstVal = Object.values(row)[0];
  return typeof firstVal === "number" ? firstVal : null;
}

async function runDailyDigest() {
  const data = await chrome.storage.local.get(["kpiRegistry", "pbiSettings", "kpiAlerts"]);
  const alerts = (data.kpiAlerts || []).filter(a => a.triggered);
  if (!alerts.length) return;

  chrome.notifications.create("daily-digest", {
    type:    "basic",
    iconUrl: "icons/icon48.png",
    title:   "📊 Daily KPI Digest — Data Analyst AI",
    message: `${alerts.length} KPI${alerts.length > 1 ? "s" : ""} need attention: ${alerts.map(a => a.kpiName).join(", ")}`,
  });
}

function updateBadge(count) {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: count > 0 ? "#ef4444" : "#22c55e" });
}

// ── Session memory ────────────────────────────────────────────────────────────
// Stores conversation history so the panel can resume after it's closed.
// Keyed by the tab's hostname so each site has its own context.

async function saveSessionMemory(host, history) {
  const r = await chrome.storage.local.get(["sessionMemory"]);
  const mem = r.sessionMemory || {};
  mem[host] = { history: history.slice(-20), savedAt: Date.now() };
  // Keep at most 10 hosts
  const keys = Object.keys(mem).sort((a, b) => (mem[b].savedAt || 0) - (mem[a].savedAt || 0));
  if (keys.length > 10) keys.slice(10).forEach(k => delete mem[k]);
  return chrome.storage.local.set({ sessionMemory: mem });
}

async function loadSessionMemory(host) {
  const r = await chrome.storage.local.get(["sessionMemory"]);
  const entry = (r.sessionMemory || {})[host];
  if (!entry) return [];
  // Discard if older than 8 hours
  if (Date.now() - entry.savedAt > 8 * 60 * 60 * 1000) return [];
  return entry.history || [];
}

// ── Notification clicks ───────────────────────────────────────────────────────

chrome.notifications.onButtonClicked.addListener((notifId) => {
  // Open the Power BI workspace when "Open Report" is clicked on a KPI alert
  chrome.tabs.query({ url: "https://app.powerbi.com/*" }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: "https://app.powerbi.com" });
    }
  });
});

// ── Message hub ───────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;

  // Screenshots
  if (type === "TAKE_SCREENSHOT" || type === "PBI_CAPTURE_VISIBLE_TAB") {
    const windowId = sender?.tab?.windowId || null;
    const capture = (wId) => {
      chrome.tabs.captureVisibleTab(wId, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, dataUrl, capturedAt: new Date().toISOString() });
        }
      });
    };
    if (windowId) capture(windowId);
    else chrome.windows.getCurrent((win) => capture(win.id));
    return true;
  }

  if (type === "GET_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ tab: tabs[0] || null });
    });
    return true;
  }

  if (type === "RELAY_TO_CONTENT") {
    const { tabId, payload } = message;
    if (!tabId) { sendResponse({ ok: false, error: "No tabId" }); return false; }

    const CONTENT_SCRIPTS = [
      "src/pbiApi.js",           // must be first — token interceptor
      "src/daxEngine.js", "src/ruleLoader.js", "src/skills.js",
      "src/platformAdapter.js", "src/actionExecutor.js", "src/contentScript.js"
    ];

    const trySend = (callback) =>
      chrome.tabs.sendMessage(tabId, payload, (resp) => {
        const err = chrome.runtime.lastError;
        callback(err ? null : resp, err?.message || null);
      });

    trySend(async (resp, errMsg) => {
      if (!errMsg) { sendResponse(resp || { ok: true }); return; }

      // Content script not loaded (tab was open before extension reload) — inject and retry
      const isDisconnected = errMsg.includes("Receiving end does not exist") ||
                             errMsg.includes("Could not establish connection");
      if (isDisconnected) {
        try {
          // Inject token capture in MAIN world first (must be before isolated-world scripts)
          await chrome.scripting.executeScript({ target: { tabId }, files: ["src/pbiTokenCapture.js"], world: "MAIN" });
          await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS });
          await new Promise(r => setTimeout(r, 600)); // let scripts initialise
          trySend((resp2, err2) => {
            sendResponse(err2 ? { ok: false, error: err2 } : (resp2 || { ok: true }));
          });
        } catch (injectErr) {
          sendResponse({ ok: false, error: `Injection failed: ${injectErr.message}` });
        }
      } else {
        sendResponse({ ok: false, error: errMsg });
      }
    });
    return true;
  }

  if (type === "SCREENSHOT_TAB") {
    const { tabId } = message;
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        sendResponse({ ok: false, error: "Tab not found" });
        return;
      }
      chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, dataUrl, capturedAt: new Date().toISOString() });
        }
      });
    });
    return true;
  }

  // Model memory
  if (type === "SAVE_MODEL_MEMORY") {
    chrome.storage.local.get(["modelMemory"], (r) => {
      const mem = r.modelMemory || {};
      const key = message.host || "default";
      mem[key] = { ...mem[key], ...message.data, updatedAt: Date.now() };
      chrome.storage.local.set({ modelMemory: mem }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  if (type === "LOAD_MODEL_MEMORY") {
    chrome.storage.local.get(["modelMemory"], (r) => {
      const key = message.host || "default";
      sendResponse({ ok: true, data: (r.modelMemory || {})[key] || {} });
    });
    return true;
  }

  // Session memory (conversation history persistence)
  if (type === "SAVE_SESSION_MEMORY") {
    saveSessionMemory(message.host, message.history)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (type === "LOAD_SESSION_MEMORY") {
    loadSessionMemory(message.host)
      .then(history => sendResponse({ ok: true, history }))
      .catch(e => sendResponse({ ok: false, error: e.message, history: [] }));
    return true;
  }

  // KPI registry
  if (type === "SAVE_KPI") {
    chrome.storage.local.get(["kpiRegistry"], (r) => {
      const reg = r.kpiRegistry || [];
      const idx = reg.findIndex((k) => k.id === message.kpi.id);
      if (idx >= 0) reg[idx] = message.kpi; else reg.push(message.kpi);
      chrome.storage.local.set({ kpiRegistry: reg }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  if (type === "GET_KPIS") {
    chrome.storage.local.get(["kpiRegistry"], (r) => {
      sendResponse({ ok: true, kpis: r.kpiRegistry || [] });
    });
    return true;
  }

  if (type === "DELETE_KPI") {
    chrome.storage.local.get(["kpiRegistry"], (r) => {
      const reg = (r.kpiRegistry || []).filter((k) => k.id !== message.id);
      chrome.storage.local.set({ kpiRegistry: reg }, () => sendResponse({ ok: true }));
    });
    return true;
  }

  // KPI alerts
  if (type === "GET_ALERTS") {
    chrome.storage.local.get(["kpiAlerts"], (r) => {
      sendResponse({ ok: true, alerts: r.kpiAlerts || [] });
    });
    return true;
  }

  if (type === "CLEAR_ALERT") {
    chrome.storage.local.get(["kpiAlerts"], (r) => {
      const alerts = (r.kpiAlerts || []).map(a =>
        a.kpiId === message.kpiId ? { ...a, triggered: false } : a
      );
      chrome.storage.local.set({ kpiAlerts: alerts }, () => {
        updateBadge(alerts.filter(a => a.triggered).length);
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  if (type === "RUN_KPI_MONITOR_NOW") {
    runKpiMonitor()
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // Monitoring settings
  if (type === "SET_MONITORING") {
    const { enabled, intervalMinutes } = message;
    chrome.storage.local.get(["pbiSettings"], (r) => {
      const s = r.pbiSettings || {};
      s.monitoring = { ...s.monitoring, enabled, intervalMinutes: intervalMinutes || 30 };
      chrome.storage.local.set({ pbiSettings: s }, async () => {
        // Update alarm interval
        await chrome.alarms.clear("kpi-monitor");
        if (enabled) {
          chrome.alarms.create("kpi-monitor", { periodInMinutes: intervalMinutes || 30 });
        }
        sendResponse({ ok: true });
      });
    });
    return true;
  }
});

// ── Action button → open side panel ──────────────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
    await chrome.sidePanel.setOptions({ tabId: tab.id, path: "src/sidepanel.html", enabled: true });
  } catch (e) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/daxEngine.js","src/ruleLoader.js","src/skills.js",
              "src/platformAdapter.js","src/actionExecutor.js","src/contentScript.js"]
    });
  }
});
