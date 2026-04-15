@echo off
setlocal
title ProjectPilot dev — repo root

rem 本脚本位于 scripts/，仓库根为其上一级目录
set "ROOT=%~dp0.."
pushd "%ROOT%" >nul 2>&1
if not exist "package.json" (
  echo [ERROR] package.json not found at: %CD%
  popd >nul 2>&1
  pause
  exit /b 1
)

set "PROJECT_PILOT_WORK_DIR=%CD%"

set "PORT_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":4000 .*LISTENING"') do (
  set "PORT_PID=%%a"
  goto :port_busy
)
goto :port_ok

:port_busy
echo [ERROR] Port 4000 is already in use by PID %PORT_PID%.
echo Close the existing dev server first, then retry.
popd >nul 2>&1
pause
exit /b 1

:port_ok
set "NEEDS_INSTALL="
if not exist "node_modules" (
  set "NEEDS_INSTALL=1"
  goto :install_deps
)

fsutil reparsepoint query "node_modules" >nul 2>nul
if not errorlevel 1 (
  echo [ProjectPilot] Removing linked node_modules. Repository root must use its own dependencies...
  rmdir "node_modules"
  set "NEEDS_INSTALL=1"
  goto :install_deps
)

if not exist "node_modules\vite\package.json" (
  echo [ProjectPilot] node_modules is incomplete. Reinstalling dependencies...
  set "NEEDS_INSTALL=1"
)

if not exist "node_modules\@alloc\quick-lru\package.json" (
  echo [ProjectPilot] Missing @alloc/quick-lru. Reinstalling dependencies...
  set "NEEDS_INSTALL=1"
)

:install_deps
if defined NEEDS_INSTALL (
  echo [ProjectPilot] Installing dependencies at repo root...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed in %CD%
    popd >nul 2>&1
    pause
    exit /b 1
  )
)

echo [ProjectPilot] Starting dev (see config/dev-server.json for ports^)...
call npm run dev
if errorlevel 1 (
  echo [ERROR] npm run dev failed.
  popd >nul 2>&1
  pause
  exit /b 1
)

popd >nul 2>&1
endlocal
