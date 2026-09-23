@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   SVG Head Matrix - Local Offline Server
echo ============================================
echo.

set "PYTHON_CMD="
where py >nul 2>&1
if %errorlevel%==0 set "PYTHON_CMD=py"

if not defined PYTHON_CMD (
  where python >nul 2>&1
  if %errorlevel%==0 set "PYTHON_CMD=python"
)

if not defined PYTHON_CMD (
  echo ERROR: Python was not found on this computer.
  echo.
  echo Install Python 3 from https://www.python.org/downloads/
  echo During installation, tick "Add python.exe to PATH".
  echo.
  echo After installing Python, run this file again.
  echo.
  pause
  exit /b 1
)

echo Using: %PYTHON_CMD%
echo Serving this folder at http://localhost:8000
echo.
echo Keep this window OPEN while using the app.
echo Press Ctrl+C here when you want to stop the server.
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:8000'"

%PYTHON_CMD% -m http.server 8000 --bind 127.0.0.1
set "SERVER_EXIT=%errorlevel%"

echo.
echo The local server stopped with exit code %SERVER_EXIT%.
if not "%SERVER_EXIT%"=="0" (
  echo Common causes: port 8000 is already in use, or Python could not start.
)
echo.
pause
exit /b %SERVER_EXIT%
