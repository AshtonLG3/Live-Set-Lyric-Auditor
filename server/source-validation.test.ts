import { describe, expect, it } from "vitest";
import { isAllowedLiveSource, isYouTubeUrl } from "./source-validation";

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
});
