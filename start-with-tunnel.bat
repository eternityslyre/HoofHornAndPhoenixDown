@echo off
rem Starts the game server plus a public link.
rem With the named tunnel "emilia-game" set up, the game is at https://emilia.eternityslyre.com
rem Without it, look for the temporary https://...trycloudflare.com address below.
cd /d "%~dp0"
if not exist node_modules call npm install
start "Game server" node server\server.js
set CF="%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if "%TUNNEL_NAME%"=="" set TUNNEL_NAME=emilia-game
%CF% tunnel info %TUNNEL_NAME% >nul 2>&1
if errorlevel 1 (
  %CF% tunnel --no-autoupdate --url http://localhost:8080
) else (
  echo Game link: https://emilia.eternityslyre.com
  %CF% tunnel --no-autoupdate run --url http://localhost:8080 %TUNNEL_NAME%
)
pause
