// @vitest-environment node
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

  it("uploads raw media, requests lead/back vocal separation, and waits for the lead vocal URL", async () => {
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
                { type: "stem", label: "vocals@1", url: "https://cdn.example/backing.mp3" },
                { type: "stem", label: "vocals@0", url: "https://cdn.example/lead.mp3" },
                { type: "stem", label: "vocals", url: "https://cdn.example/vocals.mp3" }
              ]
            }
          }
        }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const { isolateVocals } = await import("./lalal");
    const result = await isolateVocals(audioFile());

    const splitBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
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
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://www.lalal.ai/api/v1/check/");
    expect(splitBody).toMatchObject({ source_id: "source-1" });
    expect(splitBody.presets).toMatchObject({
      stem: "vocals",
      dereverb_enabled: true,
      encoder_format: "mp3",
      extraction_level: "clear_cut",
      multivocal: "lead_back"
    });
    expect(splitBody.presets).not.toHaveProperty("splitter");
    expect(result).toMatchObject({
      source: "lalalai",
      confidence: 0.9,
      vocalUrl: "https://cdn.example/lead.mp3"
    });
    expect(result.detail).toContain("lead vocal");
  });

  it("uses original audio transparently when no activation key is configured", async () => {
    vi.stubEnv("LALAL_LICENSE_KEY", "");
    const { isolateVocals } = await import("./lalal");

    const result = await isolateVocals(audioFile());
    expect(result.source).toBe("original");
    expect(result.vocalUrl).toBeUndefined();
  });

  it("fails a real run when configured isolation fails", async () => {
    vi.stubEnv("LALAL_LICENSE_KEY", "lalal-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    const { isolateVocals } = await import("./lalal");

    await expect(isolateVocals(audioFile())).rejects.toThrow("Live vocal isolation failed: LALAL upload failed with 401");
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
