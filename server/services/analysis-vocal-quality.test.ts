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
    transcribeWithElevenLabs: vi.fn(),
    identifyTrackFromLyrics: vi.fn(),
    getCanonicalReference: vi.fn(),
    analyzePerformance: vi.fn(),
    isolateVocalsWithLalal: vi.fn()
  };
});

vi.mock("../adapters/demucs", () => ({
  isolateVocalsWithDemucs: mocks.isolateVocalsWithDemucs
}));

vi.mock("../adapters/lalal", () => ({
  isolateVocals: mocks.isolateVocalsWithLalal
}));

vi.mock("../adapters/asr", () => ({
  transcribeLiveVocal: mocks.transcribeLiveVocal,
  transcribeRecallFragment: mocks.transcribeRecallFragment
}));

vi.mock("../adapters/elevenlabs", () => ({
  transcribeWithElevenLabs: mocks.transcribeWithElevenLabs,
  narratePassport: vi.fn()
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

  it("uses original-audio ASR first without spending time on a split when it is strong", async () => {
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
    expect(analyzed?.passport?.clip.vocalQuality).toMatchObject({ status: "passed", fallbackUsed: false });
    expect(analyzed?.passport?.clip.transcript[0]?.text).toContain("Talk to God");
    expect(mocks.isolateVocalsWithLalal).not.toHaveBeenCalled();
    expect(mocks.isolateVocalsWithDemucs).not.toHaveBeenCalled();
    expect(mocks.transcribeLiveVocal).toHaveBeenCalledTimes(1);
    expect(mocks.transcribeLiveVocal.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("does not run hidden split rescue after a weak original-audio passport", async () => {
    vi.stubEnv("LALAL_LICENSE_KEY", "lalal-test-key");
    mocks.isolateVocalsWithLalal.mockResolvedValue({
      source: "lalalai",
      confidence: 0.9,
      detail: "Live LALAL.AI lead vocal isolation completed.",
      vocalUrl: "https://cdn.example/lalal-vocals.mp3"
    });
    mocks.transcribeLiveVocal.mockImplementation(async (_file: Express.Multer.File | undefined, vocalUrl?: string) => ({
      source: "replicate",
      segments: vocalUrl ? originalAudioSegments() : weakOriginalSegments()
    }));
    mocks.identifyTrackFromLyrics.mockResolvedValue(mocks.track);
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
    expect(analyzed?.passport?.clip.transcript[0]?.text).toContain("satellite engines");
    expect(mocks.isolateVocalsWithLalal).not.toHaveBeenCalled();
    expect(mocks.isolateVocalsWithDemucs).not.toHaveBeenCalled();
    expect(mocks.transcribeLiveVocal.mock.calls.map((call) => call[1])).toEqual([undefined]);
  });

  it("recovers a failed Whisper transcript with ElevenLabs Scribe and completes the passport", async () => {
    mocks.transcribeLiveVocal.mockRejectedValue(new Error("Live transcription failed: Replicate Whisper failed: unsupported file format"));
    mocks.transcribeWithElevenLabs.mockResolvedValue({
      source: "external",
      engine: "ElevenLabs Scribe",
      segments: originalAudioSegments()
    });
    mocks.identifyTrackFromLyrics.mockResolvedValue(mocks.track);
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

    const { createJob, jobs, jobMedia } = await import("../store");
    const { retranscribeAnalysis, runAnalysis } = await import("./analysis");
    const job = createJob();

    await runAnalysis(job.id, {
      file: audioFile(),
      autoMatch: true,
      event: null,
      durationSeconds: 28,
      source: { kind: "upload", processingMode: "uploaded_media" }
    });

    const failed = jobs.get(job.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.recovery?.transcript).toEqual([]);
    expect(jobMedia.has(job.id)).toBe(true);

    const recovered = await retranscribeAnalysis(job.id);

    expect(recovered.status).toBe("complete");
    expect(recovered.error).toBeUndefined();
    expect(recovered.passport?.clip.asrSource).toBe("external");
    expect(recovered.passport?.clip.asrEngine).toBe("ElevenLabs Scribe");
    expect(recovered.passport?.track.title).toBe("Have You Tried Talking to God? (Remix)");
    expect(mocks.transcribeWithElevenLabs).toHaveBeenCalledTimes(1);
    expect(recovered.progress.find((step) => step.id === "transcribe")?.detail).toContain("ElevenLabs Scribe recovered");
  });

  it("recovers a failed Whisper job from saved media when old recovery metadata is missing", async () => {
    mocks.transcribeWithElevenLabs.mockResolvedValue({
      source: "external",
      engine: "ElevenLabs Scribe",
      segments: originalAudioSegments()
    });
    mocks.identifyTrackFromLyrics.mockResolvedValue(mocks.track);
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

    const { createJob, jobs, jobMedia } = await import("../store");
    const { retranscribeAnalysis } = await import("./analysis");
    const job = createJob();
    const file = audioFile();
    jobMedia.set(job.id, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      filename: file.originalname
    });
    jobs.set(job.id, {
      ...job,
      status: "failed",
      error: "Live transcription failed: Replicate Whisper failed: unsupported file format"
    });

    const recovered = await retranscribeAnalysis(job.id);

    expect(recovered.status).toBe("complete");
    expect(recovered.error).toBeUndefined();
    expect(recovered.passport?.clip.filename).toBe("stage-clip.mp3");
    expect(recovered.passport?.clip.asrSource).toBe("external");
    expect(recovered.passport?.clip.asrEngine).toBe("ElevenLabs Scribe");
    expect(mocks.transcribeWithElevenLabs).toHaveBeenCalledTimes(1);
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

function weakOriginalSegments() {
  return [
    { id: "W1", start: 0, end: 4, text: "satellite engines over cold neon water", confidence: 0.62 },
    { id: "W2", start: 4, end: 8, text: "broken traffic lights counting backwards", confidence: 0.62 }
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
