# Live-Set Lyric Auditor

**One-liner:** Turn a short noisy concert clip into a timestamped Live Variant Passport for lyric QA, captions, archives, artist teams, and fan experiences.

Live-Set Lyric Auditor is a Musicathon 2026 contest MVP. Musixmatch Pro is the identity, timing, and rights truth layer; optional audio fingerprinting can identify the recording before lyric rescue, Replicate Demucs isolates vocals, JamBase anchors the event and setlist context, Cyanite profiles the live arrangement, a Whisper-style ASR adapter transcribes the performance, and ElevenLabs provides optional narration polish. The dashboard has resilient demo data so judges can run the full flow even when API keys are unavailable.

Runtime requirement: Node.js 20.6 or newer. The normal analysis path starts from an uploaded or recorded audio/video clip so the app can work with media the reviewer is authorized to process.

Real uploads do not silently substitute demo transcripts, tracks, or canonical lyrics. If live transcription or identification cannot produce defensible evidence, the analysis fails with a corrective message instead of returning a false match.

Replit preview sharing is supported through Vite's allowed-host protection. The default dev allowlist includes `.replit.dev` and `.picard.replit.dev`; override it with `DEV_ALLOWED_HOSTS` if Replit assigns a different preview domain.

Version `0.9.0` makes the live-vs-studio comparison the center of the product: the Passport now stores full line comparisons, the Analysis view shows matched and changed lines before the review queue, and selected details expose studio context, live context, and word-level changes. It also includes live playback and transcript review, manual track correction and failed-match recovery, reviewer-added live moments, cached reference excerpts for permitted review display, mobile capture, hardened media processing, and automatic loading of the ignored local `.env` file.

## Demo Flow

1. Open the app and confirm the menu shows `Live-Set Lyric Auditor v0.11.13`, dark/light theme control, the focused Dashboard / Analysis navigation, and one reviewed export action.
2. Import an audio/video clip or use **Record live** on a phone to capture a short rear-camera stage-performance video.
3. Use Recall Rescue over HTTPS to speak or sing a remembered lyric fragment, or type the words when microphone capture is unavailable. Once a track is found, **Analyze recalled fragment** sends it into the same Analysis review queue as uploaded clips.
4. Run analysis and move into Analysis to watch the timeline isolate, profile the arrangement, transcribe, match, compare, and generate the Passport.
5. Start with **Live vs Studio Comparison** to see each live line beside its studio reference, including matched rows, changed rows, skipped studio lines, timing drift, and live-only moments.
6. Review timestamped candidates, select any row to inspect its reference diff, and manually add missed live moments such as crowd responses or ad-libs that ASR did not capture.
7. Inspect JamBase setlist/lineup evidence and Cyanite energy, BPM, mood, instrument, and arrangement context before export.
8. Generate the optional ElevenLabs narration and export the Passport JSON with current approve, reject, pending, and manual review decisions.

## API Surfaces

- **Musixmatch:** `track.search`, ranked `track.lyrics.fingerprint.post` rescue with compatibility fallback, recording/common-track metadata, `track.richsync.get`, `track.subtitle.get`, and `track.lyrics.get`.
- **Audio ID:** optional Auto Match grace route before ASR lyric rescue. Set `AUDIO_ID_PROVIDER=acrcloud` with ACRCloud credentials, or `AUDIO_ID_PROVIDER=custom` / `MUSIXMATCH_AUDIO_ID_API_URL` for a partner endpoint that accepts an uploaded clip and returns title, artist, and optional ISRC metadata.
- **Demucs:** Replicate-hosted Demucs uses the same `REPLICATE_API_TOKEN` as ASR and returns a vocal stem URL for transcription. The original-audio ASR fallback remains active when stem quality or anchoring is weak.
- **JamBase:** Bearer-authenticated event search against `api.data.jambase.com/v3`, mapping artist/venue IDs, lineup, tour/festival, and setlist evidence when supplied.
- **Cyanite:** GraphQL analysis against `api.cyanite.ai/graphql`; MP3 signed upload feeds energy, BPM, mood, instrument, valence/arousal, and arrangement metadata. Supported non-MP3 uploads are converted to a temporary MP3 before profiling. Cyanite asynchronously posts completion events to the integration webhook configured in your local `.env`; the app still fetches results from GraphQL.
- **ElevenLabs:** `POST /v1/text-to-speech/:voice_id` using `xi-api-key`.
- **ASR:** Replicate `incredibly-fast-whisper` and the pinned `openai/whisper` version are both scored for transcript quality when configured; the cleaner candidate wins instead of the first response. A custom Whisper-style endpoint remains available through `ASR_API_URL`. When Demucs succeeds, the separated vocal stem is compared against original-audio ASR, and repeated/low-variety stem transcripts fall back to the raw audio path. Common low-confidence Whisper filler phrases are removed before alignment.
- **Browser media:** `MediaRecorder` captures a short personal rendition for Recall Rescue on HTTPS. Mobile file capture can invoke the rear camera for a short live-performance video without replacing normal clip import.

App endpoints include `POST /api/recall` for spoken/sung/typed lyric rescue and `POST /api/analyze` for uploaded, recorded, or recalled sources.

## Compliance Notes

- Musixmatch lyric/subtitle content is used as an in-memory comparison reference only.
- The app does not bulk-download, redistribute, or persist full Musixmatch lyric content.
- Passports store review metadata: variant type, timestamp, confidence, impact note, short live snippets, reviewer-added moments, and short cached reference excerpts where display is permitted.
- Uploaded audio is held in memory for this MVP and is not written to persistent storage.
- Hosted provider streams are not downloaded by the normal app flow; reviewers import media they are authorized to process.
- Restricted lyrics switch the passport to metadata-only mode; permitted references can display short cached excerpts for reviewer comparison.

## Product Focus

The contest build deliberately prioritizes Musixmatch-native value:

- exact `track_id` / `commontrack_id` / ISRC identity
- RichSync-first word timing with subtitle/plain-lyric fallback
- version confidence and sync-fit scoring
- rights and restriction status
- performance structure changes and recommended QA actions
- vocal-derived lyrics rescue when the user does not know the track
- provider-aware live links with start/end evidence ranges
- Recall Rescue from a personal spoken or sung lyric fragment, with direct Analysis continuation after a track match
- JamBase event, lineup, canonical artist/venue ID, and setlist-position context
- Cyanite performance energy, BPM, emotion, instrument, and arrangement context
- a desktop QA workbench and compact mobile review flow for decisions in the field

Songstats and n8n remain deferred because they do not strengthen the core evidence pipeline yet. Lyrics translations remain deferred; lyric fingerprint matching is enabled with a catalog-search fallback when the account plan does not expose that endpoint. Audio fingerprinting is optional and must be backed by a configured provider rather than a guessed mobile-only Musixmatch endpoint.

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
DEV_ALLOWED_HOSTS=.replit.dev,.picard.replit.dev
MUSIXMATCH_API_KEY=
AUDIO_ID_PROVIDER=
AUDIO_ID_FILE_FIELD=clip
AUDIO_ID_TIMEOUT_MS=12000
ACRCLOUD_HOST=
ACRCLOUD_ACCESS_KEY=
ACRCLOUD_ACCESS_SECRET=
AUDIO_ID_API_URL=
AUDIO_ID_API_KEY=
MUSIXMATCH_AUDIO_ID_API_URL=
MUSIXMATCH_AUDIO_ID_API_KEY=
JAMBASE_API_KEY=
JAMBASE_API_BASE_URL=https://api.data.jambase.com/v3
CYANITE_API_TOKEN=
CYANITE_API_BASE_URL=https://api.cyanite.ai/graphql
CYANITE_WEBHOOK_URL=https://your-domain.com/cyanite-webhook
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ASR_API_URL=
ASR_API_KEY=
REPLICATE_API_TOKEN=
REPLICATE_WHISPER_VERSION=vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c
REPLICATE_WHISPER_FALLBACK_VERSION=openai/whisper:91ee9c0c3df30478510ff8c8a3a545add1ad0259ad3a9f78fba57fbc05ee64f7
REPLICATE_DEMUCS_REF=cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953
REPLICATE_DEMUCS_MODEL=htdemucs_ft
REPLICATE_DEMUCS_STEM=vocals
FFMPEG_LOCATION=
CYANITE_POLL_INTERVAL_MS=2500
CYANITE_POLL_TIMEOUT_MS=180000
```

Both `npm run dev` and `npm start` automatically load these values from an ignored root-level `.env` file when it exists.

### Partner Credentials

Add credentials to `.env` as they are issued. Keep the default base URLs unless a partner gives you a different endpoint.

| Partner | Required value | Optional value |
| --- | --- | --- |
| Musixmatch | `MUSIXMATCH_API_KEY` | `MUSIXMATCH_API_BASE_URL` |
| Audio ID | `ACRCLOUD_HOST`, `ACRCLOUD_ACCESS_KEY`, `ACRCLOUD_ACCESS_SECRET` or `AUDIO_ID_API_URL` | `AUDIO_ID_PROVIDER`, `AUDIO_ID_API_KEY`, `AUDIO_ID_FILE_FIELD`, `MUSIXMATCH_AUDIO_ID_API_URL`, `MUSIXMATCH_AUDIO_ID_API_KEY` |
| JamBase | `JAMBASE_API_KEY` | `JAMBASE_API_BASE_URL` |
| Cyanite | `CYANITE_API_TOKEN` | `CYANITE_API_BASE_URL`, `CYANITE_WEBHOOK_URL` |
| ElevenLabs | `ELEVENLABS_API_KEY` | `ELEVENLABS_VOICE_ID` |
| Replicate Demucs and ASR | `REPLICATE_API_TOKEN` | `REPLICATE_DEMUCS_REF`, `REPLICATE_DEMUCS_MODEL`, `REPLICATE_DEMUCS_STEM`, `REPLICATE_WHISPER_VERSION`, `REPLICATE_WHISPER_FALLBACK_VERSION` |
| External ASR | `ASR_API_URL` | `ASR_API_KEY` |

Restart the server after adding a key. The Dashboard partner strip and `/api/health` show whether each integration is using live or demo data. Songstats and n8n remain intentionally deferred.

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
