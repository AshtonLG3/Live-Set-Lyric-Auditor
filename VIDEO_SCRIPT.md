# Live-Set Lyric Auditor — Submission Video Script (Musicathon 2026)

**Target length:** ~3:00 (hard cap 5:00 per contest rules).
**Format:** Screen recording of the live app + voiceover. Voiceover can be generated with ElevenLabs (partner) from the "VO" lines below.
**Goal:** Hit all four judging criteria on screen — Originality, Craft, Use of the Musixmatch Pro API, Impact (25% each).

> **Record in a live Musixmatch mode.** Put your contest `MUSIXMATCH_API_KEY` in `.env` and restart, so the runtime badge reads **"API mode"** (or "Mixed sources") and the lyric references on screen are genuinely from Musixmatch. Judges weight API usage at 25% — they should *see* it, not just hear it.

---

## Shot list at a glance

| # | Time | Screen | Purpose / Criterion |
|---|------|--------|---------------------|
| 1 | 0:00–0:12 | Title card + concert B-roll/photo | Hook |
| 2 | 0:12–0:32 | Dashboard (Clip Intake hero) | Problem + Originality |
| 3 | 0:32–1:05 | Recall Rescue → Musixmatch track match | **Musixmatch identity** |
| 4 | 1:05–1:35 | Run analysis → Analysis Timeline | Craft (pipeline) |
| 5 | 1:35–2:20 | **Live vs Studio Comparison + Diff View** | Centerpiece / Craft + API |
| 6 | 2:20–2:40 | JamBase + Cyanite context | Use of partner APIs |
| 7 | 2:40–2:55 | ElevenLabs narration + Export Passport | Craft + Impact |
| 8 | 2:55–3:05 | Closing card | Impact |

---

## Scene 1 — Hook (0:00–0:12)

**On screen:** Title card: "Live-Set Lyric Auditor" + one-liner "What did they *actually* sing live?" Optional: 2–3s of a (rights-cleared / your own) concert clip or a still.

**VO:** "Every lyrics database knows the studio version of a song. Almost none of them know what the artist actually sang on stage last night. Live-Set Lyric Auditor closes that gap."

**Caption:** `Musicathon 2026 · powered by Musixmatch Pro`

---

## Scene 2 — The problem + the product (0:12–0:32)

**On screen:** App open on the **Dashboard**. Slowly pan the top bar — show `Live-Set Lyric Auditor v0.11.6`, the **runtime badge** ("API mode"), Dashboard/Analysis nav, and **Export Passport**. Land on the **Clip Intake** hero ("Start a Live Variant Passport") showing the two intake modes.

**VO:** "Start with a short, noisy concert clip — uploaded, recorded on a phone, or even a lyric you half-remember. The app turns it into a timestamped *Live Variant Passport*: a line-by-line record of how the live performance differs from the studio canonical, with the evidence to back it up."

**Caption:** `Clip in → Live Variant Passport out`

---

## Scene 3 — Musixmatch identity (0:32–1:05)  ⭐ API moment

**On screen:** Open **Recall lyric fragment** (or the track search). Type/sing a remembered line. Show the **Musixmatch track candidates** appearing — point the cursor at the matched track's metadata: title, artist, and the identity chips (`track_id` / `commontrack_id` / ISRC), and the "has RichSync / subtitles / lyrics" indicators. Select the top candidate.

**VO:** "Identity comes straight from the Musixmatch Pro API. A `track.search` — or, when you only have a fragment, a lyrics *fingerprint* — resolves the exact recording: Musixmatch `track_id`, common-track ID, and ISRC. That precise identity is what makes every downstream comparison defensible."

**Caption (lower third):** `Musixmatch: track.search · track.lyrics.fingerprint.post · track_id / ISRC`

---

## Scene 4 — Run the analysis (1:05–1:35)

**On screen:** Continue into analysis. Land in the **Analysis** workspace. Show the **waveform** and the **processing timeline** stepping through: isolate vocals → profile arrangement → transcribe → match → compare. Let a couple of steps tick to "done."

**VO:** "Hit analyze. The pipeline isolates the vocal, transcribes the performance, and pulls the canonical word timing from Musixmatch RichSync — falling back to subtitles or plain lyrics when RichSync isn't available, and respecting rights restrictions when content can't be shown."

**Caption:** `RichSync word-timing → subtitle → lyrics fallback · rights-aware`

---

## Scene 5 — Live vs Studio, the centerpiece (1:35–2:20)  ⭐ Craft + API

**On screen:** Open **Live vs Studio Comparison**. Scroll the table: matched rows, **changed** rows, skipped studio lines, timing drift, live-only moments. **Click a changed row** to open the **Diff View** — show the studio line beside the live line and the word-level chips (removed / added / kept). Optionally add a manual live moment (a crowd response or ad-lib).

**VO:** "This is the heart of it. Each live line sits beside its studio reference. Green is what matched, and the word-level diff shows exactly what changed — a swapped lyric, an ad-lib, a dropped verse, a shout-out to the city. Reviewers can approve, reject, or add live-only moments the transcription missed."

**Caption:** `Word-level diff · approve / reject / add live moments`

---

## Scene 6 — Supporting evidence (2:20–2:40)

**On screen:** Show the **JamBase** event/setlist/lineup panel and the **Cyanite** arrangement panel (energy, BPM, mood, instruments).

**VO:** "Every Passport is backed by context: JamBase pins the actual event, venue, and setlist position, and Cyanite profiles the live arrangement's energy, tempo, and mood — so a change is tied to a real performance, not guesswork."

**Caption:** `JamBase event/setlist · Cyanite arrangement profile`

---

## Scene 7 — Narrate + export (2:40–2:55)

**On screen:** Click **Generate narration** (ElevenLabs) — optionally let a second of it play. Then click **Export Passport** and show the JSON download with review decisions.

**VO:** "An optional ElevenLabs narration summarizes the findings, and one click exports the full Passport — every variant, timestamp, confidence, and review decision — as portable JSON."

**Caption:** `ElevenLabs narration · one-click Passport export (JSON)`

---

## Scene 8 — Close / impact (2:55–3:05)

**On screen:** Return to a clean Dashboard or a closing card with the one-liner + repo/demo URL.

**VO:** "Studio databases capture the canonical lyric. Live-Set Lyric Auditor captures what fans actually heard — feeding better captions, archives, artist-team QA, and a richer Musixmatch catalog. That's the Live Variant Passport."

**Caption:** `github.com/<your-repo> · built on Musixmatch Pro`

---

## Musixmatch API callout sheet (keep visible / mention by name)

- `track.search` — catalog identity from artist + title
- `track.lyrics.fingerprint.post` — identify a track from a remembered/sung fragment
- `track.richsync.get` — word-level canonical timing (primary)
- `track.subtitle.get` — line timing fallback (LRC)
- `track.lyrics.get` — plain lyrics + **rights/restriction** status
- Identity fields surfaced: `track_id`, `commontrack_id`, ISRC

## Compliance reminders (so the video doesn't violate the rules)

- Use a clip you're **authorized** to process (your own recording, a rights-cleared sample, or the built-in demo). Don't show downloaded copyrighted concert audio.
- Musixmatch lyric content is shown as an **in-memory comparison reference only** — the app doesn't bulk-store or redistribute it. Worth a one-line mention if you have room.

## Recording & production checklist (Windows 11)

1. `npm run dev` → open `http://127.0.0.1:4242`. Set browser zoom so the layout is clean at 1080p; pick **dark theme** (looks sharper on video).
2. Record at **1920×1080** with **Xbox Game Bar** (`Win+G`) or **OBS Studio** (free). Capture just the browser window/region.
3. Do a silent screen pass following the shot list, then generate the **voiceover from the VO lines via ElevenLabs** (Creator tier is free for participants) and lay it over the footage.
4. Edit/stitch in **Clipchamp** (built into Win11) or **CapCut**: add the title card (Scene 1) and closing card (Scene 8). Keep total under 5:00.
5. Export 1080p MP4 → upload to **YouTube as Unlisted** → paste the link into the Hub submission. Use a captured still as the **cover image**.
