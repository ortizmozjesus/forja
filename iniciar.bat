@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js no esta instalado. Instalalo desde https://nodejs.org y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)
start "" http://localhost:4180
node server.js
pause
