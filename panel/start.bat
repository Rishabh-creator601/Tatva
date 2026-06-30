@echo off
cd /d "%~dp0"
echo Starting Tatva Panel...
start "" http://localhost:4321
node server.js
pause
