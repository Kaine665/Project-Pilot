# 顺序跑 baseline + workflow-a + workflow-b，截图输出到 develop-static/tmp/ui-workflow-experiment/
$ErrorActionPreference = "Stop"
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not (Test-Path (Join-Path $root "develop-static\package.json"))) {
  $root = "D:\Desktop\ProgrammingProjects\personal-projects\03-In-Development\project-pilot"
}
$ds = Join-Path $root "develop-static"
$wa = Join-Path $root "exp-ui-workflow-a-agents"
$wb = Join-Path $root "exp-ui-workflow-b-agents"
$captureJs = Join-Path $ds "tmp\ui-workflow-experiment-capture.mjs"
$probe = "http://127.0.0.1:4000/flows/agents"

function Stop-Port4000 {
  Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

function Wait-Http([string]$url, [int]$maxSec = 180) {
  $deadline = (Get-Date).AddSeconds($maxSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) { return }
    } catch {}
    Start-Sleep -Seconds 2
  }
  throw "Timeout waiting for $url"
}

function Run-One([string]$workdir, [string]$label) {
  if (-not (Test-Path (Join-Path $workdir "package.json"))) {
    throw "Missing package.json: $workdir"
  }
  Write-Host "=== $label :: $workdir ===" -ForegroundColor Cyan
  Stop-Port4000
  Start-Sleep -Seconds 2
  $proc = Start-Process -FilePath "cmd.exe" -ArgumentList @(
    "/c", "cd /d `"$workdir`" && npm run dev"
  ) -PassThru -WindowStyle Hidden
  try {
    Wait-Http $probe
    Push-Location $ds
    node $captureJs 4000 $label
    Pop-Location
  } finally {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Stop-Port4000
    Start-Sleep -Seconds 3
  }
}

Run-One $ds "baseline"
Run-One $wa "workflow-a"
Run-One $wb "workflow-b"
Write-Host "Done. PNG -> $ds\tmp\ui-workflow-experiment\" -ForegroundColor Green
