# Design QA: Live-Set Lyric Auditor v0.8.0

## Evidence

- Source visual truth: `C:\Users\mangezi\AppData\Local\Temp\codex-clipboard-0d5403ff-9edc-495f-975f-63c854017f74.png`, plus the follow-up review screenshots in `codex-clipboard-e287ca92-21ad-4034-9686-dafb7268fc99.png`, `codex-clipboard-857632f7-6f12-45ff-9d3b-c7c78b381d0d.png`, and `codex-clipboard-a4308a8d-ae09-4379-81fc-e80fca4afd1f.png`.
- Implementation target: `http://127.0.0.1:4242`
- Implementation screenshot: unavailable; no usable local-page browser controller was exposed in this session.
- Target state: dark-theme Analysis screen after a completed upload, with transport controls, Track Anchor correction, timestamped transcript review, review queue, selected diff detail, and manual missed-moment entry.
- Target viewport: desktop screenshot state plus compact mobile behavior matching the existing product language.

## Full-View Comparison Evidence

- The source establishes the existing dark studio rack, compact uppercase labels, cyan waveform, orange-red state accents, and bordered status badge.
- The implementation preserves those components and tokens in code, but no rendered screenshot was available for a combined visual comparison.
- Typography, spacing rhythm, colors, responsive wrapping, and copy are covered by component/CSS inspection and automated UI assertions only, not visual sign-off.

## Focused Region Comparison Evidence

- Target region: Live Engine Input waveform, Capture Status, review queue, and selected diff detail from the supplied screenshots.
- Intended extension: rewind, play/pause, timestamp, seek controls, reviewer-added live moments, and cached reference excerpts inside the existing dark studio rack language.
- A focused image comparison was not possible because the implementation capture was unavailable.

## Findings

- [P1] Rendered visual comparison is blocked.
  Location: Analysis screen transport, Track Anchor correction panel, Transcription Review, Review Queue, and Selected Diff Detail.
  Evidence: the source screenshot is available, but neither configured browser surface returned an implementation screenshot.
  Impact: small-screen wrapping, vertical density, exact type weights, and control alignment cannot be visually approved.
  Fix: capture the completed Analysis state at desktop and mobile widths, combine each capture with the source, and resolve any P0-P2 drift.

## Verified Outside Visual QA

- The supplied MP4 completed real LALAL.AI isolation and Replicate transcription with three correct transcript segments.
- Musixmatch lyric fingerprint plus rated catalog resolution maps the transcript to Rod Stewart instead of a low-authority cover entry.
- The supplied MP4 smoke now produces three live variants and zero skipped-line spam; skipped-line reporting is limited to gaps between matched canonical anchors.
- Recall fragments can now complete full Analysis as `recall_recording` input without requiring an uploaded clip or YouTube excerpt.
- YouTube extraction failure is capped by a 15-60 second timeout window, defaulting to 45 seconds, and reports an authorized-excerpt fallback instead of stalling.
- Manual correction re-anchors the existing transcript without rerunning isolation or ASR.
- The media endpoint returns `206 Partial Content` for browser seeking.
- Automated UI coverage asserts play, rewind, seek, timestamped transcript, Recall Rescue continuation, and manual correction controls.
- Automated UI coverage asserts reviewer-added missed live moments such as crowd responses, and export/narration can include those manual candidates.
- Passport variants now carry permitted cached reference excerpts for review display while restricted tracks remain metadata-only.
- `npm start` production routing was smoke-tested on port `4262`; `/analysis` returns the SPA shell instead of crashing on the Express wildcard route.
- `npm audit --audit-level=high` reports zero vulnerabilities after upgrading Vite/esbuild.
- `http://192.168.0.44:4242/api/health` responds in live mode with `Live-Set Lyric Auditor v0.8.0`.
- Mobile capture actions now stack at 767px and imported camera video receives an inline playable preview.

## Patches Made

- Added real analyzed-media playback with play/pause, five-second rewind, waveform seeking, and timestamped transcript navigation.
- Added catalog and manual Track Anchor correction without retranscription.
- Reordered Analysis so the review queue comes before selected diff detail; the queue is the navigator, the diff panel is the inspection view.
- Added manual missed-moment entries for ASR omissions such as audience responses or live ad-libs.
- Added cached reference excerpt display for permitted lyric references.
- Reworked narration copy to summarize concrete timed candidates and manual moments instead of repeating hardcoded category wording.
- Added explicit Recall Rescue continuation actions for upload, live-link, and direct recalled-fragment analysis.
- Limited skipped-line detection to anchored reference windows so short excerpts do not fill the review queue with unrelated canonical omissions.
- Added low-confidence ASR filler filtering and bounded YouTube extraction timeout errors.
- Surfaced background analysis failures instead of leaving the interface stalled midway.
- Added Musixmatch lyric-fingerprint ranking with catalog-authority resolution and compatibility fallback.
- Removed premature Songstats exposure; it remains deferred until it contributes to the Passport.
- Added server-owned duration validation, YouTube host allowlisting, ffmpeg preflight, and explicit live-partner failure handling.
- Added failed auto-match recovery so a track can be selected without repeating isolation or transcription.
- Fixed production SPA fallback routing for Express 5.
- Removed the personal Cyanite webhook from shareable docs and `.env.example`.
- Upgraded Vite/esbuild to clear the high-severity dependency audit.

final result: blocked
