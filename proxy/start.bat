@echo off
REM Edit these to match your VM and models
set OLLAMA_URL=http://104.236.46.144:11434
set TEXT_MODEL=qwen2.5-coder:1.5b
set VISION_MODEL=moondream2
set PORT=8787

node server.js
