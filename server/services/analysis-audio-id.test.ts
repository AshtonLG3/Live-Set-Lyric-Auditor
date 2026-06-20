// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const track = {
    id: "mxm-falling-forever",
    commonTrackId: "common-falling-forever",
    title: "Falling Forever",
    artist: "Dua Lipa",
    isrc: "GBUM72401234",
    hasLyrics: true,
    hasSubtitles: true,
    source: "musixmatch" as const
  };
  return {
    track,
    identifyTrackFromAudio: vi.fn(),
    isolateVocalsWithDemucs: vi.fn(),
    transcribeLiveVocal: vi.fn(),
    transcribeRecallFragment: vi.fn(),
    identifyTrackFromLyrics: vi.fn(),
    getCanonicalReference: vi.fn(),
    analyzePerformance: vi.fn()
  };
});

vi.mock("../adapters/audio-id", () => ({
  identifyTrackFromAudio: mocks.identifyTrackFromAudio
}));

vi.mock("../adapters/demucs", () => ({
  isolateVocalsWithDemucs: mocks.isolateVocalsWithDemucs
}));

vi.mock("../adapters/asr", () => ({
  transcribeLiveVocal: mocks.transcribeLiveVocal,
  transcribeRecallFragment: mocks.transcribeRecallFragment
}));

vi.mock("../adapters/musixmatch", () => ({
  identifyTrackFromLyrics: mocks.identifyTrackFromLyrics,
  searchTracksByLyrics: vi.fn(),
  getCanonicalReference: mocks.getCanonicalReference
}));

vi.mock("../adapters/cyanite", () => ({
  analyzePerformance: mocks.analyzePerformance
}));

describe("analysis audio-id route", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("uses audio identification as the first auto-match anchor before lyric rescue", async () => {
    mocks.identifyTrackFromAudio.mockResolvedValue({
      track: mocks.track,
      provider: "acrcloud",
      confidence: 0.98,
      detail: "ACRCloud audio fingerprint 98%"
    });
    mocks.isolateVocalsWithDemucs.mockResolvedValue({
      source: "original",
      confidence: 0.78,
      detail: "Using original audio."
    });
    mocks.transcribeLiveVocal.mockResolvedValue({
      source: "replicate",
      segments: [
        { id: "T1", start: 0, end: 4, text: "How long how long can we keep falling forever", confidence: 0.86 },
        { id: "T2", start: 4, end: 8, text: "You can wake up all alone", confidence: 0.84 }
      ]
    });
    mocks.getCanonicalReference.mockResolvedValue({
      lines: [
        { id: "L1", start: 0, end: 4, text: "How long how long can we keep falling forever" },
        { id: "L2", start: 4, end: 8, text: "You can wake up all alone" }
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

    const { createJob, jobs } = await import("../store");
    const { runAnalysis } = await import("./analysis");
    const job = createJob();

    await runAnalysis(job.id, {
      file: audioFile(),
      autoMatch: true,
      event: null,
      durationSeconds: 24,
      source: { kind: "upload", processingMode: "uploaded_media" }
    });

    const analyzed = jobs.get(job.id);
    expect(analyzed?.status).toBe("complete");
    expect(analyzed?.passport?.track.title).toBe("Falling Forever");
    expect(analyzed?.passport?.recordingIdentity.matchMethod).toBe("audio_identify");
    expect(analyzed?.progress.find((step) => step.id === "anchor")?.detail).toContain("ACRCloud audio fingerprint 98%");
    expect(mocks.identifyTrackFromAudio).toHaveBeenCalledWith(expect.objectContaining({ originalname: "stage-clip.mp3" }));
    expect(mocks.identifyTrackFromLyrics).not.toHaveBeenCalled();
  });
});

function audioFile(): Express.Multer.File {
  return {
    fieldname: "clip",
    originalname: "stage-clip.mp3",
    encoding: "7bit",
    mimetype: "audio/mpeg",
    size: 4,
    buffer: Buffer.from([1, 2, 3, 4]),
    stream: undefined as never,
    destination: "",
    filename: "",
    path: ""
  };
}
