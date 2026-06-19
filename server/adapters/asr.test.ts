// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const runMock = vi.hoisted(() => vi.fn());

vi.mock("replicate", () => ({
  default: class {
    run = runMock;
  }
}));

describe("ASR adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    runMock.mockReset();
  });

  it("uses the pinned fast Replicate model and maps chunk timestamps", async () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "replicate-test-token");
    runMock.mockResolvedValue({
      text: "we keep the signal alive",
      chunks: [
        { timestamp: [0, 2.4], text: "we keep the signal" },
        { timestamp: [2.4, 4.8], text: "alive" }
      ]
    });

    const { transcribeLiveVocal } = await import("./asr");
    const result = await transcribeLiveVocal(audioFile());

    expect(result).toMatchObject({
      source: "replicate",
      engine: "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
      segments: [
        { start: 0, end: 2.4, text: "we keep the signal" },
        { start: 2.4, end: 4.8, text: "alive" }
      ]
    });
    expect(runMock).toHaveBeenCalledWith(
      "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
      {
        input: expect.objectContaining({
          audio: expect.any(Blob),
          task: "transcribe",
          timestamp: "chunk",
          batch_size: 24,
          diarise_audio: false
        })
      }
    );
    expect(runMock).toHaveBeenCalledTimes(1);
    const uploaded = runMock.mock.calls[0]?.[1]?.input.audio as File;
    expect(uploaded.name).toBe("stage-clip.mp3");
  });

  it("falls back to the shared openai whisper version", async () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "replicate-test-token");
    runMock
      .mockRejectedValueOnce(new Error("fast model unavailable"))
      .mockResolvedValueOnce({ transcription: "fallback transcript" });

    const { transcribeLiveVocal } = await import("./asr");
    const result = await transcribeLiveVocal(undefined, "https://cdn.example/vocals.mp3");

    expect(result).toMatchObject({
      source: "replicate",
      engine: "openai/whisper:91ee9c0c3df30478510ff8c8a3a545add1ad0259ad3a9f78fba57fbc05ee64f7",
      segments: [{ text: "fallback transcript" }]
    });
    expect(runMock.mock.calls[1]?.[0]).toBe(
      "openai/whisper:91ee9c0c3df30478510ff8c8a3a545add1ad0259ad3a9f78fba57fbc05ee64f7"
    );
    expect(runMock.mock.calls[1]?.[1]?.input).toMatchObject({
      audio: "https://cdn.example/vocals.mp3",
      model: "large-v2",
      transcription: "plain text",
      translate: false
    });
  });

  it("chooses the older Whisper candidate when the fast model returns a repetitive transcript", async () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "replicate-test-token");
    runMock
      .mockResolvedValueOnce({
        chunks: Array.from({ length: 12 }, (_, index) => ({
          timestamp: [index, index + 1],
          text: "I'm trying to be"
        }))
      })
      .mockResolvedValueOnce({
        transcription: "Talk to God wonder if he's mad or angry Listen God I know I've been sinning lately trying to be better but I'm struggling greatly"
      });

    const { transcribeLiveVocal } = await import("./asr");
    const result = await transcribeLiveVocal(undefined, "https://cdn.example/lalal-vocals.mp3");

    expect(result.engine).toBe("openai/whisper:91ee9c0c3df30478510ff8c8a3a545add1ad0259ad3a9f78fba57fbc05ee64f7");
    expect(result.segments.map((segment) => segment.text).join(" ")).toContain("Talk to God");
  });

  it("does not let a rate-limited fallback model fail a usable fast transcript", async () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "replicate-test-token");
    runMock.mockResolvedValueOnce({
      chunks: [{ timestamp: [0, 3], text: "talk to god wonder if he is mad or angry" }]
    });

    const { transcribeLiveVocal } = await import("./asr");
    const result = await transcribeLiveVocal(audioFile());

    expect(result).toMatchObject({
      source: "replicate",
      engine: "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c"
    });
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("downloads a vocal URL and retries when Replicate rejects the remote file handoff", async () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "replicate-test-token");
    runMock
      .mockResolvedValueOnce({
        chunks: [{ timestamp: [0, 3], text: "talk to god wonder if he is mad" }]
      });
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([9, 8, 7, 6]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { transcribeLiveVocal } = await import("./asr");
    const result = await transcribeLiveVocal(undefined, "https://cdn.example/lalal-vocals");

    expect(result.segments.map((segment) => segment.text)).toEqual(["talk to god wonder if he is mad"]);
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example/lalal-vocals");
    const audio = runMock.mock.calls[0]?.[1]?.input.audio as File;
    expect(audio).toBeInstanceOf(Blob);
    expect(audio.name).toBe("lalal-vocals.mp3");
  });

  it("drops common low-confidence Whisper filler from live transcripts", async () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "replicate-test-token");
    runMock.mockResolvedValue({
      chunks: [
        { timestamp: [0, 1.8], text: "Okay, here's this one." },
        { timestamp: [1.8, 5.2], text: "I can tell by your eyes that you've probably been crying forever" }
      ]
    });

    const { transcribeLiveVocal } = await import("./asr");
    const result = await transcribeLiveVocal(audioFile());

    expect(result.segments.map((segment) => segment.text)).toEqual([
      "I can tell by your eyes that you've probably been crying forever"
    ]);
  });


  it("fails real media instead of substituting the fixture transcript", async () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "replicate-test-token");
    runMock.mockRejectedValue(new Error("provider unavailable"));

    const { transcribeLiveVocal } = await import("./asr");

    await expect(transcribeLiveVocal(audioFile())).rejects.toThrow("Live transcription failed");
  });

  it("sends the separated LALAL vocal stem to external ASR", async () => {
    vi.stubEnv("ASR_API_URL", "https://asr.example/transcribe");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 3, 2, 1]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" }
      }))
      .mockResolvedValueOnce(jsonResponse({
        segments: [{ id: "A1", start: 0, end: 3, text: "we keep the signal", confidence: 0.91 }]
      }));
    vi.stubGlobal("fetch", fetchMock);

    const { transcribeLiveVocal } = await import("./asr");
    const result = await transcribeLiveVocal(undefined, "https://cdn.example/vocals.mp3");

    expect(result).toMatchObject({ source: "external" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://cdn.example/vocals.mp3");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://asr.example/transcribe");
    const body = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    const uploaded = body.get("file") as File;
    expect(uploaded.name).toBe("lalal-vocals.mp3");
    expect(uploaded.type).toBe("audio/mpeg");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
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
