# Live-Set Lyric Auditor

**One-liner:** Turn a short noisy concert clip into a timestamped Live Variant Passport for lyric QA, captions, archives, artist teams, and fan experiences.

Live-Set Lyric Auditor is a Musicathon 2026 contest MVP. Musixmatch Pro is the identity, timing, and rights truth layer; LALAL.AI isolates vocals, JamBase adds optional event context, a Whisper-style ASR adapter transcribes the performance, and ElevenLabs provides optional narration polish. The dashboard has resilient fixture mode so judges can run the full flow even when API keys are unavailable.

Version `0.2.0` adds dependable audio/video drag-and-drop, vocal-based lyrics rescue, RichSync-first canonical references, exact recording/common-track identity, version confidence, sync-fit scoring, rights-aware fallback, live structure mapping, and translation review risk.

## Demo Flow

1. Open the app and confirm the top menu shows `Live-Set Lyric Auditor v0.2.0`, dark/light theme control, and integration status.
2. Use the seeded demo or drag/browse a 15-30 second audio or video clip.
3. Auto-identify the recording from the vocal transcript or select a Musixmatch track manually; JamBase event anchoring remains optional.
4. Run analysis and watch the pipeline move through anchor, isolate, transcribe, compare, and passport steps.
5. Review variant candidates with timestamps, types, confidence, and impact notes.
6. Generate the ElevenLabs narration script/audio from the completed passport.

## API Surfaces

- **Musixmatch:** `track.search`, lyrics-rescue search, recording/common-track metadata, `track.richsync.get`, `track.subtitle.get`, and `track.lyrics.get`.
- **LALAL.AI:** `/upload/` and `/split/` using the `X-License-Key` header.
- **JamBase:** REST event search against `api.data.jambase.com/v3`, with fixture fallback.
- **ElevenLabs:** `POST /v1/text-to-speech/:voice_id` using `xi-api-key`.
- **ASR:** configurable Whisper-style endpoint via `ASR_API_URL`.

## Compliance Notes

- Musixmatch lyric/subtitle content is used as an in-memory comparison reference only.
- The app does not bulk-download, cache, redistribute, or persist Musixmatch lyric content.
- Passports store derived metadata: variant type, timestamp, confidence, impact note, and short live ASR snippets.
- Uploaded audio is held in memory for this MVP and is not written to persistent storage.
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
PORT=3000
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
