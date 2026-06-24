# Live-Set Lyric Auditor - extraction worker keep-alive.
# Launches the home extraction worker + its ngrok tunnel and relaunches either one if it dies.
# When run from the Startup folder it also brings them back after a reboot (at logon).
#
# ONE-TIME SETUP on this machine:
#   1. Persist the shared secret so the auto-started worker has it across reboots:
#        setx EXTRACT_WORKER_TOKEN "your-long-secret"
#      (open a NEW terminal afterwards so the value is in scope)
#   2. A Startup launcher (LSLA-Extract-Worker.vbs) runs this hidden at logon - already created.
#   3. If your ngrok reserved domain ever changes, edit $tunnelUrl below.
#
# To start everything MANUALLY (instead of waiting for logon):
#   powershell -ExecutionPolicy Bypass -File scripts\start-extract-worker.ps1

$ErrorActionPreference = "SilentlyContinue"
$workerScript = Join-Path $PSScriptRoot "extract-worker.mjs"
$tunnelUrl    = "https://uptown-slush-ice.ngrok-free.dev"   # your reserved ngrok domain
$workerPort   = 8745

function WorkerAlive {
  [bool](Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*extract-worker.mjs*" })
}

# Relaunch whichever piece is missing, every 30s. Crash -> back within 30s; reboot -> back at logon.
while ($true) {
  if (-not (WorkerAlive)) {
    Start-Process -FilePath "node" -ArgumentList "`"$workerScript`"" -WindowStyle Hidden
  }
  if (-not (Get-Process ngrok -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath "ngrok" -ArgumentList "http", "$workerPort", "--url=$tunnelUrl" -WindowStyle Hidden
  }
  Start-Sleep -Seconds 30
}
