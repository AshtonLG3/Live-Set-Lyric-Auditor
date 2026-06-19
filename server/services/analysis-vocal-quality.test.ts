// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptSegment } from "../../shared/types";

const mocks = vi.hoisted(() => {
  const track = {
    id: "mxm-talk-to-god",
    commonTrackId: "common-talk-to-god",
    title: "Have You Tried Talking to God? (Remix)",
    artist: "7Seven feat. 414bigfrank",
    hasLyrics: true,
    hasSubtitles: true,
    source: "musixmatch" as const
  };
  return {
    track,
    isolateVocalsWithDemucs: vi.fn(),
    transcribeLiveVocal: vi.fn(),
    transcribeRecallFragment: vi.fn(),
    identifyTrackFromLyrics: vi.fn(),
    getCanonicalReference: vi.fn(),
    analyzePerformance: vi.fn()
  };
});

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

describe("analysis vocal quality fallback", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects a repetitive Demucs stem and completes with original-audio ASR", async () => {
    mocks.isolateVocalsWithDemucs.mockResolvedValue({
      source: "demucs",
      confidence: 0.86,
      detail: "Replicate Demucs vocal stem isolation completed.",
      vocalUrl: "https://cdn.example/demucs-vocals.mp3"
    });
    mocks.transcribeLiveVocal.mockImplementation(async (_file: Express.Multer.File | undefined, vocalUrl?: string) => ({
      source: "replicate",
      segments: vocalUrl ? repeatedStemSegments() : originalAudioSegments()
    }));
    mocks.identifyTrackFromLyrics.mockImplementation(async (segments: TranscriptSegment[]) =>
      segments.some((segment) => String(segment.text).toLowerCase().includes("talk to god"))
        ? mocks.track
        : null
    );
    mocks.getCanonicalReference.mockResolvedValue({
      lines: [
        { id: "L1", start: 0, end: 4, text: "Talk to God wonder if he's mad or angry" },
        { id: "L2", start: 4, end: 8, text: "Listen God I know I've been sinning lately" }
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
      durationSeconds: 28,
      source: { kind: "upload", processingMode: "uploaded_media" }
    });

    const analyzed = jobs.get(job.id);
    expect(analyzed?.status).toBe("complete");
    expect(analyzed?.passport?.clip.vocalIsolationSource).toBe("original");
    expect(analyzed?.passport?.clip.vocalQuality).toMatchObject({
      status: "fallback_original",
      fallbackUsed: true,
      rejectedSource: "demucs"
    });
    expect(analyzed?.passport?.clip.transcript[0]?.text).toContain("Talk to God");
    expect(mocks.transcribeLiveVocal).toHaveBeenCalledTimes(2);
    expect(mocks.transcribeLiveVocal.mock.calls[0]?.[1]).toBe("https://cdn.example/demucs-vocals.mp3");
    expect(mocks.transcribeLiveVocal.mock.calls[1]?.[1]).toBeUndefined();
  });
});

function repeatedStemSegments() {
  return Array.from({ length: 24 }, (_, index) => ({
    id: `L${index + 1}`,
    start: index * 2,
    end: index * 2 + 2,
    text: "I'm trying to be",
    confidence: 0.72
  }));
}

function originalAudioSegments() {
  return [
    { id: "O1", start: 0, end: 4, text: "Talk to God wonder if he's mad or angry", confidence: 0.84 },
    { id: "O2", start: 4, end: 8, text: "Listen God I know I've been sinning lately", confidence: 0.82 }
  ];
}

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
