import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
import { inspectClip } from "./clip";
import type { AnalysisJob, HealthResponse } from "../shared/types";

vi.mock("./clip", async () => {
  const actual = await vi.importActual<typeof import("./clip")>("./clip");
  return {
    ...actual,
    inspectClip: vi.fn(async (file: File) => ({
      file,
      durationSeconds: 24,
      kind: file.type.startsWith("video/") ? "video" as const : "audio" as const
    }))
  };
});

const health: HealthResponse = {
  appName: "Live-Set Lyric Auditor",
  version: "0.11.27",
  runtimeMode: "fixture",
  integrations: [
    { name: "Musixmatch", configured: false, mode: "fixture", detail: "fixture" },
    { name: "Audio ID", configured: false, mode: "fixture", detail: "fixture" },
    { name: "LALAL.AI", configured: false, mode: "fixture", detail: "fixture" },
    { name: "Demucs", configured: false, mode: "fixture", detail: "fixture" },
    { name: "JamBase", configured: false, mode: "fixture", detail: "fixture" },
    { name: "Cyanite", configured: false, mode: "fixture", detail: "fixture" },
    { name: "ElevenLabs", configured: false, mode: "fixture", detail: "fixture" },
    { name: "ASR", configured: false, mode: "fixture", detail: "fixture" }
  ]
};

const completeJob: AnalysisJob = {
  id: "job-1",
  status: "complete",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  progress: [
    { id: "anchor", label: "Anchor track and event", status: "complete" },
    { id: "isolate", label: "Isolate live vocal", status: "complete" },
    { id: "profile", label: "Profile live arrangement", status: "complete" },
    { id: "transcribe", label: "Transcribe vocal", status: "complete" },
    { id: "compare", label: "Align to canonical reference", status: "complete" },
    { id: "passport", label: "Generate Live Variant Passport", status: "complete" }
  ],
    passport: {
    id: "job-1",
    createdAt: new Date().toISOString(),
    version: "0.11.27",
    track: {
      id: "fixture-track-midnight-atlas",
      title: "Midnight Atlas",
      artist: "The Signal Keeps",
      hasLyrics: true,
      hasSubtitles: true,
      source: "fixture"
    },
    event: {
      id: "fixture-event-cape-town-2026",
      title: "The Signal Keeps at Civic Hall",
      artist: "The Signal Keeps",
      artistId: "fixture-artist-signal-keeps",
      venue: "Civic Hall",
      venueId: "fixture-venue-civic-hall",
      city: "Cape Town",
      date: "2026-06-18T20:00:00+02:00",
      tourName: "City Voltage Tour",
      lineup: ["The Signal Keeps", "Northline Echo"],
      setlist: { available: true, songs: ["Signal Fire", "Midnight Atlas", "Afterimage"] },
      source: "fixture"
    },
    clip: {
      filename: "seed.mp3",
      durationSeconds: 24,
      vocalIsolationSource: "fixture",
      vocalIsolationConfidence: 0.74,
      asrSource: "fixture",
      transcript: [
        { id: "T1", start: 0, end: 4, text: "The night opens slowly under electric skies", confidence: 0.93 },
        { id: "T2", start: 4, end: 8, text: "Cape Town carry this chorus", confidence: 0.84 }
      ],
      source: { kind: "upload", processingMode: "uploaded_media" }
    },
    summary: "Detected 3 live variant candidates.",
    liveContext: {
      source: "fixture",
      eventId: "fixture-event-cape-town-2026",
      artistId: "fixture-artist-signal-keeps",
      venueId: "fixture-venue-civic-hall",
      tourName: "City Voltage Tour",
      lineup: ["The Signal Keeps", "Northline Echo"],
      setlist: { available: true, position: 2, songCount: 3, previousSong: "Signal Fire", nextSong: "Afterimage" },
      summary: "City Voltage Tour. Midnight Atlas appears at position 2 of 3 in the available setlist.",
      confidence: 0.9
    },
    performanceContext: {
      source: "fixture",
      status: "fallback",
      energyLevel: 0.86,
      bpm: 128,
      dominantEmotions: ["Energetic", "Uplifting", "Powerful"],
      instruments: ["Electric Guitar", "Synthesizer", "Drums"],
      valence: 0.58,
      arousal: 0.9,
      arrangement: "high_intensity",
      summary: "High-intensity full-band performance with an energetic, crowd-facing arrangement.",
      confidence: 0.82
    },
    recordingIdentity: {
      trackId: "fixture-track-midnight-atlas",
      commonTrackId: "fixture-common-midnight-atlas",
      isrc: "FIK202600001",
      matchMethod: "fixture_rescue",
      versionConfidence: 0.91,
      syncFitScore: 0.84,
      canonicalSource: "fixture"
    },
    rights: {
      status: "fixture",
      language: "en",
      attribution: "Lyrics powered by Musixmatch",
      trackingRequired: false
    },
    structureMap: {
      canonical: ["Opening", "Verse", "Hook"],
      live: ["Live opening", "City shoutout", "Live close"]
    },
    confidenceOverview: { overall: 0.81, asr: 0.88, alignment: 0.72, sourceCoverage: 0.74 },
    lineComparisons: [
      {
        id: "C1",
        start: 0,
        end: 4,
        canonicalId: "L1",
        canonicalText: "The night opens slowly under electric skies",
        canonicalNextText: "Carry this chorus through the avenue",
        liveText: "The night opens slowly under electric skies",
        similarity: 1,
        timingDelta: 0,
        status: "matched",
        changedWords: {
          kept: ["the", "night", "opens", "slowly", "under", "electric", "skies"],
          removed: [],
          added: []
        }
      },
      {
        id: "C2",
        start: 4,
        end: 8,
        canonicalId: "L2",
        canonicalText: "Carry this chorus through the avenue",
        canonicalPreviousText: "The night opens slowly under electric skies",
        liveText: "Cape Town carry this chorus",
        similarity: 0.57,
        timingDelta: 0,
        status: "changed",
        changedWords: {
          kept: ["carry", "this", "chorus"],
          removed: ["through", "the", "avenue"],
          added: ["cape", "town"]
        },
        variantId: "V1"
      }
    ],
    variants: [
      {
        id: "V1",
        type: "city_shoutout",
        start: 4,
        end: 8,
        liveText: "Cape Town carry this chorus",
        canonicalAlignmentReference: "L2",
        canonicalExcerpt: "Carry this chorus through the avenue",
        confidence: 0.84,
        impactNote: "Reviewable",
        recommendedAction: "Attach event-specific metadata.",
        translationRisk: "medium",
        severity: "high",
        evidenceSource: "asr_alignment"
      }
    ],
    complianceNotes: ["Derived metadata only."]
  }
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(inspectClip).mockReset();
  vi.mocked(inspectClip).mockImplementation(async (file: File) => ({
    file,
    durationSeconds: 24,
    kind: file.type.startsWith("video/") ? "video" as const : "audio" as const
  }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/health") {
      return jsonResponse(health);
    }
    if (url.toString().startsWith("/api/music/search")) {
      return jsonResponse({
        tracks: [
          {
            id: "fixture-track-midnight-atlas",
            title: "Midnight Atlas",
            artist: "The Signal Keeps",
            album: "City Voltage",
            hasLyrics: true,
            hasSubtitles: true,
            source: "fixture"
          }
        ]
      });
    }
    if (url.toString().startsWith("/api/events/search")) {
      return jsonResponse({ events: [] });
    }
    if (url === "/api/analyze") {
      return jsonResponse({ jobId: "job-1" }, 202);
    }
    if (url === "/api/recall") {
      return jsonResponse({
        transcript: "we carry the chorus through the avenue",
        segments: [{ id: "R1", start: 0, end: 4, text: "we carry the chorus through the avenue", confidence: 0.9 }],
        candidates: [
          {
            id: "fixture-track-midnight-atlas",
            title: "Midnight Atlas",
            artist: "The Signal Keeps",
            album: "City Voltage",
            hasLyrics: true,
            hasSubtitles: true,
            source: "fixture"
          }
        ],
        mode: "typed_lyrics_search"
      });
    }
    if (url === "/api/analyze/job-1") {
      return jsonResponse(completeJob);
    }
    if (url === "/api/analyze/job-1/reanchor") {
      return jsonResponse({
        ...completeJob,
        passport: {
          ...completeJob.passport,
          track: {
            id: "manual-correct-song-correct-artist",
            title: "Correct Song",
            artist: "Correct Artist",
            hasLyrics: false,
            hasSubtitles: false,
            source: "manual"
          }
        }
      });
    }
    if (url === "/api/narrate/job-1") {
      return jsonResponse({ jobId: "job-1", mode: "fixture", text: "Narration script" });
    }
    return jsonResponse({});
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function runUploadedClip(fileName = "concert-snippet.mp3") {
  const file = new File(["audio"], fileName, { type: "audio/mpeg" });
  fireEvent.drop(screen.getByTestId("clip-dropzone"), { dataTransfer: { files: [file] } });
  expect(await screen.findByText(fileName)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Analyze clip/i }));
}

it("shows the app version and theme toggle", async () => {
  render(<App />);
  expect((await screen.findAllByText(/v0.11.27/)).length).toBeGreaterThan(0);
  expect(screen.getByText("Setup needed")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /New Session/i })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Tracks" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reports" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Clip Intake" })).toHaveAttribute("aria-current", "location");
  expect(screen.getByRole("button", { name: "Track Anchor" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Event Anchor" })).toBeInTheDocument();
  expect(screen.queryByText("Help")).not.toBeInTheDocument();
  expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/switch to light theme/i));
  expect(localStorage.getItem("lal-theme")).toBe("light");
});

it("keeps intake focused on uploaded clips and recall", async () => {
  render(<App />);
  expect(await screen.findByRole("button", { name: "Upload clip" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Recall lyric fragment" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /judge-ready demo|seeded demo/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Live link" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Live performance URL")).not.toBeInTheDocument();
});

it("shows selected-track anchor controls directly in clip intake", async () => {
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Selected track" }));

  const anchor = screen.getByLabelText("Selected track anchor");
  expect(within(anchor).getByText("Required")).toBeInTheDocument();
  expect(within(anchor).getByLabelText("Selected track search")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Choose track to analyze/i })).toBeDisabled();

  fireEvent.change(within(anchor).getByLabelText("Selected track search"), { target: { value: "Midnight Atlas" } });
  fireEvent.click(within(anchor).getByRole("button", { name: "Search selected track" }));

  await waitFor(() => expect(within(anchor).getByText("Midnight Atlas")).toBeInTheDocument());
  expect(within(anchor).getByText(/The Signal Keeps/i)).toBeInTheDocument();
});

it("shows JamBase event suggestions for a selected track without requiring city or date", async () => {
  const baseFetch = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.toString().startsWith("/api/music/search")) {
      return jsonResponse({
        tracks: [{
          id: "mxm-limp-bizkit-break-stuff",
          title: "Break Stuff",
          artist: "Limp Bizkit",
          album: "Significant Other",
          hasLyrics: true,
          hasSubtitles: true,
          source: "musixmatch"
        }]
      });
    }
    if (url.toString().startsWith("/api/events/search")) {
      return jsonResponse({
        events: [{
          id: "jambase-limp-berlin",
          title: "Limp Bizkit at Parkbuhne Wuhlheide",
          artist: "Limp Bizkit",
          venue: "Parkbuhne Wuhlheide",
          city: "Berlin",
          date: "2026-06-24T18:15:00",
          lineup: ["Limp Bizkit"],
          setlist: { available: false },
          url: "https://www.jambase.com/show/limp-bizkit-parkbuhne-wuhlheide-20260624",
          source: "jambase"
        }]
      });
    }
    return baseFetch(url, init);
  }));
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Selected track" }));
  const anchor = screen.getByLabelText("Selected track anchor");
  fireEvent.change(within(anchor).getByLabelText("Selected track search"), { target: { value: "Limp Bizkit" } });
  fireEvent.click(within(anchor).getByRole("button", { name: "Search selected track" }));

  await waitFor(() => expect(within(anchor).getByText("Break Stuff")).toBeInTheDocument());
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url.toString().startsWith("/api/events/search"))).toBe(true));
  expect(await screen.findByText("Limp Bizkit at Parkbuhne Wuhlheide", undefined, { timeout: 7000 })).toBeInTheDocument();
  expect(screen.getByText(/Parkbuhne Wuhlheide · Berlin/i)).toBeInTheDocument();
});

it("uses remembered words to rescue a track", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Recall lyric fragment" }));
  fireEvent.change(screen.getByLabelText("Remembered lyric words"), {
    target: { value: "we carry the chorus through the avenue" }
  });
  fireEvent.click(screen.getByRole("button", { name: /Find the track/i }));
  expect(await screen.findByText(/Recognized fragment/i)).toBeInTheDocument();
  const matches = screen.getAllByRole("button", { name: /Midnight Atlas/i });
  fireEvent.click(matches[0]);
  expect(screen.getByRole("button", { name: /Upload performance clip/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Use live link/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Analyze recalled fragment as Midnight Atlas/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Analyze recalled fragment as Midnight Atlas/i }));
  await waitFor(() => expect(screen.getByText("Passport Preview / Diff View")).toBeInTheDocument());
}, 60000);

it("explains that mobile microphone capture needs HTTPS on an insecure origin", async () => {
  vi.stubGlobal("isSecureContext", false);
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Recall lyric fragment" }));

  expect(screen.getByText(/Microphone capture needs HTTPS on mobile/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Record remembered lyric" })).toBeDisabled();
  expect(screen.getByText(/Camera capture remains available under Upload clip/i)).toBeInTheDocument();
});

it("imports a clip through drag and drop", async () => {
  render(<App />);
  const file = new File(["audio"], "concert-snippet.mp3", { type: "audio/mpeg" });
  fireEvent.drop(screen.getByTestId("clip-dropzone"), { dataTransfer: { files: [file] } });
  expect(await screen.findByText("concert-snippet.mp3")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Analyze clip/i })).toBeEnabled();
});

it("offers rear-camera capture and imports the recorded video", async () => {
  render(<App />);
  const cameraInput = screen.getByLabelText("Record a live performance video");
  expect(cameraInput).toHaveAttribute("accept", "video/*");
  expect(cameraInput).toHaveAttribute("capture", "environment");

  const file = new File(["video"], "live-stage.mp4", { type: "video/mp4" });
  fireEvent.change(cameraInput, { target: { files: [file] } });

  expect(await screen.findByText("live-stage.mp4")).toBeInTheDocument();
  expect(screen.getByText(/video ·/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Record another/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Analyze clip/i })).toBeEnabled();
});

it("runs an uploaded clip and renders a passport", async () => {
  render(<App />);
  await runUploadedClip();
  await waitFor(() => expect(screen.getAllByText("Midnight Atlas").length).toBeGreaterThan(0));
  expect(screen.getByText("Passport Preview / Diff View")).toBeInTheDocument();
  const diffViewLink = screen.getByRole("button", { name: "Diff View" });
  fireEvent.click(diffViewLink);
  expect(diffViewLink).toHaveAttribute("aria-current", "location");
  expect(screen.getByRole("button", { name: "Timeline" })).not.toHaveAttribute("aria-current");
  expect(screen.getByText(/Detected 3 live variant candidates/i)).toBeInTheDocument();
  expect(screen.getAllByText("Live Context").length).toBeGreaterThan(0);
  expect(screen.getByText("Performance Context")).toBeInTheDocument();
  expect(screen.getByText("2 of 3")).toBeInTheDocument();
  expect(screen.getAllByText("86%").length).toBeGreaterThan(0);
  expect(screen.getAllByRole("button", { name: /Export Passport/i })).toHaveLength(1);
  expect(screen.getByRole("button", { name: /Play analyzed clip/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Rewind 5 seconds/i })).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: /Seek analyzed clip/i })).toBeInTheDocument();
  expect(screen.getByText("Transcription Review")).toBeInTheDocument();
  const transcriptPanel = screen.getByRole("region", { name: /Transcription Review/i });
  expect(within(transcriptPanel).getByRole("button", { name: /The night opens slowly under electric skies/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Correct match/i }));
  fireEvent.change(screen.getByLabelText("Correct track title"), { target: { value: "Correct Song" } });
  fireEvent.change(screen.getByLabelText("Correct track artist"), { target: { value: "Correct Artist" } });
  fireEvent.click(screen.getByRole("button", { name: /Use manual labels/i }));
  await waitFor(() => expect(screen.getAllByText("Correct Song").length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByRole("button", { name: "Approve variant" })[0]);
  expect(screen.getByText(/1 approved, 0 rejected, and 0 pending/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Generate narration/i));
  await waitFor(() => expect(screen.getByText("Narration script")).toBeInTheDocument());
}, 60000);

it("offers Whisper fallback when the current transcript came from ElevenLabs Scribe", async () => {
  const baseFetch = fetch;
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/analyze/job-1") {
      return jsonResponse({
        ...completeJob,
        passport: {
          ...completeJob.passport!,
          clip: {
            ...completeJob.passport!.clip,
            asrSource: "external",
            asrEngine: "elevenlabs/scribe_v2"
          }
        }
      });
    }
    if (url === "/api/analyze/job-1/retranscribe") {
      return jsonResponse({
        ...completeJob,
        passport: {
          ...completeJob.passport!,
          clip: {
            ...completeJob.passport!.clip,
            asrSource: "replicate",
            asrEngine: "vaibhavs10/incredibly-fast-whisper:test"
          }
        }
      });
    }
    return baseFetch(url, init);
  }));

  render(<App />);
  await runUploadedClip();

  expect(await screen.findByText(/ElevenLabs Scribe · 89% avg/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Whisper fallback/i }));

  expect(vi.mocked(confirm)).toHaveBeenCalledWith(expect.stringContaining("Run Whisper fallback"));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/analyze/job-1/retranscribe")).toBe(true));
  expect((await screen.findAllByText(/Fast Whisper/i)).length).toBeGreaterThan(0);
}, 40000);

it("can force Whisper fallback while transcription is stuck running", async () => {
  const baseFetch = fetch;
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/analyze/job-1") {
      return jsonResponse({
        ...completeJob,
        status: "running",
        passport: undefined,
        progress: completeJob.progress.map((step) =>
          step.id === "transcribe"
            ? { ...step, status: "running", detail: "ElevenLabs Scribe is still processing." }
            : step.id === "anchor" || step.id === "compare" || step.id === "passport"
              ? { ...step, status: "queued", detail: undefined }
              : { ...step, status: "complete" }
        ),
        recovery: {
          filename: "stage-clip.mp3",
          durationSeconds: 18,
          vocalIsolationSource: "original",
          vocalIsolationConfidence: 0.58,
          vocalQuality: completeJob.passport!.clip.vocalQuality,
          asrSource: "external",
          asrEngine: "elevenlabs/scribe_v2",
          transcript: [],
          source: { kind: "upload", processingMode: "uploaded_media" },
          performanceContext: completeJob.passport!.performanceContext,
          event: null
        }
      });
    }
    if (url === "/api/analyze/job-1/retranscribe") {
      return jsonResponse({
        ...completeJob,
        passport: {
          ...completeJob.passport!,
          clip: {
            ...completeJob.passport!.clip,
            asrSource: "replicate",
            asrEngine: "vaibhavs10/incredibly-fast-whisper:test"
          }
        }
      });
    }
    return baseFetch(url, init);
  }));

  render(<App />);
  await runUploadedClip();

  expect(await screen.findByText(/Transcription is still running/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Force Whisper fallback/i }));

  expect(vi.mocked(confirm)).toHaveBeenCalledWith(expect.stringContaining("Force Whisper fallback"));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/analyze/job-1/retranscribe")).toBe(true));
  expect((await screen.findAllByText(/Fast Whisper/i)).length).toBeGreaterThan(0);
}, 40000);

it("surfaces the Musixmatch identity chain including ISRC and version confidence", async () => {
  render(<App />);
  await runUploadedClip();
  await waitFor(() => expect(screen.getAllByText("Midnight Atlas").length).toBeGreaterThan(0));

  expect(screen.getByText(/Musixmatch Identity/i)).toBeInTheDocument();
  expect(screen.getAllByText("FIK202600001").length).toBeGreaterThan(0);
  expect(screen.getByText(/91% version confidence/i)).toBeInTheDocument();
}, 60000);

it("flags fixture passports so fallback data is never mistaken for a live run", async () => {
  render(<App />);
  await runUploadedClip();
  await waitFor(() => expect(screen.getAllByText("Midnight Atlas").length).toBeGreaterThan(0));

  expect(screen.getByText(/Fixture fallback data/i)).toBeInTheDocument();
}, 60000);

it("labels timeline steps as process status instead of quality scores", async () => {
  render(<App />);
  await runUploadedClip();
  await waitFor(() => expect(screen.getByText("Passport Preview / Diff View")).toBeInTheDocument());

  const timeline = document.querySelector("#analysis-timeline") as HTMLElement;
  expect(timeline).toBeTruthy();
  expect(within(timeline).getAllByText("Done").length).toBeGreaterThan(0);
  expect(within(timeline).queryByText("100%")).not.toBeInTheDocument();
});

it("imports a longer clip and sends the selected trim range for analysis", async () => {
  const file = new File(["video"], "full-song.mp4", { type: "video/mp4" });
  vi.mocked(inspectClip).mockResolvedValueOnce({
    file,
    durationSeconds: 96,
    kind: "video"
  });
  render(<App />);

  fireEvent.drop(screen.getByTestId("clip-dropzone"), { dataTransfer: { files: [file] } });

  expect(await screen.findByText("full-song.mp4")).toBeInTheDocument();
  expect(screen.getByLabelText("Clip trim range")).toBeInTheDocument();
  expect(screen.getByText("0:00 - 0:45 · 45.0s")).toBeInTheDocument();

  fireEvent.change(screen.getByRole("slider", { name: "Clip trim end" }), { target: { value: "70" } });
  expect(screen.getByText("0:25 - 1:10 · 45.0s")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Analyze clip/i }));
  await waitFor(() => {
    const analyzeCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === "/api/analyze");
    expect(analyzeCall).toBeTruthy();
    const body = analyzeCall?.[1]?.body as FormData;
    expect(body.get("durationSeconds")).toBe("45");
    expect(JSON.parse(String(body.get("source")))).toMatchObject({
      kind: "upload",
      processingMode: "uploaded_media",
      startSeconds: 25,
      endSeconds: 70
    });
  });
});

it("adds a missed live moment via the inline insert button", async () => {
  render(<App />);
  await runUploadedClip();
  await waitFor(() => expect(screen.getByText("Passport Preview / Diff View")).toBeInTheDocument());

  const insertButtons = await screen.findAllByRole("button", { name: /Add missed moment/i });
  fireEvent.click(insertButtons[0]);
  fireEvent.change(screen.getByLabelText("Manual live content"), { target: { value: "fan shouts: better!" } });
  fireEvent.change(screen.getByLabelText("Reference excerpt or anchor"), { target: { value: "near: How you broke my heart" } });
  fireEvent.click(screen.getByRole("button", { name: /Add live moment/i }));

  await waitFor(() => {
    const lyricRows = document.querySelectorAll(".studio-lyric-row");
    const texts = [...lyricRows].map((row) => row.textContent ?? "");
    expect(texts.some((text) => text.includes("fan") && text.includes("shouts"))).toBe(true);
  });
}, 40000);

it("does not present a failed run as a valid high-confidence passport", async () => {
  const baseFetch = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/analyze/job-1") {
      return jsonResponse({
        ...completeJob,
        status: "failed",
        passport: undefined,
        error: "Auto-match could not confirm a Musixmatch track from the saved ASR transcript. The transcript was saved; choose the track manually to generate the Live Variant Passport without reprocessing the clip."
      });
    }
    return baseFetch(url, init);
  }));

  render(<App />);
  await runUploadedClip();

  expect(await screen.findByText(/Auto-match could not confirm/i)).toBeInTheDocument();
  // A failed run must not borrow the preview placeholders to look like a valid passport.
  expect(screen.queryByText("Valid")).not.toBeInTheDocument();
  expect(screen.queryByText("81%")).not.toBeInTheDocument();
}, 40000);

it("offers ElevenLabs Scribe when Whisper fails before a transcript is available without recovery metadata", async () => {
  const baseFetch = fetch;
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/analyze/job-1") {
      return jsonResponse({
        ...completeJob,
        status: "failed",
        passport: undefined,
        error: "Live transcription failed: Replicate Whisper failed: Prediction failed: Soundfile is either not in the correct format or is malformed."
      });
    }
    if (url === "/api/analyze/job-1/retranscribe") {
      return jsonResponse({
        ...completeJob,
        passport: {
          ...completeJob.passport!,
          clip: {
            ...completeJob.passport!.clip,
            asrSource: "external",
            asrEngine: "ElevenLabs Scribe"
          }
        }
      });
    }
    return baseFetch(url, init);
  }));

  render(<App />);
  await runUploadedClip();

  expect(await screen.findByText(/Speech-to-text could not finish this transcript/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Retry ElevenLabs Scribe/i }));

  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/analyze/job-1/retranscribe")).toBe(true));
  expect((await screen.findAllByText(/ElevenLabs Scribe/i)).length).toBeGreaterThan(0);
}, 40000);

it("opens saved-transcript recovery when auto-match fails after Demucs and raw ASR", async () => {
  const baseFetch = fetch;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/analyze/job-1") {
      return jsonResponse({
        ...completeJob,
        status: "failed",
        passport: undefined,
        error: "Auto-match could not confirm a Musixmatch track from the saved ASR transcript. The transcript was saved; choose the track manually to generate the Live Variant Passport without reprocessing the clip.",
        recovery: {
          filename: "phone-stage-clip.mp4",
          durationSeconds: 18,
          vocalIsolationSource: "original",
          vocalIsolationConfidence: 0.78,
          vocalQuality: {
            selectedSource: "original",
            status: "fallback_original",
            score: 0.78,
            segmentCount: 2,
            tokenCount: 14,
            uniqueTokenRatio: 0.9,
            repetitionRatio: 0.04,
            averageConfidence: 0.75,
            issues: ["Demucs stem did not anchor confidently."],
            fallbackUsed: true,
            detail: "Original audio transcript selected after Demucs comparison."
          },
          asrSource: "replicate",
          asrEngine: "incredibly-fast-whisper",
          transcript: [
            { id: "T1", start: 0, end: 4, text: "You can wake up all alone", confidence: 0.72 },
            { id: "T2", start: 4, end: 8, text: "So tonight I'll give you something to remember", confidence: 0.72 }
          ],
          source: { kind: "upload", processingMode: "uploaded_media" },
          performanceContext: completeJob.passport!.performanceContext,
          event: null
        }
      });
    }
    if (url === "/api/analyze/job-1/reanchor") {
      return jsonResponse({
        ...completeJob,
        status: "complete",
        error: undefined,
        recovery: undefined,
        passport: {
          ...completeJob.passport!,
          track: {
            id: "manual-correct-song-correct-artist",
            title: "Correct Song",
            artist: "Correct Artist",
            hasLyrics: false,
            hasSubtitles: false,
            source: "manual"
          }
        }
      });
    }
    return baseFetch(url, init);
  }));

  const { container } = render(<App />);
  await runUploadedClip();

  expect(await screen.findByText(/Auto-match could not confirm/i)).toBeInTheDocument();
  expect(screen.queryByText(/Speech-to-text could not finish this transcript/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Retry ElevenLabs Scribe|Retry Whisper fallback/i })).not.toBeInTheDocument();
  expect(screen.getByText(/Replicate · 72%/i)).toBeInTheDocument();
  let recoveryPanel = container.querySelector<HTMLElement>('[aria-label="Choose track anchor"]');
  if (!recoveryPanel) {
    fireEvent.click(await screen.findByRole("button", { name: /Choose track/i }));
    await waitFor(() => expect(container.querySelector('[aria-label="Choose track anchor"]')).not.toBeNull());
    recoveryPanel = container.querySelector<HTMLElement>('[aria-label="Choose track anchor"]');
  }
  expect(recoveryPanel).not.toBeNull();
  const panel = recoveryPanel!;
  expect(within(panel).getByText(/Transcript saved/i)).toBeInTheDocument();
  expect(within(panel).getByText(/without rerunning the clip/i)).toBeInTheDocument();

  const currentPanel = screen.getByRole("region", { name: /Choose track anchor/i });
  const titleInput = within(currentPanel).getByLabelText("Correct track title");
  const artistInput = within(currentPanel).getByLabelText("Correct track artist");
  fireEvent.change(titleInput, { target: { value: "Correct Song" } });
  fireEvent.change(artistInput, { target: { value: "Correct Artist" } });
  expect(await screen.findByDisplayValue("Correct Song")).toBeInTheDocument();
  expect(await screen.findByDisplayValue("Correct Artist")).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("region", { name: /Choose track anchor/i })).getByRole("button", { name: /Use manual labels/i }));

  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === "/api/analyze/job-1/reanchor")).toBe(true));
  await waitFor(() => expect(screen.getAllByText(/Correct Song/).length).toBeGreaterThan(0));
  expect(screen.queryByText(/Auto-match could not confirm/i)).not.toBeInTheDocument();
}, 40000);

it("surfaces a polling failure instead of leaving analysis busy", async () => {
  const baseFetch = fetch;
  let jobReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/analyze/job-1") {
      jobReads += 1;
      if (jobReads === 1) {
        return jsonResponse({ ...completeJob, status: "running", passport: undefined });
      }
      throw new Error("Analysis status connection failed");
    }
    return baseFetch(url, init);
  }));

  render(<App />);
  await runUploadedClip();

  expect(await screen.findByText("Analysis status connection failed", {}, { timeout: 5000 })).toBeInTheDocument();
}, 40000);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
