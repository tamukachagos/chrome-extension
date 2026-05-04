# Data Analyst AI — Proxy launcher
# Double-click this file to start the proxy.
# API key can be set here OR in the extension Settings tab (preferred).

# ── Optional: set your API key here so you don't have to enter it in the UI ──
# $env:ANTHROPIC_API_KEY = "sk-ant-YOUR_KEY_HERE"

$env:PORT = "3003"

Write-Host ""
Write-Host "  Data Analyst AI — Anthropic Proxy" -ForegroundColor Yellow
Write-Host "  Listening on http://localhost:$env:PORT" -ForegroundColor Cyan
Write-Host ""
Write-Host "  API key: " -NoNewline
if ($env:ANTHROPIC_API_KEY) {
    Write-Host "set via environment ($($env:ANTHROPIC_API_KEY.Substring(0, [Math]::Min(12, $env:ANTHROPIC_API_KEY.Length)))...)" -ForegroundColor Green
} else {
    Write-Host "not set — enter it in the extension Settings tab" -ForegroundColor DarkYellow
}
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

node "$PSScriptRoot\server.js"
