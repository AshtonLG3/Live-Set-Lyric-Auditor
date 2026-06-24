# Live-Set Lyric Auditor - extraction worker keep-alive.
# Launches the home extraction worker + its ngrok tunnel and relaunches either one if it dies.
# When run from the Startup folder it also brings them back after a reboot (at logon).
#
# ONE-TIME SETUP on this machine:
#   1. Persist the shared secret so the auto-started worker has it across reboots:
#        setx EXTRACT_WORKER_TOKEN "your-long-secret"
#      Optional YouTube cookie sources for bot/login challenges:
#        setx YT_COOKIES_FROM_BROWSER "firefox"
#        setx YT_COOKIES_FILE "C:\Users\mangezi\yt-cookies.txt"
#      The watchdog rereads these persisted values every loop and restarts only the worker
#      when they change, so you do not have to race the respawner.
#   2. A Startup launcher (LSLA-Extract-Worker.vbs) runs this hidden at logon - already created.
#   3. If your ngrok reserved domain ever changes, edit $tunnelDomain below.
#
# To start everything MANUALLY (instead of waiting for logon):
#   powershell -ExecutionPolicy Bypass -File scripts\start-extract-worker.ps1
# To stop everything cleanly:
#   powershell -ExecutionPolicy Bypass -File scripts\stop-extract-worker.ps1

$ErrorActionPreference = "SilentlyContinue"
$workerScript = Join-Path $PSScriptRoot "extract-worker.mjs"
$workerPort   = 8745
$tunnelDomain = "uptown-slush-ice.ngrok-free.dev"
$logPath      = Join-Path $env:TEMP "lsla-extract-worker-watchdog.log"

$workerEnvNames = @(
  "EXTRACT_WORKER_TOKEN",
  "YT_COOKIES_FROM_BROWSER",
  "YT_COOKIES_FILE",
  "PYTHON_COMMAND",
  "PORT"
)

function Write-WatchdogLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $logPath -Value "[$timestamp] $Message"
}

function Get-PersistedEnvValue {
  param([Parameter(Mandatory = $true)] [string]$Name)
  $userValue = [Environment]::GetEnvironmentVariable($Name, "User")
  if (-not [string]::IsNullOrWhiteSpace($userValue)) { return $userValue }
  $machineValue = [Environment]::GetEnvironmentVariable($Name, "Machine")
  if (-not [string]::IsNullOrWhiteSpace($machineValue)) { return $machineValue }
  return [Environment]::GetEnvironmentVariable($Name, "Process")
}

function Refresh-WorkerEnv {
  foreach ($name in $workerEnvNames) {
    $value = Get-PersistedEnvValue $name
    if ([string]::IsNullOrWhiteSpace($value)) {
      [Environment]::SetEnvironmentVariable($name, $null, "Process")
    } else {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

function Get-WorkerEnvSignature {
  ($workerEnvNames | ForEach-Object {
    "$($_)=$([Environment]::GetEnvironmentVariable($_, 'Process'))"
  }) -join "`n"
}

function WorkerProcess {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*extract-worker.mjs*" }
}

function WorkerAlive {
  [bool](WorkerProcess)
}

function Stop-Worker {
  WorkerProcess | ForEach-Object {
    Write-WatchdogLog "Stopping worker PID $($_.ProcessId) to reload environment."
    Stop-Process -Id $_.ProcessId -Force
  }
}

function NgrokAlive {
  [bool](Get-CimInstance Win32_Process -Filter "Name = 'ngrok.exe'" |
    Where-Object { $_.CommandLine -match [regex]::Escape($tunnelDomain) -or $_.CommandLine -match "8745" })
}

$lastWorkerEnvSignature = $null
Write-WatchdogLog "Watchdog started."

# Relaunch whichever piece is missing, every 30s. Crash -> back within 30s; reboot -> back at logon.
while ($true) {
  Refresh-WorkerEnv
  $currentWorkerEnvSignature = Get-WorkerEnvSignature

  if ($lastWorkerEnvSignature -ne $null -and $currentWorkerEnvSignature -ne $lastWorkerEnvSignature -and (WorkerAlive)) {
    Stop-Worker
    Start-Sleep -Seconds 2
    $lastWorkerEnvSignature = $null
  }

  if (-not (WorkerAlive)) {
    if ([string]::IsNullOrWhiteSpace($env:EXTRACT_WORKER_TOKEN)) {
      Write-WatchdogLog "Worker not started: EXTRACT_WORKER_TOKEN is missing."
    } else {
      Write-WatchdogLog "Starting worker on port $workerPort. CookiesFromBrowser=$env:YT_COOKIES_FROM_BROWSER CookiesFile=$env:YT_COOKIES_FILE"
      Start-Process -FilePath "node" -ArgumentList "`"$workerScript`"" -WorkingDirectory (Split-Path $PSScriptRoot -Parent) -WindowStyle Hidden
      $lastWorkerEnvSignature = $currentWorkerEnvSignature
    }
  }

  if (-not (NgrokAlive)) {
    Write-WatchdogLog "Starting ngrok tunnel for $tunnelDomain -> localhost:$workerPort."
    Start-Process -FilePath "ngrok" -ArgumentList "http", "--domain=$tunnelDomain", "$workerPort" -WindowStyle Hidden
  }

  Start-Sleep -Seconds 30
}
