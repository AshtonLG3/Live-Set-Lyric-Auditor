import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { buildYouTubeExtractArgs, describeYouTubeExtractionFailure, extractProviderExcerpt } from "./youtube";

vi.mock("node:child_process", () => {
  const execFileMock = vi.fn();
  return {
    execFile: execFileMock,
    default: { execFile: execFileMock }
  };
});

describe("YouTube excerpt extraction", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.mocked(execFile).mockReset();
    vi.resetModules();
  });

  it("delegates extraction to a configured worker instead of running yt-dlp locally", async () => {
    vi.stubEnv("EXTRACT_WORKER_URL", "https://worker.example");
    vi.stubEnv("EXTRACT_WORKER_TOKEN", "secret");
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
    vi.stubGlobal("fetch", fetchMock);

    const { extractProviderExcerpt: extract } = await import("./youtube");
    const file = await extract({ kind: "live_link", processingMode: "provider_excerpt", provider: "youtube", url: "https://www.youtube.com/watch?v=abc123", startSeconds: 0, endSeconds: 20 });

    expect(file).toMatchObject({ mimetype: "audio/mpeg", size: 4 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://worker.example/extract");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-worker-token"]).toBe("secret");
    expect(JSON.parse(String(init.body))).toMatchObject({ url: "https://www.youtube.com/watch?v=abc123", start: 0, end: 20 });
  });

  it("falls back to local extraction when the configured worker times out", async () => {
    vi.stubEnv("EXTRACT_WORKER_URL", "https://worker.example");
    vi.stubEnv("EXTRACT_WORKER_TIMEOUT_MS", "5000");
    vi.resetModules();
    const fetchMock = vi.fn().mockRejectedValue(new Error("the extraction worker did not respond within 5 seconds"));
    vi.stubGlobal("fetch", fetchMock);
    mockSuccessfulLocalExtraction();

    const { extractProviderExcerpt: extract } = await import("./youtube");
    const file = await extract({ kind: "live_link", processingMode: "provider_excerpt", provider: "youtube", url: "https://www.youtube.com/watch?v=abc123", startSeconds: 0, endSeconds: 20 });

    expect(file).toMatchObject({ mimetype: "audio/mpeg", size: 4 });
    expect(fetchMock).toHaveBeenCalledWith("https://worker.example/extract", expect.any(Object));
    expect(vi.mocked(execFile).mock.calls.some(([, args]) => Array.isArray(args) && args.includes("-m") && args.includes("yt_dlp"))).toBe(true);
  });

  it("rejects an unsupported or lookalike live-link host before shelling out to yt-dlp", async () => {
    await expect(extractProviderExcerpt({
      kind: "live_link",
      processingMode: "provider_excerpt",
      provider: "youtube",
      url: "https://youtube.com.attacker.example/watch?v=1",
      startSeconds: 0,
      endSeconds: 30
    })).rejects.toThrow(/supported, authorized live-link/i);
  });

  it("builds a bounded audio-only yt-dlp command without a shell", () => {
    expect(buildYouTubeExtractArgs(
      "https://www.youtube.com/watch?v=video-1",
      12,
      42,
      "C:\\Temp\\excerpt.mp3"
    )).toEqual([
      "-m",
      "yt_dlp",
      "--ignore-config",
      "--no-playlist",
      "--no-warnings",
      "-f",
      "bestaudio[acodec!=none]/best[acodec!=none]/best",
      "--download-sections",
      "*12-42",
      "--force-keyframes-at-cuts",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "5",
      "-o",
      "C:\\Temp\\excerpt.mp3",
      "https://www.youtube.com/watch?v=video-1"
    ]);
  });

  it("can pass an authorized cookies file to yt-dlp for hosted deploys", () => {
    const args = buildYouTubeExtractArgs(
      "https://www.youtube.com/watch?v=video-1",
      0,
      12,
      "/tmp/excerpt.mp3",
      { cookiesFile: "/tmp/youtube-cookies.txt" }
    );

    expect(args).toContain("--cookies");
    expect(args).toContain("/tmp/youtube-cookies.txt");
  });

  it("turns hosted YouTube bot challenges into a Railway setup message", () => {
    const message = describeYouTubeExtractionFailure({
      message: "Command failed: python -m yt_dlp https://www.youtube.com/shorts/video",
      stderr: "ERROR: [youtube] video: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies."
    });

    expect(message).toContain("YouTube blocked this hosted server");
    expect(message).toContain("YOUTUBE_COOKIES_BASE64");
    expect(message).toContain("Railway environment variables");
    expect(message).not.toContain("python -m");
    expect(message).not.toContain("youtube.com/shorts");
  });

  it("asks for refreshed cookies when a hosted deploy already has cookies configured", () => {
    const message = describeYouTubeExtractionFailure({
      stderr: "ERROR: [youtube] video: Sign in to confirm you're not a bot. Use --cookies."
    }, true);

    expect(message).toContain("Refresh YOUTUBE_COOKIES_BASE64");
    expect(message).toContain("Railway environment variables");
  });
});

function mockSuccessfulLocalExtraction() {
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    const argList = Array.isArray(args[1]) ? args[1].map(String) : [];
    const callback = (typeof args[2] === "function" ? args[2] : args[3]) as ((error: Error | null, stdout: string, stderr: string) => void) | undefined;
    const outputIndex = argList.indexOf("-o");
    if (outputIndex >= 0 && argList[outputIndex + 1]) {
      writeFileSync(argList[outputIndex + 1], Buffer.from([1, 2, 3, 4]));
    }
    callback?.(null, "ok", "");
    return {} as ReturnType<typeof execFile>;
  }) as typeof execFile);
}
