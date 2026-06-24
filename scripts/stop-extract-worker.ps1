# Live-Set Lyric Auditor - stop the extraction worker stack.
#
# This stops the hidden watchdog first, then the worker, then the ngrok tunnel.
# The watchdog is started at logon by the Startup .vbs launcher, not by Task Scheduler,
# so Get-ScheduledTask is intentionally not used here.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\stop-extract-worker.ps1
#
# To also remove the logon launcher:
#   powershell -ExecutionPolicy Bypass -File scripts\stop-extract-worker.ps1 -DisableStartup

param(
  [switch]$DisableStartup
)

$ErrorActionPreference = "SilentlyContinue"
$workerPort = 8745
$tunnelDomain = "uptown-slush-ice.ngrok-free.dev"
$startupLauncher = Join-Path ([Environment]::GetFolderPath("Startup")) "LSLA-Extract-Worker.vbs"

function Stop-MatchingProcess {
  param(
    [Parameter(Mandatory = $true)] [string]$Label,
    [Parameter(Mandatory = $true)] [scriptblock]$Predicate
  )

  $matches = Get-CimInstance Win32_Process | Where-Object $Predicate
  foreach ($process in $matches) {
    Write-Host "Stopping $Label PID $($process.ProcessId): $($process.CommandLine)"
    Stop-Process -Id $process.ProcessId -Force
  }
}

# 1) Stop the respawner first. If this remains alive, it will recreate node on port 8745.
Stop-MatchingProcess "extract worker watchdog" {
  $_.Name -match "powershell|pwsh" -and $_.CommandLine -match "start-extract-worker\.ps1"
}

Start-Sleep -Seconds 1

# 2) Stop the worker itself.
Stop-MatchingProcess "extract worker" {
  $_.Name -eq "node.exe" -and $_.CommandLine -match "extract-worker\.mjs"
}

# 3) Stop the ngrok tunnel for this worker. Prefer the known domain, but fall back to ngrok processes.
Stop-MatchingProcess "ngrok worker tunnel" {
  $_.Name -eq "ngrok.exe" -and ($_.CommandLine -match [regex]::Escape($tunnelDomain) -or $_.CommandLine -match "8745")
}

if ($DisableStartup -and (Test-Path $startupLauncher)) {
  $disabledPath = "$startupLauncher.disabled"
  Move-Item -Path $startupLauncher -Destination $disabledPath -Force
  Write-Host "Disabled Startup launcher: $disabledPath"
}

Start-Sleep -Seconds 1

$listener = Get-NetTCPConnection -LocalPort $workerPort -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Warning "Port $workerPort is still in use by PID(s): $($listener.OwningProcess -join ', ')"
  exit 1
}

Write-Host "Extraction worker stack stopped; port $workerPort is free."
