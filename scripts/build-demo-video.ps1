param(
  [string]$BaseUrl = $(if ($env:DEMO_BASE_URL) { $env:DEMO_BASE_URL } else { "http://127.0.0.1:4244" }),
  [string]$Version = $(if ($env:DEMO_APP_VERSION) { $env:DEMO_APP_VERSION } else { "0.11.3" }),
  [string]$Output = $(if ($env:DEMO_OUTPUT) { $env:DEMO_OUTPUT } else { "" }),
  [switch]$SkipCapture
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root
if (-not $Output) {
  $Output = "demo/live-set-lyric-auditor-demo-v$Version.mp4"
}

New-Item -ItemType Directory -Force -Path "demo/captures", "demo/slides", "demo/tmp" | Out-Null

if (-not $SkipCapture) {
  $env:DEMO_BASE_URL = $BaseUrl
  npm run demo:capture
}

Add-Type -AssemblyName System.Speech
$voiceoverText = Join-Path $root "demo/voiceover.txt"
$voiceoverWav = Join-Path $root "demo/tmp/voiceover.wav"
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = -1
$synth.Volume = 100
try { $synth.SelectVoice("Microsoft Zira Desktop") } catch { }
$synth.SetOutputToWaveFile($voiceoverWav)
$synth.Speak([System.IO.File]::ReadAllText($voiceoverText))
$synth.Dispose()

python scripts/render-demo-video.py --version $Version --voiceover $voiceoverWav --output $Output
