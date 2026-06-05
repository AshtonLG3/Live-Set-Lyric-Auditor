# Live-Set Lyric Auditor

**One-liner:** Turn a short noisy concert clip into a timestamped Live Variant Passport for lyric QA, captions, archives, artist teams, and fan experiences.

Live-Set Lyric Auditor is a Musicathon 2026 contest MVP. It uses Musixmatch as the canonical lyric and metadata anchor, LALAL.AI for vocal isolation, JamBase for event anchoring, a Whisper-style ASR adapter for live transcription, and ElevenLabs for a short narrated summary. The app is designed as a professional QA dashboard with a resilient fixture mode so judges can run the full flow even when API keys are unavailable.

## Demo Flow

1. Open the app and confirm the top menu shows `Live-Set Lyric Auditor v0.1.0`, dark/light theme control, and integration status.
2. Use the seeded demo or upload a 15-30 second audio clip.
3. Search/select a Musixmatch track and JamBase event anchor.
4. Run analysis and watch the pipeline move through anchor, isolate, transcribe, compare, and passport steps.
5. Review variant candidates with timestamps, types, confidence, and impact notes.
6. Generate the ElevenLabs narration script/audio from the completed passport.

## API Surfaces

- **Musixmatch:** `track.search`, metadata fields, `track.lyrics.get`, and `track.subtitle.get`.
- **LALAL.AI:** `/upload/` and `/split/` using the `X-License-Key` header.
- **JamBase:** REST event search against `api.data.jambase.com/v3`, with fixture fallback.
- **ElevenLabs:** `POST /v1/text-to-speech/:voice_id` using `xi-api-key`.
- **ASR:** configurable Whisper-style endpoint via `ASR_API_URL`.

## Compliance Notes

- Musixmatch lyric/subtitle content is used as an in-memory comparison reference only.
- The app does not bulk-download, cache, redistribute, or persist Musixmatch lyric content.
- Passports store derived metadata: variant type, timestamp, confidence, impact note, and short live ASR snippets.
- Uploaded audio is held in memory for this MVP and is not written to persistent storage.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

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

