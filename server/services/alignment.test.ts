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

  it("does not report skipped lines when the excerpt has no canonical anchor window", () => {
    const variants = classifyVariants([], fixtureCanonicalLines, 1);
    expect(variants.filter((variant) => variant.type === "skipped_line")).toHaveLength(0);
  });

  it("reports skipped lines only inside matched canonical anchors", () => {
    const alignments = alignTranscript([
      { id: "T1", start: 0, end: 4, text: fixtureCanonicalLines[0].text, confidence: 0.9 },
      { id: "T2", start: 16, end: 20, text: fixtureCanonicalLines[3].text, confidence: 0.9 }
    ], fixtureCanonicalLines);
    const variants = classifyVariants(alignments, fixtureCanonicalLines, 1);
    expect(variants.filter((variant) => variant.type === "skipped_line").map((variant) => variant.canonicalAlignmentReference)).toEqual([
      "L2 (canonical line absent from aligned ASR)",
      "L3 (canonical line absent from aligned ASR)"
    ]);
  });

  it("builds a passport with cached review excerpts but without storing canonicalLines", () => {
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
    expect(passport.variants.some((variant) => variant.canonicalExcerpt)).toBe(true);
    expect(JSON.stringify(passport)).not.toContain("canonicalLines");
    for (const line of fixtureCanonicalLines) expect(canonicalReferences).not.toContain(line.text);
  });
});
