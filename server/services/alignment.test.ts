import { describe, expect, it } from "vitest";
import { alignTranscript, buildPassport, classifyVariants, normalizeText, tokenSimilarity } from "./alignment";
import { fixtureCanonicalLines, fixtureEvents, fixtureTranscript, fixtureTracks } from "../data/fixtures";

describe("alignment pipeline", () => {
  it("normalizes punctuation and casing", () => {
    expect(normalizeText("Cape Town, carry THIS!")).toBe("cape town carry this");
  });

  it("scores token overlap", () => {
    expect(tokenSimilarity("carry the chorus through the avenue", "carry this chorus through the avenue")).toBeGreaterThan(0.6);
  });

  it("classifies fixture live variants", () => {
    const alignments = alignTranscript(fixtureTranscript, fixtureCanonicalLines);
    const variants = classifyVariants(alignments, fixtureCanonicalLines, 0.72);
    expect(variants.map((variant) => variant.type)).toContain("city_shoutout");
    expect(variants.map((variant) => variant.type)).toContain("repeated_hook");
    expect(variants.map((variant) => variant.type)).toContain("skipped_line");
  });

  it("builds a passport without exposing canonical line text", () => {
    const passport = buildPassport({
      id: "job-1",
      track: fixtureTracks[0],
      event: fixtureEvents[0],
      filename: "demo.mp3",
      durationSeconds: 24,
      canonicalLines: fixtureCanonicalLines,
      transcript: fixtureTranscript,
      sourceCoverage: 0.72,
      canonicalSource: "fixture",
      restricted: false,
      matchMethod: "fixture_rescue",
      vocalIsolationSource: "fixture",
      vocalIsolationConfidence: 0.74,
      asrSource: "fixture",
      source: { kind: "fixture", processingMode: "fixture" }
    });

    const canonicalReferences = passport.variants.map((variant) => variant.canonicalAlignmentReference).join(" ");
    expect(passport.variants.length).toBeGreaterThan(2);
    expect(passport.performanceContext.arrangement).toBe("uncertain");
    expect(passport.liveContext).toBeNull();
    expect(JSON.stringify(passport)).not.toContain("canonicalLines");
    for (const line of fixtureCanonicalLines) {
      expect(canonicalReferences).not.toContain(line.text);
    }
  });
});
