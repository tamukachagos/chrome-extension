/**
 * actionExecutor.js — DOM action execution engine
 * Runs as a content script. Receives action plans from the side panel
 * (via RELAY_TO_CONTENT → background → content script) and executes them
 * step by step with realistic pointer events and proper error recovery.
 *
 * Action types supported:
 *   click, double_click, right_click, type, key, scroll, wait,
 *   screenshot (returns dataUrl), drag, hover, select, clear, focus,
 *   read_element (returns text/value), assert_visible, assert_text
 */

(function () {
  if (window.__dataAnalystExecutor) return;
  window.__dataAnalystExecutor = true;

  // ── Utilities ─────────────────────────────────────────────────────────────────

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function findElement(target) {
    if (!target) return null;
    // CSS selector
    try {
      const el = document.querySelector(target);
      if (el) return el;
    } catch (_) {}

    // XPath
    if (target.startsWith("/") || target.startsWith("(")) {
      try {
        const result = document.evaluate(
          target, document, null,
          XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        if (result.singleNodeValue) return result.singleNodeValue;
      } catch (_) {}
    }

    // Text content search (find visible element containing the text)
    const textMatch = target.match(/^text=(.+)$/i);
    if (textMatch) {
      const needle = textMatch[1].toLowerCase();
      const candidates = document.querySelectorAll(
        "button, a, [role='button'], [role='menuitem'], [role='tab'], label, li, span, div"
      );
      for (const el of candidates) {
        if (el.textContent.trim().toLowerCase() === needle && isVisible(el)) return el;
      }
      for (const el of candidates) {
        if (el.textContent.trim().toLowerCase().includes(needle) && isVisible(el)) return el;
      }
    }

    // aria-label search
    const ariaMatch = target.match(/^aria=(.+)$/i);
    if (ariaMatch) {
      const label = ariaMatch[1].toLowerCase();
      const el = document.querySelector(`[aria-label="${ariaMatch[1]}"], [aria-label*="${ariaMatch[1]}"]`);
      if (el) return el;
    }

    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function centerOf(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2)
    };
  }

  // Fire realistic pointer + mouse event sequence
  function dispatchPointerClick(el, button = 0) {
    const { x, y } = centerOf(el);
    const evInit = {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button, buttons: button === 0 ? 1 : 0,
      pointerType: "mouse", isPrimary: true
    };
    el.dispatchEvent(new PointerEvent("pointerover",  evInit));
    el.dispatchEvent(new PointerEvent("pointerenter", { ...evInit, bubbles: false }));
    el.dispatchEvent(new MouseEvent("mouseover",  evInit));
    el.dispatchEvent(new MouseEvent("mouseenter", { ...evInit, bubbles: false }));
    el.dispatchEvent(new MouseEvent("mousemove",  evInit));
    el.dispatchEvent(new PointerEvent("pointerdown", evInit));
    el.dispatchEvent(new MouseEvent("mousedown",  evInit));
    el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent("pointerup", evInit));
    el.dispatchEvent(new MouseEvent("mouseup",    evInit));
    el.dispatchEvent(new MouseEvent("click",      { ...evInit, detail: 1 }));
  }

  function dispatchDoubleClick(el) {
    dispatchPointerClick(el);
    el.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true, cancelable: true, composed: true, detail: 2
    }));
  }

  function dispatchRightClick(el) {
    const { x, y } = centerOf(el);
    const evInit = {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, button: 2, buttons: 2
    };
    el.dispatchEvent(new MouseEvent("contextmenu", evInit));
  }

  // Type text into focused element
  function typeText(el, text) {
    el.focus({ preventScroll: true });
    // Try contentEditable
    if (el.isContentEditable) {
      el.textContent = "";
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    // Input / textarea
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window[el.tagName === "INPUT" ? "HTMLInputElement" : "HTMLTextAreaElement"].prototype,
        "value"
      )?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, text);
      } else {
        el.value = text;
      }
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      // Also simulate keystroke events for React/Vue listeners
      for (const char of text) {
        el.dispatchEvent(new KeyboardEvent("keydown",  { key: char, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keypress", { key: char, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup",    { key: char, bubbles: true }));
      }
    }
  }

  function pressKey(el, keyExpr) {
    // keyExpr examples: "Enter", "Escape", "ctrl+z", "shift+Tab"
    const parts = keyExpr.split("+");
    const key   = parts[parts.length - 1];
    const ctrl  = parts.includes("ctrl")  || parts.includes("control");
    const shift = parts.includes("shift");
    const alt   = parts.includes("alt");
    const meta  = parts.includes("meta")  || parts.includes("cmd");
    const code  = {
      Enter: "Enter", Escape: "Escape", Tab: "Tab", Backspace: "Backspace",
      Delete: "Delete", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", F5: "F5", F2: "F2"
    }[key] || key;

    const init = {
      key, code, bubbles: true, cancelable: true, composed: true,
      ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta
    };
    const target = el || document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent("keydown",  init));
    target.dispatchEvent(new KeyboardEvent("keypress", init));
    target.dispatchEvent(new KeyboardEvent("keyup",    init));
  }

  function scrollElement(el, dx, dy) {
    if (el) {
      el.scrollBy({ left: dx || 0, top: dy || 0, behavior: "smooth" });
    } else {
      window.scrollBy({ left: dx || 0, top: dy || 0, behavior: "smooth" });
    }
  }

  async function takeScreenshot() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "TAKE_SCREENSHOT" }, response => {
        resolve(response || { ok: false, error: "No response from background" });
      });
    });
  }

  // ── Step execution ────────────────────────────────────────────────────────────

  async function executeStep(step) {
    const { type, target, text, keys, x, y, dx, dy, duration_ms, value } = step;
    const delay = typeof duration_ms === "number" ? duration_ms : 0;

    let el = null;
    if (target) {
      el = findElement(target);
      if (!el && !["wait", "screenshot", "scroll", "key"].includes(type)) {
        return { ok: false, step_id: step.id, error: `Element not found: ${target}` };
      }
    }

    switch (type) {
      case "click": {
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          await sleep(Math.max(delay, 100));
          dispatchPointerClick(el);
          el.click(); // Belt and suspenders
        } else if (typeof x === "number" && typeof y === "number") {
          // Coordinate-based click via elementFromPoint
          const target2 = document.elementFromPoint(x, y);
          if (target2) { dispatchPointerClick(target2); target2.click(); }
        }
        break;
      }

      case "double_click": {
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          await sleep(Math.max(delay, 80));
          dispatchDoubleClick(el);
        }
        break;
      }

      case "right_click": {
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          dispatchRightClick(el);
        }
        break;
      }

      case "hover": {
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          const { x: cx, y: cy } = centerOf(el);
          el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: cx, clientY: cy }));
          el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, clientX: cx, clientY: cy }));
        }
        break;
      }

      case "type": {
        if (!text) return { ok: false, step_id: step.id, error: "No text provided for type action" };
        const targetEl = el || document.activeElement;
        if (!targetEl) return { ok: false, step_id: step.id, error: "No focused element to type into" };
        await sleep(Math.max(delay, 50));
        typeText(targetEl, text);
        break;
      }

      case "clear": {
        const clearEl = el || document.activeElement;
        if (clearEl) {
          clearEl.focus({ preventScroll: true });
          if (clearEl.isContentEditable) {
            clearEl.textContent = "";
            clearEl.dispatchEvent(new Event("input", { bubbles: true }));
          } else if (clearEl.value !== undefined) {
            clearEl.value = "";
            clearEl.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
        break;
      }

      case "key": {
        await sleep(Math.max(delay, 30));
        pressKey(el || null, keys || text || "Enter");
        break;
      }

      case "focus": {
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          el.focus({ preventScroll: true });
        }
        break;
      }

      case "select": {
        // Select dropdown option
        if (el && el.tagName === "SELECT") {
          el.value = value || text || "";
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (el) {
          dispatchPointerClick(el);
        }
        break;
      }

      case "scroll": {
        await sleep(Math.max(delay, 30));
        scrollElement(el || null, dx || x || 0, dy || y || 0);
        break;
      }

      case "drag": {
        if (!el) break;
        const { x: startX, y: startY } = centerOf(el);
        const endX = (typeof x === "number" ? x : startX + (dx || 0));
        const endY = (typeof y === "number" ? y : startY + (dy || 0));
        el.dispatchEvent(new DragEvent("dragstart", { bubbles: true, clientX: startX, clientY: startY }));
        await sleep(50);
        const dropTarget = document.elementFromPoint(endX, endY);
        if (dropTarget) {
          dropTarget.dispatchEvent(new DragEvent("dragover", { bubbles: true, clientX: endX, clientY: endY }));
          dropTarget.dispatchEvent(new DragEvent("drop",     { bubbles: true, clientX: endX, clientY: endY }));
        }
        el.dispatchEvent(new DragEvent("dragend", { bubbles: true, clientX: endX, clientY: endY }));
        break;
      }

      case "wait": {
        await sleep(Math.max(delay, 100));
        break;
      }

      case "screenshot": {
        const shot = await takeScreenshot();
        return { ok: true, step_id: step.id, screenshot: shot };
      }

      case "read_element": {
        if (!el) return { ok: false, step_id: step.id, error: `Element not found: ${target}` };
        const val = el.value !== undefined ? el.value : el.textContent.trim();
        return { ok: true, step_id: step.id, value: val };
      }

      case "assert_visible": {
        if (!el || !isVisible(el)) {
          return { ok: false, step_id: step.id, error: `Assert visible failed: ${target}` };
        }
        return { ok: true, step_id: step.id };
      }

      case "assert_text": {
        if (!el) return { ok: false, step_id: step.id, error: `Element not found: ${target}` };
        const actual = el.textContent.trim();
        const expected = text || "";
        const pass = actual.toLowerCase().includes(expected.toLowerCase());
        if (!pass) {
          return { ok: false, step_id: step.id, error: `Assert text failed. Expected "${expected}", got "${actual.slice(0, 80)}"` };
        }
        return { ok: true, step_id: step.id, actual };
      }

      case "write_dax": {
        if (window.__dataAnalystAdapter) {
          return window.__dataAnalystAdapter.writeDax(text || "");
        }
        return { ok: false, step_id: step.id, error: "platformAdapter not loaded" };
      }

      case "write_sql": {
        if (window.__dataAnalystAdapter) {
          return window.__dataAnalystAdapter.writeSQL(text || "");
        }
        return { ok: false, step_id: step.id, error: "platformAdapter not loaded" };
      }

      case "new_measure": {
        if (!window.__dataAnalystAdapter)
          return { ok: false, step_id: step.id, error: "platformAdapter not loaded" };

        // First attempt: direct click
        const r1 = window.__dataAnalystAdapter.clickNewMeasure();
        if (r1.ok) return r1;

        // Second attempt: if a right-click was triggered (Pass 3), wait and then
        // look for "New measure" in the context menu that just opened
        await new Promise(res => setTimeout(res, 600));
        const menuItems = Array.from(document.querySelectorAll(
          '[role="menuitem"], [role="option"], [class*="contextMenuItem"], [class*="menu-item"]'
        ));
        for (const el of menuItems) {
          if (el.textContent.trim().toLowerCase().includes("new measure")) {
            el.click();
            return { ok: true, step_id: step.id, method: "context-menu" };
          }
        }

        return { ok: false, step_id: step.id, error: r1.error };
      }

      case "write_measure_name": {
        if (window.__dataAnalystAdapter) {
          return window.__dataAnalystAdapter.writeMeasureName(text || "");
        }
        return { ok: false, step_id: step.id, error: "platformAdapter not loaded" };
      }

      case "commit_formula": {
        if (window.__dataAnalystAdapter) {
          return window.__dataAnalystAdapter.commitFormulaBar();
        }
        return { ok: false, step_id: step.id, error: "platformAdapter not loaded" };
      }

      // ── Tableau actions ──────────────────────────────────────────────────────
      // Delegate to window.__tableauAdapter (injected by tableauAdapter.js)

      case "tableau_filter": {
        const ta = window.__tableauAdapter;
        if (!ta) return { ok: false, step_id: step.id, error: "tableauAdapter not loaded — are you on a Tableau page?" };
        const fieldName  = step.fieldName  || step.target || "";
        const values     = step.values     || (step.text ? [step.text] : []);
        const updateType = step.updateType || "replace";
        if (!fieldName) return { ok: false, step_id: step.id, error: "tableau_filter: fieldName required" };
        await ta.applyFilter(fieldName, values, updateType);
        return { ok: true, step_id: step.id };
      }

      case "tableau_navigate": {
        const ta = window.__tableauAdapter;
        if (!ta) return { ok: false, step_id: step.id, error: "tableauAdapter not loaded" };
        const sheetName = step.name || step.text || step.target || "";
        if (!sheetName) return { ok: false, step_id: step.id, error: "tableau_navigate: sheet name required" };
        await ta.activateSheet(sheetName);
        return { ok: true, step_id: step.id };
      }

      case "tableau_parameter": {
        const ta = window.__tableauAdapter;
        if (!ta) return { ok: false, step_id: step.id, error: "tableauAdapter not loaded" };
        const paramName  = step.name  || step.target || "";
        const paramValue = step.value || step.text   || "";
        if (!paramName) return { ok: false, step_id: step.id, error: "tableau_parameter: name required" };
        await ta.setParameter(paramName, paramValue);
        return { ok: true, step_id: step.id };
      }

      case "tableau_select": {
        const ta = window.__tableauAdapter;
        if (!ta) return { ok: false, step_id: step.id, error: "tableauAdapter not loaded" };
        const fieldName = step.fieldName || step.target || "";
        const values    = step.values    || (step.text ? [step.text] : []);
        if (!fieldName) return { ok: false, step_id: step.id, error: "tableau_select: fieldName required" };
        await ta.selectMarks(fieldName, values);
        return { ok: true, step_id: step.id };
      }

      case "tableau_clear_filter": {
        const ta = window.__tableauAdapter;
        if (!ta) return { ok: false, step_id: step.id, error: "tableauAdapter not loaded" };
        const fieldName = step.fieldName || step.target || step.text || "";
        if (!fieldName) return { ok: false, step_id: step.id, error: "tableau_clear_filter: fieldName required" };
        await ta.clearFilter(fieldName);
        return { ok: true, step_id: step.id };
      }

      case "tableau_export": {
        const ta = window.__tableauAdapter;
        if (!ta) return { ok: false, step_id: step.id, error: "tableauAdapter not loaded" };
        await ta.exportImage();
        return { ok: true, step_id: step.id };
      }

      case "tableau_get_data": {
        const ta = window.__tableauAdapter;
        if (!ta) return { ok: false, step_id: step.id, error: "tableauAdapter not loaded" };
        const data = await ta.getSummaryData(step.maxRows || 100);
        return { ok: true, step_id: step.id, data };
      }

      default:
        return { ok: false, step_id: step.id, error: `Unknown action type: ${type}` };
    }

    await sleep(delay > 0 ? delay : 0);
    return { ok: true, step_id: step.id };
  }

  // ── Plan execution ────────────────────────────────────────────────────────────

  async function executePlan(plan, options = {}) {
    const steps  = Array.isArray(plan.steps) ? plan.steps : [];
    const results = [];
    let aborted = false;

    for (const step of steps) {
      if (aborted) {
        results.push({ ok: false, step_id: step.id, error: "Aborted due to previous failure" });
        continue;
      }

      // Optional per-step approval gate
      if (step.requires_approval && options.onApprovalRequired) {
        const approved = await options.onApprovalRequired(step);
        if (!approved) {
          results.push({ ok: false, step_id: step.id, error: "User did not approve this step" });
          if (options.stopOnApprovalDenied) { aborted = true; continue; }
        }
      }

      try {
        const result = await executeStep(step);
        results.push(result);

        if (!result.ok && !options.continueOnError) {
          aborted = true;
        }
      } catch (e) {
        results.push({ ok: false, step_id: step.id, error: e.message });
        if (!options.continueOnError) aborted = true;
      }

      // Inter-step delay
      await sleep(options.stepDelay ?? 200);
    }

    return {
      ok: !aborted,
      completed: results.filter(r => r.ok).length,
      total:     steps.length,
      results
    };
  }

  window.__dataAnalystExecutor = { executePlan, executeStep, findElement };

  // ── Message handler (single listener — avoids double-sendResponse) ────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = message?.type;

    if (type === "EXECUTOR_RUN_PLAN") {
      const { plan, options } = message;
      if (!plan || !Array.isArray(plan.steps)) {
        sendResponse({ ok: false, error: "Invalid plan: missing steps array" });
        return true;
      }
      executePlan(plan, options || {})
        .then(result => sendResponse(result))
        .catch(e    => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    if (type === "EXECUTOR_RUN_STEP") {
      if (!message.step) {
        sendResponse({ ok: false, error: "Missing step object" });
        return true;
      }
      executeStep(message.step)
        .then(result => sendResponse(result))
        .catch(e    => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    // Not our message — return nothing so the channel closes immediately
  });
})();
