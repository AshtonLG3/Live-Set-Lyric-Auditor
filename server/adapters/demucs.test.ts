// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const runMock = vi.hoisted(() => vi.fn());

vi.mock("replicate", () => ({
  default: class {
    run = runMock;
  }
}));

describe("Demucs vocal isolation adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    runMock.mockReset();
  });

  it("isolates vocals through Replicate Demucs and returns the stem URL", async () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "replicate-test-token");
    vi.stubEnv("REPLICATE_DEMUCS_REF", "cjwbw/demucs:testhash");
    runMock.mockResolvedValue({
      vocals: "https://replicate.delivery/demucs/vocals.mp3",
      drums: "https://replicate.delivery/demucs/drums.mp3"
    });

    const { isolateVocalsWithDemucs } = await import("./demucs");
    const result = await isolateVocalsWithDemucs(audioFile());

    expect(result).toMatchObject({
      source: "demucs",
      vocalUrl: "https://replicate.delivery/demucs/vocals.mp3"
    });
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock.mock.calls[0]?.[0]).toBe("cjwbw/demucs:testhash");
    const input = runMock.mock.calls[0]?.[1]?.input as { audio: unknown; stem: unknown };
    expect(input.audio).toBeInstanceOf(Blob);
    expect(input.stem).toBe("vocals");
  });

  it("falls back to the original audio when Replicate is not configured", async () => {
    const { isolateVocalsWithDemucs } = await import("./demucs");
    const result = await isolateVocalsWithDemucs(audioFile());

    expect(result.source).toBe("original");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("returns fixture isolation when no clip is supplied", async () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "replicate-test-token");

    const { isolateVocalsWithDemucs } = await import("./demucs");
    const result = await isolateVocalsWithDemucs(undefined);

    expect(result.source).toBe("fixture");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("throws when Demucs returns no vocal stem so live stem failures are visible", async () => {
    vi.stubEnv("REPLICATE_API_TOKEN", "replicate-test-token");
    runMock.mockResolvedValue({ drums: "https://replicate.delivery/demucs/drums.mp3" });

    const { isolateVocalsWithDemucs } = await import("./demucs");

    await expect(isolateVocalsWithDemucs(audioFile())).rejects.toThrow(/vocal stem/i);
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
