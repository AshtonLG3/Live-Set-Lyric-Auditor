import { describe, expect, it } from "vitest";
import { formatSourceTime, parseLiveSource } from "./source";

describe("live source parsing", () => {
  it("builds a ranged YouTube embed without downloading media", () => {
    const source = parseLiveSource("https://youtu.be/M7lc1UVf-VE", 42, 68);
    expect(source).toMatchObject({ provider: "youtube", label: "YouTube" });
    expect(source?.embedUrl).toContain("start=42");
    expect(source?.embedUrl).toContain("end=68");
  });

  it("recognizes direct media and rejects unsafe protocols", () => {
    expect(parseLiveSource("https://example.com/live-set.mp4")?.provider).toBe("direct_media");
    expect(parseLiveSource("javascript:alert(1)")).toBeNull();
  });

  it("formats source timestamps", () => {
    expect(formatSourceTime(68)).toBe("1:08");
  });
});
