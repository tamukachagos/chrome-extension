# Power BI Web Copilot

A Chrome extension that brings AI-powered assistance directly into the Power BI Service web interface. It includes a deterministic rule engine for instant answers, Anthropic Claude integration for vision analysis and action planning, a DAX deploy workflow, and a failure capture system for continuous improvement.

---

## Project overview

| Layer | What it does |
|---|---|
| `src/contentScript.js` | Main extension UI injected into the Power BI page. 6-tab panel: Ask, Measures, Visuals, Model, Train, Act. |
| `src/background.js` | Service worker. Handles `PBI_CAPTURE_VISIBLE_TAB` and `TAKE_SCREENSHOT` messages to capture the visible tab. |
| `proxy/server.js` | Ollama proxy on port 8787. Routes requests to a local Ollama instance. Do not modify. |
| `tools/anthropic-proxy/server.js` | Anthropic API proxy on port 3003. Routes vision, action plan, and fallback requests to Claude. |
| `training/` | Rule files, test suites, and skill definitions. Do not modify directly. |
| `scripts/testRunner.js` | Node.js test runner. Validates JSON files, rule schema, proxy payloads, and file existence. |

---

## How to run the Ollama proxy

The Ollama proxy routes local AI requests to an Ollama instance running on your machine.

```powershell
# From the repo root
.\proxy\start.ps1
```

The proxy listens on `http://localhost:8787`. Ollama must be running separately (`ollama serve`).

---

## How to run the Anthropic proxy

The Anthropic proxy forwards requests to the Claude API. Your API key is kept on the server and never exposed to the extension.

1. Edit `tools/anthropic-proxy/start.ps1` and replace `YOUR_KEY_HERE` with your Anthropic API key.
2. Run the proxy:

```powershell
.\tools\anthropic-proxy\start.ps1
```

Or set the environment variable manually:

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
$env:PORT = "3003"
node .\tools\anthropic-proxy\server.js
```

3. In the extension Train tab, set the fallback endpoint to `http://localhost:3003/fallback` and enable fallback.

The proxy exposes:
- `POST /fallback` — accepts `type: "fallback" | "vision" | "action_plan"`
- `GET /health` — returns proxy status and whether the API key is set

---

## How to load the extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `chrome-extension` folder (the repo root, where `manifest.json` lives)
5. The extension icon appears in the Chrome toolbar
6. Navigate to `app.powerbi.com` and click the extension icon or the yellow **BI** tab on the right side of the page

---

## How screenshot and vision works

1. Click **Capture Screen** in the Act tab — this sends a `PBI_CAPTURE_VISIBLE_TAB` message to `background.js`, which calls `chrome.tabs.captureVisibleTab` and returns a base64 PNG data URL.
2. The screenshot is stored in `state.lastScreenshot` and displayed as a preview.
3. Click **Analyze Screen** — the extension sends the screenshot to the proxy as a base64 image content block inside an Anthropic Messages API request. The proxy returns a JSON analysis of the Power BI state.
4. The analysis result is shown in the Screen Analysis panel.

Vision requests use `type: "vision"` in the proxy payload. The proxy system prompt instructs Claude to return only valid JSON.

---

## How action planning works

1. Enter a goal in the **Goal** textarea (e.g. "Create a new measure called Total Revenue and add it to the bar chart").
2. Click **Generate Plan** — the extension captures a screenshot (if one does not already exist), then sends a `type: "action_plan"` request to the proxy with the goal, screenshot, page context, and available action types.
3. Claude returns a JSON action plan with typed steps: `click`, `double_click`, `right_click`, `type`, `key`, `scroll`, `wait`, `screenshot`, `drag`.
4. Each step is displayed as a card with its risk level. High-risk steps (containing words like "delete", "publish", "save") are flagged with a warning.
5. **Approve** individual steps or use **Approve All** to approve all non-invalid steps.
6. Click **Run Approved** to execute the approved steps in order.
7. Click **Stop** at any time to halt execution.

Steps that fail are logged to the failure log and a screenshot is captured automatically.

---

## How to use Deploy DAX

The Deploy DAX feature automates the process of adding a new measure to a Power BI report:

1. Open your Power BI report in edit mode and navigate to the **Modeling** tab.
2. In the extension Act tab, paste your complete DAX measure text into the **Deploy DAX Measure** textarea.
3. Click **Deploy to Power BI**.

The workflow:
1. Captures a before-screenshot.
2. Finds and clicks the "New measure" button.
3. Waits for the DAX editor (Monaco editor) to open.
4. Selects all existing text and types your DAX.
5. Waits for Power BI to process.
6. Checks for visual errors.
7. Captures an after-screenshot.

After deployment, review the measure name in the editor and save it manually (click the checkmark or press Enter in the formula bar).

---

## Safety limitations

- **All steps require explicit approval before execution.** No step runs without you clicking Approve.
- **High-risk steps** (those involving delete, remove, publish, save, overwrite, export, share, replace, submit, apply changes, or manage access) are flagged with a red warning and require individual approval.
- **Stop button**: Click Stop at any time during execution to halt remaining steps.
- **The extension cannot execute actions outside the current browser tab.** It uses DOM events and `chrome.tabs.captureVisibleTab` only.
- **The proxy never exposes your API key.** The `ANTHROPIC_API_KEY` is read from the server environment and never sent to the extension.
- **No data is sent to Anthropic unless the fallback endpoint is enabled** in the Train tab settings.

---

## How continuous training works

The extension learns from two sources:

**1. User-defined training notes (Train tab)**
- Add business rules, DAX conventions, and report standards in the Train tab.
- Notes are stored in `chrome.storage.local` and included in every AI request as context.
- Export notes as JSON with the **Export notes** button.

**2. Failure capture (automatic)**
- When a vision analysis, action plan, or DAX deploy step fails, the event is automatically saved to `chrome.storage.local` under `pbiFailures`.
- Each failure record includes: the input, page context, page URL, action log, and error message.
- Export all failure cases as JSON with the **Export Failed Cases** button in the Train tab.
- Use the exported JSON to improve rules, prompts, or report bugs.

---

## Troubleshooting

**Extension panel does not open**
- Make sure you are on `app.powerbi.com` or a supported Power BI URL.
- Try refreshing the page and clicking the extension icon again.

**Screenshot returns an error**
- The extension needs the `activeTab` and `tabs` permissions (already in `manifest.json`).
- If the tab is a background tab, bring it to the foreground first.

**Vision analysis fails with HTTP 500**
- Check that the Anthropic proxy is running (`node tools/anthropic-proxy/server.js`).
- Verify `ANTHROPIC_API_KEY` is set correctly.
- Visit `http://localhost:3003/health` to check proxy status.

**Action plan returns no steps**
- Make sure the fallback endpoint is set to `http://localhost:3003/fallback` in the Train tab.
- Enable the fallback toggle.
- Check that the proxy is running and the API key is valid.

**DAX deploy: "Could not find New measure button"**
- Open the **Modeling** tab in Power BI before clicking Deploy.
- The button label may differ by language. Try clicking "New measure" manually first.

**DAX deploy: "DAX editor did not open"**
- Power BI may need more time to respond. Try clicking the New measure button manually and then pasting the DAX yourself.

**Test runner failures**
```powershell
node .\scripts\testRunner.js
```
- `training/*.json` parse failures indicate corrupted rule files — restore from version control.
- `PBI_CAPTURE_VISIBLE_TAB` missing — check `src/background.js` was saved correctly.
