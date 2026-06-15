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
      segments: [
        { start: 0, end: 2.4, text: "we keep the signal" },
        { start: 2.4, end: 4.8, text: "alive" }
      ]
    });
    expect(runMock).toHaveBeenCalledWith(
      "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
      {
        input: expect.objectContaining({
          audio: expect.any(Buffer),
          task: "transcribe",
          timestamp: "chunk",
          batch_size: 24,
          diarise_audio: false
        })
      }
    );
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
