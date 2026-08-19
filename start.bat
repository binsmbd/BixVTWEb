@echo off
rem Bix Transform launcher (Windows). Double-click this file to start the app.
setlocal
cd /d "%~dp0"

if "%PORT%"=="" set PORT=5173

where node >nul 2>nul
if %errorlevel%==0 (
    node server.mjs %*
    goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
    echo.
    echo   Bix Transform is running ^(Python fallback - Node.js not found^)
    echo.
    echo   Local     http://localhost:%PORT%
    echo.
    echo   Press Ctrl+C to stop.
    echo.
    start "" "http://localhost:%PORT%"
    python -m http.server %PORT% --bind 127.0.0.1
    goto :eof
)

echo.
echo   Bix Transform needs a local web server to run.
echo.
echo   Neither Node.js nor Python was found on this machine.
echo   Install Node.js from https://nodejs.org and run this file again.
echo.
echo   ^(A server is required because the app uses ES modules, which
echo    browsers refuse to load straight off the file system.^)
echo.
pause
