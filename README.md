# Live-Set Lyric Auditor

**One-liner:** Turn a short noisy concert clip into a timestamped Live Variant Passport for lyric QA, captions, archives, artist teams, and fan experiences.

Live-Set Lyric Auditor is a Musicathon 2026 contest MVP. Musixmatch Pro is the identity, timing, and rights truth layer; LALAL.AI isolates vocals, JamBase adds optional event context, a Whisper-style ASR adapter transcribes the performance, and ElevenLabs provides optional narration polish. The dashboard has resilient fixture mode so judges can run the full flow even when API keys are unavailable.

Version `0.4.0` introduces a responsive two-surface workflow. **New Session** keeps the three intake paths: uploaded media, ranged live-performance links, and Recall Rescue for a lyric fragment spoken, sung, or typed by the user. **Analysis Studio** turns the result into a focused review workspace with a live waveform, track/event evidence, pipeline timeline, filterable candidates, approve/reject controls, confidence signals, and export-ready Passport preview. Linked provider media stays embedded and attributed; users can attach an authorized excerpt for real processing, while fixture audio keeps the contest demonstration reliable.

## Demo Flow

1. Open the app and confirm the menu shows `Live-Set Lyric Auditor v0.4.0`, dark/light theme control, and the New Session / Analysis Studio navigation.
2. Use Recall Rescue to speak, sing, or type a remembered lyric fragment and anchor the best Musixmatch candidate.
3. Paste a YouTube or other live-performance URL, select a 15-45 second range, and optionally attach an authorized excerpt.
4. Run analysis and move into Analysis Studio to watch the pipeline isolate, transcribe, match, compare, and generate the Passport.
5. Filter and review timestamped candidates, approve/reject evidence, and inspect source identity, rights mode, structure map, and confidence.
6. Generate the optional ElevenLabs narration and export the derived Passport JSON.

## API Surfaces

- **Musixmatch:** `track.search`, lyrics-rescue search, recording/common-track metadata, `track.richsync.get`, `track.subtitle.get`, and `track.lyrics.get`.
- **LALAL.AI:** `/upload/` and `/split/` using the `X-License-Key` header.
- **JamBase:** REST event search against `api.data.jambase.com/v3`, with fixture fallback.
- **ElevenLabs:** `POST /v1/text-to-speech/:voice_id` using `xi-api-key`.
- **ASR:** configurable Whisper-style endpoint via `ASR_API_URL`.
- **Browser media:** `MediaRecorder` captures a short personal rendition for Recall Rescue or direct auditing.

App endpoints include `POST /api/recall` for spoken/sung/typed lyric rescue and `POST /api/analyze` for uploaded, linked, or recorded sources.

## Compliance Notes

- Musixmatch lyric/subtitle content is used as an in-memory comparison reference only.
- The app does not bulk-download, cache, redistribute, or persist Musixmatch lyric content.
- Passports store derived metadata: variant type, timestamp, confidence, impact note, and short live ASR snippets.
- Uploaded audio is held in memory for this MVP and is not written to persistent storage.
- YouTube and other hosted provider streams are embedded and linked as evidence, not downloaded by the app.
- A linked source without an authorized excerpt is clearly marked `reference_fixture` in the Passport.
- Restricted lyrics switch the passport to metadata-only mode rather than substituting unrelated canonical text.
- Canonical lyric text is not included in exported passport objects; only line identifiers and derived overlap signals are returned.

## Product Focus

The contest build deliberately prioritizes Musixmatch-native value:

- exact `track_id` / `commontrack_id` / ISRC identity
- RichSync-first word timing with subtitle/plain-lyric fallback
- version confidence and sync-fit scoring
- rights and restriction status
- performance structure changes and recommended QA actions
- vocal-derived lyrics rescue when the user does not know the track
- provider-aware live links with start/end evidence ranges
- Recall Rescue from a personal spoken or sung lyric fragment
- a desktop QA workbench and compact mobile review flow for decisions in the field

JamBase and ElevenLabs remain supporting integrations. Lyrics mood/analysis search, translated lyric retrieval, and direct audio/fingerprint endpoint wiring are intentionally deferred until the contest Pro documentation/key confirms their exact request and response contracts.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4242`.

Optional environment variables:

```bash
MUSIXMATCH_API_KEY=
JAMBASE_API_KEY=
LALAL_LICENSE_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ASR_API_URL=
ASR_API_KEY=
PORT=4242
```

## Replit

Use the same commands:

```bash
npm install
npm run dev
```

The Express server hosts both the API and Vite app on one port.

## Verification

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```
