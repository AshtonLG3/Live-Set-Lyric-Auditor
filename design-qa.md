# Design QA: Live-Set Lyric Auditor v0.8.0

## Evidence

- Source visual truth: `C:\Users\mangezi\AppData\Local\Temp\codex-clipboard-0d5403ff-9edc-495f-975f-63c854017f74.png`
- Implementation target: `http://127.0.0.1:4242`
- Implementation screenshot: unavailable; the in-app Browser failed to attach and the Chrome-backed preview timed out loading the local page.
- Target state: dark-theme Analysis screen after a completed upload, with transport controls, Track Anchor correction, and timestamped transcript review.
- Target viewport: desktop screenshot state plus compact mobile behavior matching the existing product language.

## Full-View Comparison Evidence

- The source establishes the existing dark studio rack, compact uppercase labels, cyan waveform, orange-red state accents, and bordered status badge.
- The implementation preserves those components and tokens in code, but no rendered screenshot was available for a combined visual comparison.
- Typography, spacing rhythm, colors, responsive wrapping, and copy are covered by component/CSS inspection and automated UI assertions only, not visual sign-off.

## Focused Region Comparison Evidence

- Target region: Live Engine Input waveform and Capture Status from the supplied screenshot.
- Intended extension: rewind, play/pause, timestamp, and seek controls inside the existing left and center zones without replacing the waveform or status treatment.
- A focused image comparison was not possible because the implementation capture was unavailable.

## Findings

- [P1] Rendered visual comparison is blocked.
  Location: Analysis screen transport, Track Anchor correction panel, and Transcription Review.
  Evidence: the source screenshot is available, but neither configured browser surface returned an implementation screenshot.
  Impact: small-screen wrapping, vertical density, exact type weights, and control alignment cannot be visually approved.
  Fix: capture the completed Analysis state at desktop and mobile widths, combine each capture with the source, and resolve any P0-P2 drift.

## Verified Outside Visual QA

- The supplied MP4 completed real LALAL.AI isolation and Replicate transcription with three correct transcript segments.
- Musixmatch lyric fingerprint plus rated catalog resolution maps the transcript to Rod Stewart instead of a low-authority cover entry.
- Manual correction re-anchors the existing transcript without rerunning isolation or ASR.
- The media endpoint returns `206 Partial Content` for browser seeking.
- Automated UI coverage asserts play, rewind, seek, timestamped transcript, Recall Rescue continuation, and manual correction controls.
- Mobile capture actions now stack at 767px and imported camera video receives an inline playable preview.

## Patches Made

- Added real analyzed-media playback with play/pause, five-second rewind, waveform seeking, and timestamped transcript navigation.
- Added catalog and manual Track Anchor correction without retranscription.
- Added explicit Recall Rescue continuation actions for upload and live-link analysis.
- Surfaced background analysis failures instead of leaving the interface stalled midway.
- Added Musixmatch lyric-fingerprint ranking with catalog-authority resolution and compatibility fallback.
- Removed premature Songstats exposure; it remains deferred until it contributes to the Passport.
- Added server-owned duration validation, YouTube host allowlisting, ffmpeg preflight, and explicit live-partner failure handling.
- Added failed auto-match recovery so a track can be selected without repeating isolation or transcription.

final result: blocked
