@echo off
chcp 65001 >nul
title Dota Coach
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js not found. Install LTS from https://nodejs.org and run again.
  pause
  exit /b
)
node install-gsi.js
start "" http://localhost:3000
node server.js
pause
