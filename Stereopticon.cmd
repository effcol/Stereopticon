@echo off
rem Double-click to run Stereopticon from this folder's current source.
rem Installs dependencies on first run and rebuilds the game catalogue index,
rem so whatever is in the folder right now is what starts.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found. Install it from https://nodejs.org and run this again.
    pause
    exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo Installing dependencies, first run only...
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        pause
        exit /b 1
    )
)

echo Building the game catalogue index...
node scripts\build-data-bundle.js
if errorlevel 1 (
    echo The catalogue index could not be built.
    pause
    exit /b 1
)

rem Start the app detached so this window can close.
start "" "node_modules\electron\dist\electron.exe" .
endlocal
