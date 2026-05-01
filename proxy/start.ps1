$env:OLLAMA_URL   = "http://104.236.46.144:11434"
$env:TEXT_MODEL   = "qwen2.5-coder:7b"
$env:VISION_MODEL = "moondream:latest"
$env:PORT         = "8787"

node "$PSScriptRoot\server.js"
