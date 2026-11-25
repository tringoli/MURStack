@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [MURS Maps] Node.js not found. Please install Node.js 18+ from https://nodejs.org/
  pause
  exit /b 1
)

node "%~dp0start-local.mjs" %*
if errorlevel 1 (
  echo.
  echo [MURS Maps] Server exited with an error.
  pause
)
