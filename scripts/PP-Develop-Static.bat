@echo off
setlocal
title ProjectPilot Stable - develop-static:4287

set "ROOT=D:\Desktop\ProgrammingProjects\personal-projects\03-In-Development\project-pilot\develop-static"

if not exist "%ROOT%\package.json" (
  echo [ERROR] Worktree not found: %ROOT%
  pause
  exit /b 1
)

cd /d "%ROOT%"
set "PROJECT_PILOT_WORK_DIR=%ROOT%"

set "PORT_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":4287 .*LISTENING"') do (
  set "PORT_PID=%%a"
  goto :port_busy
)
goto :port_ok

:port_busy
echo [ERROR] Port 4287 is already in use by PID %PORT_PID%.
echo Close the existing develop-static server first, then retry.
pause
exit /b 1

:port_ok
set "NEEDS_INSTALL="
if not exist "%ROOT%\node_modules" (
  set "NEEDS_INSTALL=1"
  goto :install_deps
)

fsutil reparsepoint query "%ROOT%\node_modules" >nul 2>nul
if not errorlevel 1 (
  echo [ProjectPilot] Removing linked node_modules. develop-static must use its own dependencies...
  rmdir "%ROOT%\node_modules"
  set "NEEDS_INSTALL=1"
  goto :install_deps
)

if not exist "%ROOT%\node_modules\.bin\next.cmd" (
  echo [ProjectPilot] node_modules is incomplete. Reinstalling develop-static dependencies...
  set "NEEDS_INSTALL=1"
)

if not exist "%ROOT%\node_modules\@alloc\quick-lru\package.json" (
  echo [ProjectPilot] Missing @alloc/quick-lru. Reinstalling develop-static dependencies...
  set "NEEDS_INSTALL=1"
)

:install_deps
if defined NEEDS_INSTALL (
  echo [ProjectPilot] Installing independent node_modules for develop-static...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed in %ROOT%
    pause
    exit /b 1
  )
)

if exist "%ROOT%\.next\dev\lock" (
  echo [ProjectPilot] Removing stale turbopack lock...
  del /f /q "%ROOT%\.next\dev\lock"
)

echo [ProjectPilot] Preparing develop-static...
call npm run predev
if errorlevel 1 (
  echo [ERROR] predev failed
  pause
  exit /b 1
)

echo [ProjectPilot] Starting develop-static on http://127.0.0.1:4287
call "%ROOT%\node_modules\.bin\next.cmd" dev --port 4287 --turbopack
if errorlevel 1 (
  echo [ERROR] develop-static failed to start with turbopack.
  echo Check whether 4287 is occupied or whether another next dev instance is still holding .next\dev\lock.
  pause
  exit /b 1
)

endlocal
