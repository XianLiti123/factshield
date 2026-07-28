@echo off
setlocal
title FactShield UI

cd /d "%~dp0ui"
if errorlevel 1 goto :missing_ui

where node >nul 2>&1
if errorlevel 1 goto :missing_node

set "PNPM_CMD=pnpm"
where pnpm >nul 2>&1
if not errorlevel 1 goto :install

where npx >nul 2>&1
if errorlevel 1 goto :missing_package_manager
set "PNPM_CMD=npx --yes pnpm@11.9.0"

:install
echo [1/2] Restoring frontend dependencies...
call %PNPM_CMD% install --frozen-lockfile
if errorlevel 1 goto :install_failed

if /i "%~1"=="--check" (
  echo [OK] Frontend environment is ready.
  exit /b 0
)

echo [2/2] Starting FactShield UI...
echo The browser will open automatically. Keep this window open while using the UI.
echo.
call %PNPM_CMD% run dev --open
if errorlevel 1 goto :start_failed
exit /b 0

:missing_ui
echo [ERROR] The ui directory was not found next to this script.
goto :failed

:missing_node
echo [ERROR] Node.js is not installed or is not available in PATH.
echo Install Node.js 20.19 or newer, then run this file again.
goto :failed

:missing_package_manager
echo [ERROR] Neither pnpm nor npx is available.
echo Reinstall Node.js with npm included, then run this file again.
goto :failed

:install_failed
echo [ERROR] Frontend dependencies could not be installed.
echo Check the network connection and the error messages above.
goto :failed

:start_failed
echo [ERROR] The UI server stopped or could not start.
echo If port 5173 is already in use, close the other server and try again.

:failed
echo.
pause
exit /b 1
