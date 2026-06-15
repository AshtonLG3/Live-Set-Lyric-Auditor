import { afterEach, describe, expect, it, vi } from "vitest";

describe("ASR adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
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
