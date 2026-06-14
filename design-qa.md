# Design QA: Live-Set Lyric Auditor v0.7.0

## Evidence

- Source visual truth: `C:\Users\mangezi\OneDrive\Documents\Musicathon\.codex-remote-attachments\019ec62c-d9c8-7ca3-9696-b57cb9c42c75\e065ee45-3422-43d6-8479-4da70bf18ab8\1-Photo-1.jpg`
- Implementation screenshot: unavailable because the in-app Browser is not callable in this session and standalone Playwright requires separate user approval.
- Viewport target: 576 x 1280 mobile, dark theme, Recall lyric fragment state; Upload clip is the new camera-capture comparison state.

## Full-View Comparison Evidence

- The source shows the existing mobile header, three intake modes, Recall Rescue card, warning copy, track anchor, and fixed bottom navigation.
- No current rendered screenshot could be captured, so typography, spacing, colors, and responsive layout cannot be signed off from visual evidence.

## Focused Region Comparison Evidence

- Target region: Clip Intake mode selector, Upload clip action area, Recall Rescue warning, and top-bar version/theme controls.
- Focused comparison is blocked by the same missing implementation capture.

## Findings

- [P1] Current mobile visual comparison is blocked.
  Location: Clip Intake on the mobile Dashboard.
  Evidence: the source screenshot is available, but there is no rendered v0.7.0 screenshot for a combined comparison.
  Impact: camera-button wrapping, warning density, and small-screen spacing cannot be visually approved.
  Fix: capture the app at the source viewport, compare both states together, and resolve any P0-P2 drift.

## Verified Outside Visual QA

- Typecheck, lint, 22 automated tests, and the production build pass.
- Tests verify the visible v0.7.0 menu version, dark/light theme toggle, rear-camera `capture="environment"` input, camera-video import, and HTTPS-required microphone state.
- The camera action reuses the existing file inspection and analysis path, including duration, size, type, replace, and remove behavior.

## Patches Made Since v0.6.0

- Added Browse files and Record live as complementary Upload clip actions.
- Added rear-camera capture for short stage-performance video on supported phones.
- Added secure-context microphone diagnostics and permission-specific recovery messages.
- Added responsive wrapping for camera and replacement controls.
- Bumped visible and package version metadata to v0.7.0.

final result: blocked
