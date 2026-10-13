@echo off
rem Starts the game server plus a public Cloudflare link. Look for the https://...trycloudflare.com address in the tunnel window.
cd /d "%~dp0"
if not exist node_modules call npm install
start "Game server" node server\server.js
"%ProgramFiles(x86)%\cloudflared\cloudflared.exe" tunnel --no-autoupdate --url http://localhost:8080
pause
