import { describe, expect, it } from "vitest";
import { detectLiveLinkProvider, isAllowedLiveSource, isYouTubeUrl } from "./source-validation";

describe("live source validation", () => {
  it("accepts supported YouTube hosts", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=M7lc1UVf-VE")).toBe(true);
    expect(isYouTubeUrl("https://youtu.be/M7lc1UVf-VE")).toBe(true);
  });

  it("blocks internal and lookalike hosts from the YouTube extractor", () => {
    expect(isYouTubeUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isYouTubeUrl("https://youtube.com.attacker.example/watch?v=1")).toBe(false);
    expect(isAllowedLiveSource({
      kind: "live_link",
      processingMode: "provider_excerpt",
      provider: "youtube",
      url: "http://127.0.0.1/private",
      startSeconds: 0,
      endSeconds: 30
    })).toBe(false);
  });

  it("identifies supported live-link providers by host", () => {
    expect(detectLiveLinkProvider("https://www.youtube.com/watch?v=abc")).toBe("youtube");
    expect(detectLiveLinkProvider("https://youtu.be/abc")).toBe("youtube");
    expect(detectLiveLinkProvider("https://vimeo.com/123456")).toBe("vimeo");
    expect(detectLiveLinkProvider("https://player.vimeo.com/video/123456")).toBe("vimeo");
    expect(detectLiveLinkProvider("https://www.twitch.tv/videos/123456")).toBe("twitch");
    expect(detectLiveLinkProvider("https://clips.twitch.tv/AwkwardHelplessSalamander")).toBe("twitch");
  });

  it("rejects unknown, insecure, and lookalike hosts for provider detection", () => {
    expect(detectLiveLinkProvider("https://example.com/video")).toBeNull();
    expect(detectLiveLinkProvider("http://www.youtube.com/watch?v=abc")).toBeNull();
    expect(detectLiveLinkProvider("https://youtube.com.attacker.example/watch?v=1")).toBeNull();
    expect(detectLiveLinkProvider("http://169.254.169.254/latest/meta-data")).toBeNull();
  });

  it("accepts authorized Vimeo and Twitch live links, not lookalikes", () => {
    const base = { kind: "live_link" as const, processingMode: "provider_excerpt" as const, startSeconds: 0, endSeconds: 30 };
    expect(isAllowedLiveSource({ ...base, provider: "vimeo", url: "https://vimeo.com/123456" })).toBe(true);
    expect(isAllowedLiveSource({ ...base, provider: "twitch", url: "https://www.twitch.tv/videos/1" })).toBe(true);
    expect(isAllowedLiveSource({ ...base, provider: "vimeo", url: "https://vimeo.com.attacker.example/123" })).toBe(false);
  });
});
