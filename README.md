# Live-Set Lyric Auditor

**One-liner:** Turn a short noisy concert clip into a timestamped Live Variant Passport for lyric QA, captions, archives, artist teams, and fan experiences.

Live-Set Lyric Auditor is a Musicathon 2026 contest MVP. Musixmatch Pro is the identity, timing, and rights truth layer; LALAL.AI isolates vocals, JamBase anchors the event and setlist context, Cyanite profiles the live arrangement, a Whisper-style ASR adapter transcribes the performance, and ElevenLabs provides optional narration polish. The dashboard has resilient demo data so judges can run the full flow even when API keys are unavailable.

Version `0.8.0` adds automatic local `.env` loading so newly issued Musixmatch credentials activate the live catalog adapter without exposing secrets in source control. Mobile live capture, secure media-permission guidance, and the existing analysis workflow remain unchanged.

## Demo Flow

1. Open the app and confirm the menu shows `Live-Set Lyric Auditor v0.8.0`, dark/light theme control, the focused Dashboard / Analysis navigation, and one reviewed export action.
2. Import an audio/video clip or use **Record live** on a phone to capture a short rear-camera stage-performance video.
3. Use Recall Rescue over HTTPS to speak or sing a remembered lyric fragment, or type the words when microphone capture is unavailable.
4. Paste a YouTube or other live-performance URL, select a 15-45 second range, and optionally attach an authorized excerpt.
5. Run analysis and move into Analysis to watch the timeline isolate, profile the arrangement, transcribe, match, compare, and generate the Passport.
6. Inspect JamBase setlist/lineup evidence and Cyanite energy, BPM, mood, instrument, and arrangement context before reviewing timestamped candidates.
7. Generate the optional ElevenLabs narration and export the derived Passport JSON with current approve, reject, and pending review decisions.

## API Surfaces

- **Musixmatch:** `track.search`, lyrics-rescue search, recording/common-track metadata, `track.richsync.get`, `track.subtitle.get`, and `track.lyrics.get`.
- **LALAL.AI:** raw `/upload/`, `/split/stem_separator/`, `/check/`, and `/limits/minutes_left/` requests using the activation key in the `X-License-Key` header. Purchased minutes are the API processing balance.
- **JamBase:** Bearer-authenticated event search against `api.data.jambase.com/v3`, mapping artist/venue IDs, lineup, tour/festival, and setlist evidence when supplied.
- **Cyanite:** GraphQL analysis against `api.cyanite.ai/graphql`; YouTube enqueue and MP3 signed upload feed energy, BPM, mood, instrument, valence/arousal, and arrangement metadata.
- **ElevenLabs:** `POST /v1/text-to-speech/:voice_id` using `xi-api-key`.
- **ASR:** Replicate `incredibly-fast-whisper` with the pinned `openai/whisper` version as fallback; a custom Whisper-style endpoint remains available through `ASR_API_URL`. When LALAL.AI succeeds, the separated vocal stem is transcribed instead of the original noisy stage clip.
- **Browser media:** `MediaRecorder` captures a short personal rendition for Recall Rescue on HTTPS. Mobile file capture can invoke the rear camera for a short live-performance video without replacing normal clip import.

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

For a phone on the same Wi-Fi network, open the computer's LAN address, for example `http://192.168.0.44:4242`. The development server binds to `0.0.0.0` by default so LAN devices can connect; Windows Firewall must allow Node.js on the active network profile.

Optional environment variables:

```bash
HOST=0.0.0.0
PORT=4242
MUSIXMATCH_API_KEY=
JAMBASE_API_KEY=
JAMBASE_API_BASE_URL=https://api.data.jambase.com/v3
CYANITE_API_TOKEN=
CYANITE_API_BASE_URL=https://api.cyanite.ai/graphql
LALAL_LICENSE_KEY=
LALAL_API_BASE_URL=https://www.lalal.ai/api/v1
LALAL_POLL_INTERVAL_MS=3000
LALAL_POLL_TIMEOUT_MS=180000
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ASR_API_URL=
ASR_API_KEY=
REPLICATE_API_TOKEN=
REPLICATE_WHISPER_VERSION=vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c
REPLICATE_WHISPER_FALLBACK_VERSION=openai/whisper:91ee9c0c3df30478510ff8c8a3a545add1ad0259ad3a9f78fba57fbc05ee64f7
```

Both `npm run dev` and `npm start` automatically load these values from an ignored root-level `.env` file when it exists.

### Partner Credentials

Add credentials to `.env` as they are issued. Keep the default base URLs unless a partner gives you a different endpoint.

| Partner | Required value | Optional value |
| --- | --- | --- |
| Musixmatch | `MUSIXMATCH_API_KEY` | `MUSIXMATCH_API_BASE_URL` |
| JamBase | `JAMBASE_API_KEY` | `JAMBASE_API_BASE_URL` |
| Cyanite | `CYANITE_API_TOKEN` or `CYANITE_API_KEY` | `CYANITE_API_BASE_URL` |
| LALAL.AI | `LALAL_LICENSE_KEY` | `LALAL_API_BASE_URL` |
| ElevenLabs | `ELEVENLABS_API_KEY` | `ELEVENLABS_VOICE_ID` |
| Replicate ASR | `REPLICATE_API_TOKEN` | `REPLICATE_WHISPER_VERSION`, `REPLICATE_WHISPER_FALLBACK_VERSION` |
| External ASR | `ASR_API_URL` | `ASR_API_KEY` |

Restart the server after adding a key. The Dashboard partner strip and `/api/health` show whether each integration is using live or demo data. Songstats and n8n remain intentionally deferred and do not yet have active adapters.

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
