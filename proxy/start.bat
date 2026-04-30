@echo off
REM Edit these to match your VM and models
set OLLAMA_URL=http://192.168.1.100:11434
set TEXT_MODEL=mistral
set VISION_MODEL=llava
set PORT=8787

node server.js
