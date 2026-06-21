import { describe, expect, it } from "vitest";
import { buildFfprobeArgs, buildTranscodeToMp3Args, buildTrimToMp3Args, resolveAnalysisDuration } from "./media";

describe("media validation", () => {
  it("uses measured upload duration instead of client metadata", () => {
    expect(resolveAnalysisDuration({ fileDuration: 301, requestedDuration: 20 })).toBe(301);
  });

  it("uses the selected upload range when a larger source is trimmed", () => {
    expect(resolveAnalysisDuration({
      fileDuration: 301,
      requestedDuration: 44,
      source: {
        kind: "upload",
        processingMode: "uploaded_media",
        startSeconds: 60,
        endSeconds: 95
      }
    })).toBe(35);
  });

  it("uses the selected provider range instead of client metadata", () => {
    expect(resolveAnalysisDuration({
      requestedDuration: 44,
      source: {
        kind: "live_link",
        processingMode: "provider_excerpt",
        provider: "youtube",
        url: "https://www.youtube.com/watch?v=M7lc1UVf-VE",
        startSeconds: 12,
        endSeconds: 42
      }
    })).toBe(30);
  });

  it("builds a quiet duration-only ffprobe request", () => {
    expect(buildFfprobeArgs("C:\\Temp\\clip.mp4")).toEqual([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      "C:\\Temp\\clip.mp4"
    ]);
  });

  it("builds a video-safe MP3 transcode request", () => {
    expect(buildTranscodeToMp3Args("C:\\Temp\\clip.mp4", "C:\\Temp\\profile.mp3")).toEqual([
      "-y",
      "-i",
      "C:\\Temp\\clip.mp4",
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "5",
      "C:\\Temp\\profile.mp3"
    ]);
  });

  it("builds an excerpt trim request for uploaded media", () => {
    expect(buildTrimToMp3Args("C:\\Temp\\clip.mp4", "C:\\Temp\\excerpt.mp3", 12.25, 32.5)).toEqual([
      "-y",
      "-ss",
      "12.25",
      "-i",
      "C:\\Temp\\clip.mp4",
      "-t",
      "32.5",
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "5",
      "C:\\Temp\\excerpt.mp3"
    ]);
  });
});
