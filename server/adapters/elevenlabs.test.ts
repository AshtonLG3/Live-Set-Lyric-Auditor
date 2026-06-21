import { afterEach, describe, expect, it, vi } from "vitest";

describe("ElevenLabs Scribe transcription", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("removes periods and marks same-timestamp second lines as backing vocals", async () => {
    const { parseElevenLabsSegments } = await import("./elevenlabs");
    const segments = parseElevenLabsSegments({
      language_probability: 0.98,
      words: [
        { text: "Hello.", start: 0, end: 0.3, type: "word", logprob: -0.05 },
        { text: "World.", start: 0.4, end: 0.8, type: "word", logprob: -0.05 },
        { text: "Lead", start: 5, end: 5.3, type: "word", logprob: -0.05 },
        { text: "line.", start: 5.4, end: 5.8, type: "word", logprob: -0.05 }
      ]
    });

    expect(segments.map((segment) => segment.text)).toEqual([
      "Hello",
      "(World)",
      "Lead line"
    ]);
  });

  it("aborts stalled Scribe requests on the configured timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ELEVENLABS_API_KEY", "elevenlabs-test-key");
    vi.stubEnv("ELEVENLABS_STT_TIMEOUT_MS", "10000");
    const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      signal?.addEventListener("abort", () => reject(abortError()), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { transcribeWithElevenLabs } = await import("./elevenlabs");
    const pending = expect(transcribeWithElevenLabs(audioFile())).rejects.toThrow("ElevenLabs Scribe timed out after 10s");
    await vi.advanceTimersByTimeAsync(10_000);

    await pending;
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/speech-to-text",
      expect.objectContaining({ signal: expect.any(Object) })
    );
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
