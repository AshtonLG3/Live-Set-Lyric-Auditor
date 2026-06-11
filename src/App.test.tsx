import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import type { AnalysisJob, HealthResponse } from "../shared/types";

vi.mock("./clip", async () => {
  const actual = await vi.importActual<typeof import("./clip")>("./clip");
  return {
    ...actual,
    inspectClip: vi.fn(async (file: File) => ({ file, durationSeconds: 24, kind: "audio" as const }))
  };
});

const health: HealthResponse = {
  appName: "Live-Set Lyric Auditor",
  version: "0.3.0",
  runtimeMode: "fixture",
  integrations: [
    { name: "Musixmatch", configured: false, mode: "fixture", detail: "fixture" },
    { name: "LALAL.AI", configured: false, mode: "fixture", detail: "fixture" },
    { name: "JamBase", configured: false, mode: "fixture", detail: "fixture" },
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
    { id: "transcribe", label: "Transcribe vocal", status: "complete" },
    { id: "compare", label: "Align to canonical reference", status: "complete" },
    { id: "passport", label: "Generate Live Variant Passport", status: "complete" }
  ],
  passport: {
    id: "job-1",
    createdAt: new Date().toISOString(),
    version: "0.3.0",
    track: {
      id: "fixture-track-midnight-atlas",
      title: "Midnight Atlas",
      artist: "The Signal Keeps",
      hasLyrics: true,
      hasSubtitles: true,
      source: "fixture"
    },
    event: null,
    clip: {
      filename: "seed.mp3",
      durationSeconds: 24,
      vocalIsolationSource: "fixture",
      asrSource: "fixture",
      source: { kind: "upload", processingMode: "uploaded_media" }
    },
    summary: "Detected 3 live variant candidates.",
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
    variants: [
      {
        id: "V1",
        type: "city_shoutout",
        start: 4,
        end: 8,
        liveText: "Cape Town carry this chorus",
        canonicalAlignmentReference: "L2",
        confidence: 0.84,
        impactNote: "Reviewable",
        recommendedAction: "Attach event-specific metadata.",
        translationRisk: "medium",
        severity: "high"
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
  expect(await screen.findByText(/v0.3.0/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/switch to light theme/i));
  expect(localStorage.getItem("lal-theme")).toBe("light");
});

it("accepts a YouTube live link and shows the selected range", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Live link" }));
  fireEvent.change(screen.getByLabelText("Live performance URL"), {
    target: { value: "https://www.youtube.com/watch?v=M7lc1UVf-VE" }
  });
  expect(await screen.findByTitle("Live performance preview")).toBeInTheDocument();
  expect(screen.getByText(/0:00-0:30/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Analyze selected range/i })).toBeEnabled();
});

it("uses remembered words to rescue a track", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Recall" }));
  fireEvent.change(screen.getByLabelText("Remembered lyric words"), {
    target: { value: "we carry the chorus through the avenue" }
  });
  fireEvent.click(screen.getByRole("button", { name: /Find the track/i }));
  expect(await screen.findByText(/Recognized fragment/i)).toBeInTheDocument();
  const matches = screen.getAllByRole("button", { name: /Midnight Atlas/i });
  fireEvent.click(matches[0]);
  expect(screen.getByRole("button", { name: /Continue with a live link/i })).toBeInTheDocument();
});

it("imports a clip through drag and drop", async () => {
  render(<App />);
  const file = new File(["audio"], "concert-snippet.mp3", { type: "audio/mpeg" });
  fireEvent.drop(screen.getByTestId("clip-dropzone"), { dataTransfer: { files: [file] } });
  expect(await screen.findByText("concert-snippet.mp3")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Analyze clip/i })).toBeEnabled();
});

it("runs the seeded demo and renders a passport", async () => {
  render(<App />);
  fireEvent.click(await screen.findByText(/Seed demo/i));
  await waitFor(() => expect(screen.getByText("Midnight Atlas")).toBeInTheDocument());
  expect(screen.getByText(/Detected 3 live variant candidates/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText(/Generate narration/i));
  await waitFor(() => expect(screen.getByText("Narration script")).toBeInTheDocument());
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
