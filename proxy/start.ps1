$env:OLLAMA_URL   = "http://104.236.46.144:11434"
$env:TEXT_MODEL   = "qwen2.5-coder:1.5b"
$env:VISION_MODEL = "moondream2"
$env:PORT         = "8787"

node "$PSScriptRoot\server.js"
