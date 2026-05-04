/**
 * pbiTokenCapture.js — runs in the MAIN world (document_start)
 *
 * Content scripts in the ISOLATED world cannot intercept the PAGE's
 * window.fetch / XHR calls because they run in a separate JS context.
 * This tiny script runs in the MAIN world so it shares the page's
 * window object and can patch fetch/XHR before Power BI makes any
 * API calls.
 *
 * When a Bearer token is found, it fires a CustomEvent on the document
 * that the isolated-world pbiApi.js can listen to.
 */
(function () {
  if (window.__pbiTokenCaptureActive) return;
  window.__pbiTokenCaptureActive = true;

  function emitToken(authHeader) {
    if (!authHeader) return;
    const m = String(authHeader).match(/^Bearer\s+(.+)$/i);
    if (m && m[1].length > 20) {
      document.dispatchEvent(new CustomEvent("__pbi_auth", { detail: m[1] }));
    }
  }

  // ── Patch window.fetch ──────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : (input?.url || "");
      if (url.includes("powerbi.com") || url.includes("analysis.windows.net")) {
        const hdrs = init?.headers;
        if (hdrs) {
          const auth = hdrs instanceof Headers
            ? hdrs.get("Authorization")
            : (hdrs["Authorization"] || hdrs["authorization"]);
          emitToken(auth);
        }
      }
    } catch (_) {}
    return origFetch.apply(this, arguments);
  };

  // ── Patch XMLHttpRequest ────────────────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._pbiCaptureUrl = url || "";
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (
      name.toLowerCase() === "authorization" &&
      (this._pbiCaptureUrl || "").match(/powerbi\.com|analysis\.windows\.net/)
    ) {
      emitToken(value);
    }
    return origSetHeader.apply(this, arguments);
  };
})();
