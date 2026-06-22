# Live-Set Lyric Auditor

Live-Set Lyric Auditor is a music-tech tool for documenting what artists actually sing live, not only what appears in the official studio lyrics.

Studio lyrics are usually treated as the final reference, but live performances often change the record: artists add callouts, skip lines, change words, repeat hooks, improvise outros, or perform lyrics with different timing and emotional emphasis. Those differences are valuable for fans, curators, archivists, lyric teams, and music platforms, but they are rarely captured in a structured way.

This project takes a live concert recording or transcript and compares it against the canonical studio lyrics. The system identifies where the live performance differs from the studio version, highlights changed or added lines, flags uncertain matches, and turns the result into a Live Variant Passport: a structured summary of the performance-specific lyric changes with confidence, timestamps, and impact notes.

The goal is not to replace human lyric curation. The goal is to give curators and music teams a better starting point when live audio, studio lyrics, and metadata do not perfectly match.

For Musicathon, the prototype brings together the partner tools around one clear workflow:

- Musixmatch provides the canonical lyric reference where available
- LALAL.AI helps isolate vocals from live audio
- JamBase helps anchor the performance to a real live event context
- Cyanite can provide mood and audio context
- ElevenLabs can generate a short narrated summary of the Live Variant Passport

The result is a practical tool for turning messy live performance data into something reviewable, searchable, and useful.

Runtime requirement: Node.js 20.6 or newer. The normal analysis path starts from an uploaded or recorded audio/video clip so the app can work with media the reviewer is authorized to process.

Real uploads do not silently substitute fixture transcripts, tracks, or canonical lyrics. If live transcription or identification cannot produce defensible evidence, the analysis fails with a corrective message instead of returning a false match.

Replit preview sharing is supported through Vite's allowed-host protection. The default dev allowlist includes `.replit.dev` and `.picard.replit.dev`; override it with `DEV_ALLOWED_HOSTS` if Replit assigns a different preview domain.

Version `0.9.0` makes the live-vs-studio comparison the center of the product: the Passport now stores full line comparisons, the Analysis view shows matched and changed lines before the review queue, and selected details expose studio context, live context, and word-level changes. It also includes live playback and transcript review, manual track correction and failed-match recovery, reviewer-added live moments, cached reference excerpts for permitted review display, mobile capture, hardened media processing, and automatic loading of the ignored local `.env` file.

## Real Clip Flow

1. Open the app and confirm the menu shows `Live-Set Lyric Auditor v0.11.30`, dark/light theme control, the focused Dashboard / Analysis navigation, and one reviewed export action.
2. Import an audio/video clip or use **Record live** on a phone to capture a rear-camera stage-performance video, then trim the selected analysis excerpt to 45 seconds or less.
3. Use Recall Rescue over HTTPS to speak or sing a remembered lyric fragment, or type the words when microphone capture is unavailable. Once a track is found, **Analyze recalled fragment** sends it into the same Analysis review queue as uploaded clips.
4. Run analysis and move into Analysis to watch the timeline isolate, profile the arrangement, transcribe, match, compare, and generate the Passport.
5. Start with **Live vs Studio Comparison** to see each live line beside its studio reference, including matched rows, changed rows, skipped studio lines, timing drift, and live-only moments.
6. Review timestamped candidates, select any row to inspect its reference diff, and manually add missed live moments such as crowd responses or ad-libs that ASR did not capture.
7. Inspect JamBase setlist/lineup evidence and Cyanite energy, BPM, mood, instrument, and arrangement context before export.
8. Generate the optional ElevenLabs narration and export the Passport JSON with current approve, reject, pending, and manual review decisions.

## API Surfaces

- **Musixmatch:** `track.search`, lazy `track.get` track links, ranked `track.lyrics.fingerprint.post` rescue with compatibility fallback, recording/common-track metadata, `track.richsync.get`, `track.subtitle.get`, and `track.lyrics.get`.
- **Audio ID:** optional Auto Match audio fingerprinting before ASR lyric rescue. Set `AUDIO_ID_PROVIDER=acrcloud` with ACRCloud credentials, or `AUDIO_ID_PROVIDER=custom` / `MUSIXMATCH_AUDIO_ID_API_URL` for a partner endpoint that accepts an uploaded clip and returns title, artist, and optional ISRC metadata.
- **LALAL.AI:** configured split support remains available for explicit fallback work, but normal analysis no longer launches hidden post-passport rescue.
- **Demucs:** Replicate-hosted Demucs uses the same `REPLICATE_API_TOKEN` as ASR and is no longer run as an automatic post-passport rescue step.
- **JamBase:** Bearer-authenticated event search against `api.data.jambase.com/v3`, mapping artist/venue IDs, lineup, tour/festival, and setlist evidence when supplied. City hints filter safely, and a selected date accepts matching shows in that calendar month so distant December dates remain discoverable. Event search is capped by `JAMBASE_TIMEOUT_MS` so live context cannot stall a run.
- **Cyanite:** GraphQL analysis against `api.cyanite.ai/graphql`; MP3 signed upload feeds energy, BPM, mood, instrument, valence/arousal, and arrangement metadata. Supported non-MP3 uploads are converted to a temporary MP3 before profiling. Cyanite asynchronously posts completion events to the integration webhook configured in your local `.env`; the app still fetches results from GraphQL. Profiling starts in parallel with transcription and is joined before Passport assembly.
- **ElevenLabs:** `POST /v1/text-to-speech/:voice_id` for narration and `POST /v1/speech-to-text` as the primary Scribe STT path when `ELEVENLABS_API_KEY` is configured, using `xi-api-key`.
- **ASR:** Replicate `incredibly-fast-whisper` is the fallback path when Scribe fails or is not configured, and is capped by `ASR_REPLICATE_TIMEOUT_MS` so fallback runs do not wait on slow cold starts. The official `openai/whisper` endpoint is opt-in through `ASR_SLOW_FALLBACK_ENABLED=true`; set `ASR_COMPARE_ALL_MODELS=true` only for high-quality/offline comparisons. A custom Whisper-style endpoint remains available through `ASR_API_URL` and is capped by `ASR_EXTERNAL_TIMEOUT_MS`. Segment confidence is kept conservative when the provider does not return real confidence values, and common low-confidence Whisper filler phrases are removed before alignment.
- **Browser media:** `MediaRecorder` captures a short personal rendition for Recall Rescue on HTTPS. Mobile file capture can invoke the rear camera for a short live-performance video without replacing normal clip import.

App endpoints include `POST /api/recall` for spoken/sung/typed lyric rescue and `POST /api/analyze` for uploaded, recorded, or recalled sources. Built-in fixtures remain for tests and explicitly labeled adapter fallback only; the visible app flow starts from user-provided media.

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
MUSIXMATCH_TIMEOUT_MS=12000
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
JAMBASE_TIMEOUT_MS=12000
CYANITE_API_TOKEN=
CYANITE_API_BASE_URL=https://api.cyanite.ai/graphql
CYANITE_WEBHOOK_URL=https://your-domain.com/cyanite-webhook
CYANITE_REQUEST_TIMEOUT_MS=12000
LALAL_LICENSE_KEY=
LALAL_API_BASE_URL=https://www.lalal.ai/api/v1
LALAL_POLL_INTERVAL_MS=3000
LALAL_POLL_TIMEOUT_MS=180000
LALAL_LEAD_BACK_ENABLED=true
LALAL_DEREVERB_ENABLED=true
LALAL_EXTRACTION_LEVEL=clear_cut
LALAL_ENCODER_FORMAT=mp3
LALAL_SPLITTER=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb
ELEVENLABS_STT_MODEL=scribe_v2
ELEVENLABS_STT_TIMEOUT_MS=60000
ASR_API_URL=
ASR_API_KEY=
REPLICATE_API_TOKEN=
REPLICATE_WHISPER_VERSION=vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c
REPLICATE_WHISPER_FALLBACK_VERSION=openai/whisper
ASR_COMPARE_ALL_MODELS=false
ASR_SLOW_FALLBACK_ENABLED=false
ASR_REPLICATE_TIMEOUT_MS=45000
ASR_EXTERNAL_TIMEOUT_MS=45000
REPLICATE_DEMUCS_REF=cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953
REPLICATE_DEMUCS_MODEL=htdemucs_ft
REPLICATE_DEMUCS_STEM=vocals
FFMPEG_LOCATION=
CYANITE_POLL_INTERVAL_MS=2500
CYANITE_POLL_TIMEOUT_MS=20000
```

Both `npm run dev` and `npm start` automatically load these values from an ignored root-level `.env` file when it exists.

### Partner Credentials

Add credentials to `.env` as they are issued. Keep the default base URLs unless a partner gives you a different endpoint.

| Partner | Required value | Optional value |
| --- | --- | --- |
| Musixmatch | `MUSIXMATCH_API_KEY` | `MUSIXMATCH_API_BASE_URL`, `MUSIXMATCH_TIMEOUT_MS` |
| Audio ID | `ACRCLOUD_HOST`, `ACRCLOUD_ACCESS_KEY`, `ACRCLOUD_ACCESS_SECRET` or `AUDIO_ID_API_URL` | `AUDIO_ID_PROVIDER`, `AUDIO_ID_API_KEY`, `AUDIO_ID_FILE_FIELD`, `MUSIXMATCH_AUDIO_ID_API_URL`, `MUSIXMATCH_AUDIO_ID_API_KEY` |
| JamBase | `JAMBASE_API_KEY` | `JAMBASE_API_BASE_URL`, `JAMBASE_TIMEOUT_MS` |
| Cyanite | `CYANITE_API_TOKEN` | `CYANITE_API_BASE_URL`, `CYANITE_WEBHOOK_URL`, `CYANITE_REQUEST_TIMEOUT_MS`, `CYANITE_POLL_INTERVAL_MS`, `CYANITE_POLL_TIMEOUT_MS` |
| LALAL.AI | `LALAL_LICENSE_KEY` | `LALAL_API_BASE_URL`, `LALAL_LEAD_BACK_ENABLED`, `LALAL_DEREVERB_ENABLED`, `LALAL_EXTRACTION_LEVEL`, `LALAL_ENCODER_FORMAT`, `LALAL_SPLITTER` |
| ElevenLabs | `ELEVENLABS_API_KEY` | `ELEVENLABS_VOICE_ID`, `ELEVENLABS_STT_MODEL`, `ELEVENLABS_STT_TIMEOUT_MS` |
| Replicate Demucs and ASR | `REPLICATE_API_TOKEN` | `REPLICATE_DEMUCS_REF`, `REPLICATE_DEMUCS_MODEL`, `REPLICATE_DEMUCS_STEM`, `REPLICATE_WHISPER_VERSION`, `REPLICATE_WHISPER_FALLBACK_VERSION` |
| External ASR | `ASR_API_URL` | `ASR_API_KEY`, `ASR_EXTERNAL_TIMEOUT_MS` |

Restart the server after adding a key. The Dashboard partner strip and `/api/health` show whether each integration is live, pending, or using a labeled fallback. Songstats and n8n remain intentionally deferred.

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
