import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";
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
  version: "0.11.2",
  runtimeMode: "fixture",
  integrations: [
    { name: "Musixmatch", configured: false, mode: "fixture", detail: "fixture" },
    { name: "LALAL.AI", configured: false, mode: "fixture", detail: "fixture" },
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
    version: "0.11.2",
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
  vi.unstubAllGlobals();
});

it("shows the app version and theme toggle", async () => {
  render(<App />);
  expect((await screen.findAllByText(/v0.11.2/)).length).toBeGreaterThan(0);
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

it("accepts a YouTube live link without showing a blocked inline player", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Live link" }));
  fireEvent.change(screen.getByLabelText("Live performance URL"), {
    target: { value: "https://www.youtube.com/watch?v=M7lc1UVf-VE" }
  });
  expect(await screen.findByText("YouTube source ready")).toBeInTheDocument();
  expect(screen.queryByTitle("Live performance preview")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open on YouTube/i })).toHaveAttribute("href", "https://www.youtube.com/watch?v=M7lc1UVf-VE");
  expect(screen.getAllByText(/0:00-0:30/).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /Analyze selected range/i })).toBeEnabled();
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
  expect(screen.getByRole("button", { name: /Use YouTube \/ live link/i })).toBeInTheDocument();
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

it("runs the seeded demo and renders a passport", async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /Run judge-ready demo/i }));
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

it("adds a missed live moment via the inline insert button", async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /Run judge-ready demo/i }));
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
  fireEvent.click(await screen.findByRole("button", { name: /Run judge-ready demo/i }));

  expect(await screen.findByText("Analysis status connection failed", {}, { timeout: 5000 })).toBeInTheDocument();
}, 40000);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
