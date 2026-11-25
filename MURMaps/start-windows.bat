@echo off
setlocal
chcp 65001 >nul
title MURMaps
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [MURMaps] Node.js not found. Please install Node.js 18+ from https://nodejs.org/
  pause
  exit /b 1
)

node "%~dp0start-local.mjs" %*
if errorlevel 1 (
  echo.
  echo [MURMaps] Server exited with an error.
  pause
)
