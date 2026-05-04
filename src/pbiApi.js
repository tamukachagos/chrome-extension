/**
 * pbiApi.js — Power BI REST API client (content script, document_start)
 *
 * Runs early (document_start) so it can intercept fetch/XHR calls that
 * Power BI web makes to api.powerbi.com — capturing the Bearer token
 * without any Azure app registration or user credential prompts.
 *
 * Once a token is captured, the side panel can relay messages here to:
 *   - Create / update measures via REST (reliable, no DOM jank)
 *   - Execute DAX queries to see actual results
 *   - Read dataset metadata (tables, measures, relationships)
 *   - Get workspace / report / dataset IDs from the URL
 */

(function () {
  if (window.__pbiApi) return;

  // ── Token capture ─────────────────────────────────────────────────────────────

  let _token = null;
  let _tokenAt = 0;
  const TOKEN_TTL = 55 * 60 * 1000; // 55 min (AAD tokens live ~60 min)

  function storeToken(authHeader) {
    if (!authHeader) return;
    const m = String(authHeader).match(/^Bearer\s+(.+)$/i);
    if (m && m[1].length > 20 && m[1] !== _token) {
      _token = m[1];
      _tokenAt = Date.now();
      // Persist to session storage so background service worker can use for KPI polling
      try {
        chrome.storage.session.set({ pbiToken: _token, pbiTokenAt: _tokenAt });
      } catch (_) {}
    }
  }

  // ── Listen for tokens emitted by pbiTokenCapture.js (MAIN world) ─────────────
  // pbiTokenCapture.js runs in the MAIN world and can intercept the page's
  // real window.fetch. It fires a CustomEvent here in the isolated world.
  document.addEventListener("__pbi_auth", (e) => {
    if (e.detail) storeToken(`Bearer ${e.detail}`);
  });

  // Fallback: also intercept fetch from OUR isolated world (catches extension-
  // initiated calls, but NOT the page's own calls — see pbiTokenCapture.js).
  const _origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : (input?.url || "");
      if (url.includes("powerbi.com") || url.includes("analysis.windows.net")) {
        const hdrs = init?.headers;
        if (hdrs) {
          const auth = hdrs instanceof Headers
            ? hdrs.get("Authorization")
            : (hdrs["Authorization"] || hdrs["authorization"]);
          storeToken(auth);
        }
      }
    } catch (_) {}
    return _origFetch.apply(this, arguments);
  };

  // Intercept XHR
  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._pbiApiUrl = url || "";
    return _origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (
      (this._pbiApiUrl || "").includes("powerbi.com") &&
      name.toLowerCase() === "authorization"
    ) {
      storeToken(value);
    }
    return _origSetHeader.apply(this, arguments);
  };

  // Fallback: scan MSAL localStorage cache (Power BI uses MSAL v2)
  function tokenFromMsal() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.includes("accesstoken")) continue;
        try {
          const item = JSON.parse(localStorage.getItem(key) || "null");
          if (!item?.secret) continue;
          const exp = Number(item.expiresOn || 0) * 1000;
          if (exp < Date.now() + 60_000) continue;
          const target = (item.target || "") + (item.realm || "");
          if (target.includes("powerbi") || target.includes("analysis.windows.net")) {
            return item.secret;
          }
        } catch (_) {}
      }
    } catch (_) {}
    return null;
  }

  function getToken() {
    if (_token && Date.now() - _tokenAt < TOKEN_TTL) return _token;
    const msal = tokenFromMsal();
    if (msal) { _token = msal; _tokenAt = Date.now(); }
    return _token;
  }

  // ── URL parsing ───────────────────────────────────────────────────────────────

  function parseUrl() {
    // https://app.powerbi.com/groups/{workspaceId}/reports/{reportId}/...
    const m = location.pathname.match(
      /\/groups\/([0-9a-f-]+)\/(?:reports|datasets)\/([0-9a-f-]+)/i
    );
    return {
      workspaceId: m ? m[1] : null,
      reportId:    m ? m[2] : null
    };
  }

  // ── REST API helper ───────────────────────────────────────────────────────────

  const BASE = "https://api.powerbi.com/v1.0/myorg";

  async function api(path, opts = {}) {
    const tok = getToken();
    if (!tok) throw new Error(
      "No Power BI token yet. Interact with the report for a moment so the extension can capture it, then try again."
    );

    const res = await _origFetch(`${BASE}${path}`, {
      method: opts.method || "GET",
      headers: {
        "Authorization": `Bearer ${tok}`,
        "Content-Type": "application/json",
        ...(opts.headers || {})
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      throw new Error(`PBI API ${res.status}: ${txt.slice(0, 300)}`);
    }
    if (res.status === 204) return { ok: true };
    return res.json();
  }

  // ── Public API methods ────────────────────────────────────────────────────────

  const pbiApi = {

    hasToken() { return Boolean(getToken()); },
    getIds()   { return parseUrl(); },

    // Fetch report info (includes datasetId)
    async getReportInfo(workspaceId, reportId) {
      const ids = parseUrl();
      const wid = workspaceId || ids.workspaceId;
      const rid = reportId    || ids.reportId;
      if (!wid || !rid) throw new Error("Cannot determine workspaceId / reportId from URL");
      return api(`/groups/${wid}/reports/${rid}`);
    },

    // Get the dataset ID for the current report
    async getDatasetId(workspaceId, reportId) {
      const info = await this.getReportInfo(workspaceId, reportId);
      return info?.datasetId || null;
    },

    // List all tables in a dataset
    async getTables(workspaceId, datasetId) {
      return api(`/groups/${workspaceId}/datasets/${datasetId}/tables`);
    },

    // List measures in a table
    async getMeasures(workspaceId, datasetId, tableName) {
      return api(`/groups/${workspaceId}/datasets/${datasetId}/tables/${encodeURIComponent(tableName)}/measures`);
    },

    // Create a new measure via REST API (reliable, no DOM)
    async createMeasure({ workspaceId, datasetId, tableName, name, expression, formatString, description }) {
      const ids = parseUrl();
      const wid = workspaceId || ids.workspaceId;
      if (!wid || !datasetId || !tableName || !name || !expression)
        throw new Error("createMeasure requires workspaceId, datasetId, tableName, name, expression");

      const body = { name, expression };
      if (formatString)  body.formatString  = formatString;
      if (description)   body.description   = description;

      return api(`/groups/${wid}/datasets/${datasetId}/tables/${encodeURIComponent(tableName)}/measures`, {
        method: "POST",
        body
      });
    },

    // Update (PUT) an existing measure
    async updateMeasure({ workspaceId, datasetId, tableName, name, expression, formatString }) {
      const ids = parseUrl();
      const wid = workspaceId || ids.workspaceId;
      const body = { name, expression };
      if (formatString) body.formatString = formatString;
      return api(`/groups/${wid}/datasets/${datasetId}/tables/${encodeURIComponent(tableName)}/measures/${encodeURIComponent(name)}`, {
        method: "PUT",
        body
      });
    },

    // Execute a DAX query and return the result rows
    // Uses /groups/{wid}/datasets/{id}/executeQueries for shared workspaces (most production reports)
    async executeDaxQuery(datasetId, daxQuery, workspaceId) {
      if (!datasetId || !daxQuery) throw new Error("datasetId and daxQuery required");
      const wid  = workspaceId || parseUrl().workspaceId;
      const path = wid
        ? `/groups/${wid}/datasets/${datasetId}/executeQueries`
        : `/datasets/${datasetId}/executeQueries`; // fallback: My Workspace only
      const result = await api(path, {
        method: "POST",
        body: {
          queries: [{ query: daxQuery }],
          serializerSettings: { includeNulls: true }
        }
      });
      return result?.results?.[0]?.tables?.[0]?.rows ?? [];
    },

    // Refresh a dataset
    async refreshDataset(workspaceId, datasetId) {
      const wid = workspaceId || parseUrl().workspaceId;
      return api(`/groups/${wid}/datasets/${datasetId}/refreshes`, { method: "POST" });
    },

    // List datasets in a workspace
    async listDatasets(workspaceId) {
      const wid = workspaceId || parseUrl().workspaceId;
      if (!wid) throw new Error("workspaceId not found in URL");
      return api(`/groups/${wid}/datasets`);
    },

    // List reports in a workspace
    async listReports(workspaceId) {
      const wid = workspaceId || parseUrl().workspaceId;
      if (!wid) throw new Error("workspaceId not found in URL");
      return api(`/groups/${wid}/reports`);
    },

    // Get refresh history for a dataset
    async getRefreshHistory(workspaceId, datasetId) {
      const wid = workspaceId || parseUrl().workspaceId;
      return api(`/groups/${wid}/datasets/${datasetId}/refreshes?$top=10`);
    },

    // Get refresh schedule
    async getRefreshSchedule(workspaceId, datasetId) {
      const wid = workspaceId || parseUrl().workspaceId;
      return api(`/groups/${wid}/datasets/${datasetId}/refreshSchedule`);
    },

    // List relationships in a dataset
    async getRelationships(workspaceId, datasetId) {
      const wid = workspaceId || parseUrl().workspaceId;
      return api(`/groups/${wid}/datasets/${datasetId}/relationships`);
    },

    // Get dataset columns for a table (schema)
    async getColumns(workspaceId, datasetId, tableName) {
      const wid = workspaceId || parseUrl().workspaceId;
      return api(`/groups/${wid}/datasets/${datasetId}/tables/${encodeURIComponent(tableName)}/columns`);
    },

    // Get all tables with measures and columns
    async getFullSchema(workspaceId, datasetId) {
      const wid = workspaceId || parseUrl().workspaceId;
      const tables = await this.getTables(wid, datasetId);
      const result = [];
      for (const t of (tables?.value || []).slice(0, 20)) {
        const [measures, columns] = await Promise.all([
          this.getMeasures(wid, datasetId, t.name).catch(() => ({ value: [] })),
          this.getColumns(wid, datasetId, t.name).catch(() => ({ value: [] }))
        ]);
        result.push({
          name: t.name,
          measures: (measures?.value || []).map(m => ({ name: m.name, expression: m.expression, description: m.description })),
          columns:  (columns?.value  || []).map(c => ({ name: c.name, dataType: c.dataType }))
        });
      }
      return result;
    },

    // Update a table's Power Query M expression
    async updateTableSource(workspaceId, datasetId, tableName, mExpression) {
      const wid = workspaceId || parseUrl().workspaceId;
      return api(`/groups/${wid}/datasets/${datasetId}/tables/${encodeURIComponent(tableName)}`, {
        method: "PUT",
        body: {
          name: tableName,
          source: [{ expression: mExpression }]
        }
      });
    },

    // Get table's current M expression
    async getTableSource(workspaceId, datasetId, tableName) {
      const wid = workspaceId || parseUrl().workspaceId;
      const table = await api(`/groups/${wid}/datasets/${datasetId}/tables/${encodeURIComponent(tableName)}`);
      return table?.source?.[0]?.expression || null;
    },

    // ── Workspace listing ────────────────────────────────────────────────────────

    // List all workspaces/groups the current user has access to
    async listWorkspaces() {
      return api("/groups?$top=100");
    },

    // ── RLS management ───────────────────────────────────────────────────────────

    // List dataset users (shows who has access — includes RLS-eligible identities)
    async listDatasetUsers(workspaceId, datasetId) {
      const wid = workspaceId || parseUrl().workspaceId;
      return api(`/groups/${wid}/datasets/${datasetId}/users`);
    },

    // Add or update a user on a dataset (with optional RLS role binding)
    // principalType: "User" | "Group" | "App" | "ServicePrincipal"
    // datasetUserAccessRight: "Read" | "ReadReshare" | "ReadExplore" | "Admin" | "Write" | "None"
    async addDatasetUser(workspaceId, datasetId, { identifier, principalType = "User", datasetUserAccessRight = "Read" }) {
      const wid = workspaceId || parseUrl().workspaceId;
      return api(`/groups/${wid}/datasets/${datasetId}/users`, {
        method: "POST",
        body: { identifier, principalType, datasetUserAccessRight }
      });
    },

    // Remove a user from a dataset
    async removeDatasetUser(workspaceId, datasetId, identifier) {
      const wid = workspaceId || parseUrl().workspaceId;
      return api(`/groups/${wid}/datasets/${datasetId}/users/${encodeURIComponent(identifier)}`, {
        method: "DELETE"
      });
    },

    // List RLS roles defined in the model (uses INFO.ROLES() DMV query)
    async listRlsRoles(datasetId) {
      const wid = parseUrl().workspaceId;
      try {
        const rows = await this.executeDaxQuery(datasetId,
          "EVALUATE SELECTCOLUMNS(INFO.ROLES(), \"Role\", [Name], \"Description\", [Description])",
          wid
        );
        return rows || [];
      } catch (_) {
        // Fallback: try plain INFO.ROLES()
        try {
          return await this.executeDaxQuery(datasetId, "EVALUATE INFO.ROLES()", wid);
        } catch (_2) {
          return [];
        }
      }
    },

    // List RLS role members (who is mapped to which role)
    async listRlsRoleMembers(datasetId) {
      const wid = parseUrl().workspaceId;
      try {
        return await this.executeDaxQuery(datasetId,
          "EVALUATE SELECTCOLUMNS(INFO.ROLEMEMBERSHIPS(), \"Role\", [RoleName], \"Member\", [MemberName], \"MemberType\", [MemberType])",
          wid
        );
      } catch (_) { return []; }
    },

    // Test RLS by simulating a user's effective identity
    async testRlsIdentity(workspaceId, reportId, username, roles = [], datasetId) {
      const wid = workspaceId || parseUrl().workspaceId;
      const rid = reportId    || parseUrl().reportId;
      if (!wid || !rid) throw new Error("workspaceId and reportId required for RLS test");
      // datasetId is required in the identities array for shared workspace tokens
      const dsId = datasetId || (await this.getDatasetId(wid, rid).catch(() => null));
      return api(`/groups/${wid}/reports/${rid}/GenerateToken`, {
        method: "POST",
        body: {
          accessLevel: "view",
          identities: [{ username, roles, datasets: dsId ? [dsId] : [] }]
        }
      });
    }
  };

  window.__pbiApi = pbiApi;

  // ── Content-script message handler ───────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg?.type?.startsWith("PBI_API_")) return;

    const p = msg.params || {};

    if (msg.type === "PBI_API_STATUS") {
      const ids = parseUrl();
      sendResponse({ ok: true, hasToken: pbiApi.hasToken(), ...ids });
      return true;
    }

    const dispatch = {
      PBI_API_GET_REPORT_INFO:      () => pbiApi.getReportInfo(p.workspaceId, p.reportId),
      PBI_API_GET_DATASET_ID:       () => pbiApi.getDatasetId(p.workspaceId, p.reportId),
      PBI_API_GET_TABLES:           () => pbiApi.getTables(p.workspaceId, p.datasetId),
      PBI_API_GET_MEASURES:         () => pbiApi.getMeasures(p.workspaceId, p.datasetId, p.tableName),
      PBI_API_CREATE_MEASURE:       () => pbiApi.createMeasure(p),
      PBI_API_UPDATE_MEASURE:       () => pbiApi.updateMeasure(p),
      PBI_API_EXECUTE_DAX:          () => pbiApi.executeDaxQuery(p.datasetId, p.query),
      PBI_API_REFRESH_DATASET:      () => pbiApi.refreshDataset(p.workspaceId, p.datasetId),
      PBI_API_LIST_DATASETS:        () => pbiApi.listDatasets(p.workspaceId),
      PBI_API_LIST_REPORTS:         () => pbiApi.listReports(p.workspaceId),
      PBI_API_GET_REFRESH_HISTORY:  () => pbiApi.getRefreshHistory(p.workspaceId, p.datasetId),
      PBI_API_GET_REFRESH_SCHEDULE: () => pbiApi.getRefreshSchedule(p.workspaceId, p.datasetId),
      PBI_API_GET_RELATIONSHIPS:    () => pbiApi.getRelationships(p.workspaceId, p.datasetId),
      PBI_API_GET_FULL_SCHEMA:      () => pbiApi.getFullSchema(p.workspaceId, p.datasetId),
      PBI_API_GET_TABLE_SOURCE:     () => pbiApi.getTableSource(p.workspaceId, p.datasetId, p.tableName),
      PBI_API_UPDATE_TABLE_SOURCE:  () => pbiApi.updateTableSource(p.workspaceId, p.datasetId, p.tableName, p.mExpression),
      PBI_API_LIST_WORKSPACES:      () => pbiApi.listWorkspaces(),
      PBI_API_LIST_DATASET_USERS:   () => pbiApi.listDatasetUsers(p.workspaceId, p.datasetId),
      PBI_API_ADD_DATASET_USER:     () => pbiApi.addDatasetUser(p.workspaceId, p.datasetId, p),
      PBI_API_REMOVE_DATASET_USER:  () => pbiApi.removeDatasetUser(p.workspaceId, p.datasetId, p.identifier),
      PBI_API_LIST_RLS_ROLES:       () => pbiApi.listRlsRoles(p.datasetId),
      PBI_API_LIST_RLS_MEMBERS:     () => pbiApi.listRlsRoleMembers(p.datasetId),
      PBI_API_TEST_RLS:             () => pbiApi.testRlsIdentity(p.workspaceId, p.reportId, p.username, p.roles, p.datasetId),
    };

    const fn = dispatch[msg.type];
    if (!fn) { sendResponse({ ok: false, error: `Unknown PBI_API type: ${msg.type}` }); return true; }

    fn()
      .then(result => sendResponse({ ok: true, result }))
      .catch(e    => sendResponse({ ok: false, error: e.message }));
    return true;
  });
})();
