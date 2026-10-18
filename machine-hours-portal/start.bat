@echo off
title Machine Hours Portal
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 18+ is required: https://nodejs.org & pause & exit /b 1)
if exist .env (echo Using settings from .env)
start "" http://localhost:3000
node server.js
pause
