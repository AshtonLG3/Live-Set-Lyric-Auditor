import { afterEach, describe, expect, it, vi } from "vitest";

describe("LALAL.AI adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("checks the activation-key minute balance", async () => {
    vi.stubEnv("LALAL_LICENSE_KEY", "lalal-test-key");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ minutes_left: 255.28 }));
    vi.stubGlobal("fetch", fetchMock);

    const { getLalalMinutesLeft } = await import("./lalal");

    await expect(getLalalMinutesLeft()).resolves.toBe(255.28);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.lalal.ai/api/v1/limits/minutes_left/",
      expect.objectContaining({
        method: "POST",
        headers: { "X-License-Key": "lalal-test-key" }
      })
    );
  });

  it("uploads raw media, requests a vocal split, and waits for the vocal URL", async () => {
    vi.stubEnv("LALAL_LICENSE_KEY", "lalal-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "source-1" }))
      .mockResolvedValueOnce(jsonResponse({ task_id: "task-1" }))
      .mockResolvedValueOnce(jsonResponse({
        result: {
          "task-1": {
            status: "success",
            result: {
              tracks: [
                { type: "back", label: "instrumental", url: "https://cdn.example/back.mp3" },
                { type: "stem", label: "vocals", url: "https://cdn.example/vocals.mp3" }
              ]
            }
          }
        }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const { isolateVocals } = await import("./lalal");
    const result = await isolateVocals(audioFile());

    expect(result).toMatchObject({
      source: "lalalai",
      vocalUrl: "https://cdn.example/vocals.mp3"
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://www.lalal.ai/api/v1/upload/");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "X-License-Key": "lalal-test-key",
        "Content-Disposition": "attachment; filename=\"stage-clip.mp3\"",
        "Content-Type": "audio/mpeg"
      })
    });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeInstanceOf(Blob);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://www.lalal.ai/api/v1/split/stem_separator/");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      source_id: "source-1",
      presets: {
        stem: "vocals",
        splitter: "phoenix",
        encoder_format: "mp3",
        extraction_level: "deep_extraction"
      }
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://www.lalal.ai/api/v1/check/");
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
