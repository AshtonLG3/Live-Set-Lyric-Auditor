import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import type { AnalysisJob, HealthResponse } from "../shared/types";

const health: HealthResponse = {
  appName: "Live-Set Lyric Auditor",
  version: "0.1.0",
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
    version: "0.1.0",
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
      asrSource: "fixture"
    },
    summary: "Detected 3 live variant candidates.",
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
  expect(await screen.findByText(/v0.1.0/)).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText(/switch to light theme/i));
  expect(localStorage.getItem("lal-theme")).toBe("light");
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

