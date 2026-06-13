# Live-Set Lyric Auditor

**One-liner:** Turn a short noisy concert clip into a timestamped Live Variant Passport for lyric QA, captions, archives, artist teams, and fan experiences.

Live-Set Lyric Auditor is a Musicathon 2026 contest MVP. Musixmatch Pro is the identity, timing, and rights truth layer; LALAL.AI isolates vocals, JamBase anchors the event and setlist context, Cyanite profiles the live arrangement, a Whisper-style ASR adapter transcribes the performance, and ElevenLabs provides optional narration polish. The dashboard has resilient demo data so judges can run the full flow even when API keys are unavailable.

Version `0.6.0` adds live-performance intelligence without making the workflow more technical. **Dashboard** explains where to begin through a cinematic hero, partner readiness, Upload clip / Live link / Recall lyric fragment intake, and explicit Musixmatch and JamBase anchors. **Analysis** turns the result into a DAW-inspired review workspace with waveform telemetry, a live-arrangement profiling stage, compliance-safe diff view, JamBase Live Context, Cyanite Performance Context, filterable candidates, approve/reject controls, narration, and reviewed Passport export. Linked provider media stays attributed; seeded demo data keeps the contest flow reliable when external keys are unavailable.

## Demo Flow

1. Open the app and confirm the menu shows `Live-Set Lyric Auditor v0.6.0`, dark/light theme control, the focused Dashboard / Analysis navigation, and one reviewed export action.
2. Use Recall Rescue to speak, sing, or type a remembered lyric fragment and anchor the best Musixmatch candidate.
3. Paste a YouTube or other live-performance URL, select a 15-45 second range, and optionally attach an authorized excerpt.
4. Run analysis and move into Analysis to watch the timeline isolate, profile the arrangement, transcribe, match, compare, and generate the Passport.
5. Inspect JamBase setlist/lineup evidence and Cyanite energy, BPM, mood, instrument, and arrangement context before reviewing timestamped candidates.
6. Generate the optional ElevenLabs narration and export the derived Passport JSON with current approve, reject, and pending review decisions.

## API Surfaces

- **Musixmatch:** `track.search`, lyrics-rescue search, recording/common-track metadata, `track.richsync.get`, `track.subtitle.get`, and `track.lyrics.get`.
- **LALAL.AI:** `/upload/` and `/split/` using the `X-License-Key` header.
- **JamBase:** Bearer-authenticated event search against `api.data.jambase.com/v3`, mapping artist/venue IDs, lineup, tour/festival, and setlist evidence when supplied.
- **Cyanite:** GraphQL analysis against `api.cyanite.ai/graphql`; YouTube enqueue and MP3 signed upload feed energy, BPM, mood, instrument, valence/arousal, and arrangement metadata.
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
- JamBase event, lineup, canonical artist/venue ID, and setlist-position context
- Cyanite performance energy, BPM, emotion, instrument, and arrangement context
- a desktop QA workbench and compact mobile review flow for decisions in the field

Songstats remains intentionally deferred because trend intelligence is useful pitch context but not required for the core evidence pipeline. n8n remains optional orchestration rather than an application dependency. Lyrics translations and direct Musixmatch audio/fingerprint endpoint wiring remain deferred until the contest Pro key confirms their exact request and response contracts.

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
JAMBASE_API_BASE_URL=https://api.data.jambase.com/v3
CYANITE_API_TOKEN=
CYANITE_API_BASE_URL=https://api.cyanite.ai/graphql
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
