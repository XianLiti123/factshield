@echo off
setlocal
title FactShield

cd /d "%~dp0"

rem ============================================================
rem  FactShield one-click startup
rem    - API: python -m api.main (port 8000)
rem    - UI:  pnpm dev in ui/ (port 5173, opens browser)
rem
rem  Python auto-detection (order):
rem    1) FS_PYTHON env var  — set your Python command/path
rem    2) Conda (active env, fallback "suanfa_learning")
rem    3) .venv / venv / env  in project root
rem    4) python from PATH
rem
rem  For CLI chat mode use runcode.bat instead.
rem  Note: keep this file ASCII-only; cmd reads .bat as ANSI.
rem ============================================================

echo [1/4] Detecting Python environment ...

rem --- Python auto-detection ---
if not "%FS_PYTHON%"=="" goto :use_fs_python

where conda >nul 2>&1
if errorlevel 1 goto :no_conda
if not "%CONDA_DEFAULT_ENV%"=="" (
    set "CONDA_ENV=%CONDA_DEFAULT_ENV%"
) else (
    set "CONDA_ENV=suanfa_learning"
)
echo   [conda] Using env: %CONDA_ENV%
set "PYTHON_CMD=conda run -n %CONDA_ENV% python"
goto :check_deps

:no_conda
for %%d in (.venv venv env) do if exist "%%d\Scripts\python.exe" (
    echo   [venv] Found: %%d
    set "PYTHON_CMD=%%d\Scripts\python.exe"
    goto :check_deps
)
where python >nul 2>&1
if errorlevel 1 goto :missing_python
echo   [PATH] Using system Python
set "PYTHON_CMD=python"
goto :check_deps

:use_fs_python
echo   [env]  FS_PYTHON=%FS_PYTHON%
set "PYTHON_CMD=%FS_PYTHON%"

:check_deps
echo [2/4] Checking Python dependencies ...
%PYTHON_CMD% -c "import fastapi, langgraph" >nul 2>&1
if errorlevel 1 goto :missing_deps

echo [3/4] Checking Node.js ...
where node >nul 2>&1
if errorlevel 1 goto :missing_node
set "PNPM_CMD=pnpm"
where pnpm >nul 2>&1
if not errorlevel 1 goto :ui_deps
where npx >nul 2>&1
if errorlevel 1 goto :missing_package_manager
set "PNPM_CMD=npx --yes pnpm@11.9.0"

:ui_deps
echo [4/4] Restoring frontend dependencies ...
cd /d "%~dp0ui"
if errorlevel 1 goto :missing_ui
call %PNPM_CMD% install --frozen-lockfile
if errorlevel 1 goto :install_failed

echo Starting services ...
echo   API: http://127.0.0.1:8000  (docs at /docs)
echo   UI:  http://127.0.0.1:5173
cd /d "%~dp0"
start "FactShield API" /min %PYTHON_CMD% -m api.main

rem Wait for the API to become healthy before launching the UI.
set /a TRIES=0
:wait_api
curl -s -o nul http://127.0.0.1:8000/health
if not errorlevel 1 goto :api_ready
set /a TRIES+=1
if %TRIES% geq 40 goto :api_timeout
ping -n 2 127.0.0.1 >nul
goto :wait_api

:api_ready
cd /d "%~dp0ui"
call %PNPM_CMD% run dev --open
if errorlevel 1 goto :start_failed
exit /b 0

:missing_python
echo [ERROR] Could not find Python. Install Python 3.10+, or set FS_PYTHON
echo environment variable to the Python command/path to use.
echo   Example: set FS_PYTHON=C:\path\to\venv\Scripts\python.exe
goto :failed

:missing_deps
echo [ERROR] Python packages (fastapi, langgraph) not found.
echo Run: %PYTHON_CMD% -m pip install -r requirements.txt
goto :failed

:missing_node
echo [ERROR] Node.js is not installed or is not available in PATH.
echo Install Node.js 20.19 or newer, then run this file again.
goto :failed

:missing_package_manager
echo [ERROR] Neither pnpm nor npx is available.
echo Reinstall Node.js with npm included, then run this file again.
goto :failed

:missing_ui
echo [ERROR] The ui directory was not found next to this script.
goto :failed

:install_failed
echo [ERROR] Frontend dependencies could not be installed.
echo Check the network connection and the error messages above.
goto :failed

:api_timeout
echo [ERROR] The API did not become healthy within 40 seconds.
echo Check the "FactShield API" window for errors.
goto :failed

:start_failed
echo [ERROR] The UI server stopped or could not start.
echo If port 5173 is already in use, close the other server and try again.

:failed
echo.
pause
exit /b 1
