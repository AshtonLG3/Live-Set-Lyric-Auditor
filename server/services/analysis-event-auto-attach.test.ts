// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventCandidate, TrackCandidate } from "../../shared/types";

const mocks = vi.hoisted(() => ({
  searchEvents: vi.fn(),
  buildLiveContext: vi.fn((event: EventCandidate | null) => event
    ? {
        source: "jambase" as const,
        eventId: event.id,
        lineup: event.lineup ?? [],
        setlist: { available: Boolean(event.setlist?.available) },
        summary: `${event.venue}, ${event.city}`,
        confidence: 0.86
      }
    : null),
  getCanonicalReference: vi.fn(),
  analyzePerformance: vi.fn()
}));

vi.mock("../adapters/jambase", () => ({
  searchEvents: mocks.searchEvents,
  buildLiveContext: mocks.buildLiveContext
}));

vi.mock("../adapters/musixmatch", () => ({
  identifyTrackFromLyrics: vi.fn(),
  searchTracksByLyrics: vi.fn(),
  getCanonicalReference: mocks.getCanonicalReference
}));

vi.mock("../adapters/cyanite", () => ({
  analyzePerformance: mocks.analyzePerformance
}));

describe("analysis event auto-attach", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("auto-attaches a JamBase event after track identification when city is supplied", async () => {
    mocks.searchEvents.mockResolvedValue([event()]);
    mockCommonAnalysis();

    const { createJob, jobs } = await import("../store");
    const { runAnalysis } = await import("./analysis");
    const job = createJob();

    await runAnalysis(job.id, {
      track: track(),
      autoMatch: false,
      event: null,
      eventCity: "London",
      source: { kind: "recall_recording", processingMode: "recall_recording" },
      recallSegments: transcript()
    });

    const analyzed = jobs.get(job.id);
    expect(mocks.searchEvents).toHaveBeenCalledWith({ artist: "Dua Lipa", city: "London", date: undefined });
    expect(analyzed?.passport?.event?.id).toBe("jambase-london");
    expect(analyzed?.passport?.liveContext?.eventId).toBe("jambase-london");
  });

  it("skips JamBase auto-attach when no city or date was supplied", async () => {
    mockCommonAnalysis();

    const { createJob, jobs } = await import("../store");
    const { runAnalysis } = await import("./analysis");
    const job = createJob();

    await runAnalysis(job.id, {
      track: track(),
      autoMatch: false,
      event: null,
      source: { kind: "recall_recording", processingMode: "recall_recording" },
      recallSegments: transcript()
    });

    const analyzed = jobs.get(job.id);
    expect(mocks.searchEvents).not.toHaveBeenCalled();
    expect(analyzed?.passport?.event).toBeNull();
    expect(analyzed?.passport?.liveContext).toBeNull();
  });

  it("auto-attaches JamBase when a saved transcript is re-anchored with event hints", async () => {
    mocks.searchEvents.mockResolvedValue([event()]);
    mockCommonAnalysis();

    const { createJob, updateJob } = await import("../store");
    const { reanchorAnalysis } = await import("./analysis");
    const job = createJob();
    updateJob(job.id, (current) => ({
      ...current,
      status: "failed",
      error: "The live transcript did not produce a confident Musixmatch track match.",
      recovery: {
        filename: "stage.mp4",
        durationSeconds: 12,
        vocalIsolationSource: "original",
        vocalIsolationConfidence: 0.72,
        asrSource: "replicate",
        transcript: transcript(),
        source: { kind: "upload", processingMode: "uploaded_media" },
        performanceContext: performanceContext(),
        event: null,
        eventCity: "London",
        eventDate: "2025-06-21"
      }
    }));

    const corrected = await reanchorAnalysis(job.id, track());

    expect(mocks.searchEvents).toHaveBeenCalledWith({ artist: "Dua Lipa", city: "London", date: "2025-06-21" });
    expect(corrected.passport?.event?.id).toBe("jambase-london");
    expect(corrected.passport?.liveContext?.eventId).toBe("jambase-london");
    expect(corrected.recovery).toBeUndefined();
  });
});

function mockCommonAnalysis() {
  mocks.getCanonicalReference.mockResolvedValue({
    lines: [
      { id: "L1", start: 0, end: 4, text: "You can wake up all alone" },
      { id: "L2", start: 4, end: 8, text: "So tonight I'll give you something to remember" }
    ],
    source: "lyrics",
    sourceCoverage: 0.74,
    restricted: false,
    language: "en"
  });
  mocks.analyzePerformance.mockResolvedValue({
    source: "fixture",
    status: "fallback",
    energyLevel: 0.62,
    dominantEmotions: [],
    instruments: [],
    arrangement: "uncertain",
    summary: "Fallback profile.",
    confidence: 0.4
  });
}

function performanceContext() {
  return {
    source: "fixture" as const,
    status: "fallback" as const,
    energyLevel: 0.62,
    dominantEmotions: [],
    instruments: [],
    arrangement: "uncertain" as const,
    summary: "Fallback profile.",
    confidence: 0.4
  };
}

function track(): TrackCandidate {
  return {
    id: "342876196",
    commonTrackId: "177990581",
    title: "Falling Forever",
    artist: "Dua Lipa",
    isrc: "GBAHT2301186",
    hasLyrics: true,
    hasSubtitles: true,
    source: "musixmatch"
  };
}

function event(): EventCandidate {
  return {
    id: "jambase-london",
    title: "Dua Lipa at Wembley Stadium",
    artist: "Dua Lipa",
    venue: "Wembley Stadium",
    city: "London",
    date: "2025-06-21T20:00:00+01:00",
    lineup: ["Dua Lipa"],
    setlist: { available: true, songs: ["Falling Forever"] },
    source: "jambase"
  };
}

function transcript() {
  return [
    { id: "R1", start: 0, end: 4, text: "You can wake up all alone", confidence: 1 },
    { id: "R2", start: 4, end: 8, text: "So tonight I'll give you something to remember", confidence: 1 }
  ];
}
