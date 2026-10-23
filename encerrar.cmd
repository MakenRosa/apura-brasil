@echo off
cd /d "%~dp0"
node scripts\stop-local.mjs
if errorlevel 1 pause
