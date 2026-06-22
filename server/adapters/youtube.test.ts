import { describe, expect, it } from "vitest";
import { buildYouTubeExtractArgs, describeYouTubeExtractionFailure, extractProviderExcerpt } from "./youtube";

describe("YouTube excerpt extraction", () => {
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
      "--no-playlist",
      "--no-warnings",
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

  it("turns Replit-style YouTube bot challenges into a safe setup message", () => {
    const message = describeYouTubeExtractionFailure({
      message: "Command failed: python -m yt_dlp https://www.youtube.com/shorts/video",
      stderr: "ERROR: [youtube] video: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies."
    });

    expect(message).toContain("YouTube blocked this hosted server");
    expect(message).toContain("YOUTUBE_COOKIES_BASE64");
    expect(message).not.toContain("python -m");
    expect(message).not.toContain("youtube.com/shorts");
  });

  it("asks for refreshed cookies when a hosted deploy already has cookies configured", () => {
    const message = describeYouTubeExtractionFailure({
      stderr: "ERROR: [youtube] video: Sign in to confirm you're not a bot. Use --cookies."
    }, true);

    expect(message).toContain("Refresh YOUTUBE_COOKIES_BASE64");
  });
});
