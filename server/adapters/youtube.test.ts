import { describe, expect, it } from "vitest";
import { buildYouTubeExtractArgs } from "./youtube";

describe("YouTube excerpt extraction", () => {
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
});
