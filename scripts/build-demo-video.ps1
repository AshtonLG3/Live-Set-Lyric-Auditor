param(
  [string]$BaseUrl = $(if ($env:DEMO_BASE_URL) { $env:DEMO_BASE_URL } else { "http://127.0.0.1:4244" }),
  [string]$Version = $(if ($env:DEMO_APP_VERSION) { $env:DEMO_APP_VERSION } else { "0.11.4" }),
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

$voiceoverText = Join-Path $root "demo/voiceover.txt"
$voiceoverMp3 = Join-Path $root "demo/tmp/voiceover-elevenlabs.mp3"
$voiceoverWav = Join-Path $root "demo/tmp/voiceover-fallback.wav"

node scripts/generate-demo-voiceover.mjs $voiceoverText $voiceoverMp3
if ($LASTEXITCODE -eq 0 -and (Test-Path $voiceoverMp3)) {
  $voiceoverAudio = $voiceoverMp3
} else {
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.Rate = 0
  $synth.Volume = 100
  try { $synth.SelectVoice("Microsoft David Desktop") } catch { }
  $synth.SetOutputToWaveFile($voiceoverWav)
  $synth.Speak([System.IO.File]::ReadAllText($voiceoverText))
  $synth.Dispose()
  $voiceoverAudio = $voiceoverWav
}

python scripts/render-demo-video.py --version $Version --voiceover $voiceoverAudio --output $Output
