import { describe, expect, it } from "vitest";
import { alignTranscript, buildLineComparisons, buildPassport, classifyVariants, normalizeText, tokenSimilarity } from "./alignment";
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

  it("builds a line-by-line comparison model with matched and changed rows", () => {
    const alignments = alignTranscript([
      { id: "T1", start: 0, end: 4, text: fixtureCanonicalLines[0].text, confidence: 0.9 },
      { id: "T2", start: 5, end: 8, text: `${fixtureCanonicalLines[1].text} extra`, confidence: 0.9 }
    ], fixtureCanonicalLines);
    const variants = classifyVariants(alignments, fixtureCanonicalLines, 1);
    const comparisons = buildLineComparisons(alignments, fixtureCanonicalLines, variants);

    expect(comparisons[0]).toMatchObject({
      canonicalId: fixtureCanonicalLines[0].id,
      liveText: fixtureCanonicalLines[0].text,
      status: "matched"
    });
    expect(comparisons.some((comparison) => comparison.status === "changed")).toBe(true);
    expect(comparisons.some((comparison) => comparison.changedWords.added.includes("extra"))).toBe(true);
  });

  it("returns similarity of 1 for identical texts", () => {
    expect(tokenSimilarity("hello world", "hello world")).toBe(1);
  });

  it("returns similarity of 0 for completely different texts", () => {
    expect(tokenSimilarity("hello world", "foo bar baz")).toBe(0);
  });

  it("penalizes word reordering via LCS component", () => {
    const inOrder = tokenSimilarity("one two three four", "one two three four");
    const reversed = tokenSimilarity("one two three four", "four three two one");
    expect(inOrder).toBeGreaterThan(reversed);
  });

  it("handles empty transcript gracefully", () => {
    const alignments = alignTranscript([], fixtureCanonicalLines);
    expect(alignments).toHaveLength(0);
    const variants = classifyVariants(alignments, fixtureCanonicalLines, 0.9);
    expect(variants.filter((v) => v.type === "skipped_line")).toHaveLength(0);
  });

  it("handles single-word segments", () => {
    const segments = [{ id: "T1", start: 0, end: 2, text: "hey", confidence: 0.8 }];
    const alignments = alignTranscript(segments, fixtureCanonicalLines);
    expect(alignments).toHaveLength(1);
  });

  it("normalizes clip offset before calling timing drift", () => {
    const segments = [
      { id: "T1", start: 30, end: 34, text: fixtureCanonicalLines[0].text, confidence: 0.95 }
    ];
    const alignments = alignTranscript(segments, fixtureCanonicalLines);
    const variants = classifyVariants(alignments, fixtureCanonicalLines, 0.9);
    expect(alignments[0]).toMatchObject({ rawTimingDelta: 30, timingDelta: 0, clipOffset: -30 });
    expect(variants.some((v) => v.type === "timing_drift")).toBe(false);
  });

  it("still classifies residual timing drift after the clip offset is anchored", () => {
    const segments = [
      { id: "T1", start: 30, end: 34, text: fixtureCanonicalLines[0].text, confidence: 0.95 },
      { id: "T2", start: 34, end: 38, text: fixtureCanonicalLines[1].text, confidence: 0.95 },
      { id: "T3", start: 44, end: 48, text: fixtureCanonicalLines[2].text, confidence: 0.95 }
    ];
    const alignments = alignTranscript(segments, fixtureCanonicalLines);
    const variants = classifyVariants(alignments, fixtureCanonicalLines, 0.9);
    expect(alignments[0].clipOffset).toBe(-30);
    expect(alignments[2].timingDelta).toBeGreaterThanOrEqual(2.5);
    expect(variants.some((v) => v.type === "timing_drift")).toBe(true);
  });

  it("keeps reordered words out of the export diff kept bucket", () => {
    const canonicalLines = [{ id: "L1", start: 0, end: 3, text: "you love me" }];
    const alignments = alignTranscript([
      { id: "T1", start: 0, end: 3, text: "me love you", confidence: 0.95 }
    ], canonicalLines);
    const comparisons = buildLineComparisons(alignments, canonicalLines);
    expect(comparisons[0].changedWords).toEqual({
      kept: ["me"],
      removed: ["you", "love"],
      added: ["love", "you"]
    });
  });

  it("marks low-confidence ASR as uncertain instead of a confirmed lyric change", () => {
    const alignments = alignTranscript([
      { id: "T1", start: 4, end: 8, text: "Cape Town carry this chorus", confidence: 0.52 }
    ], fixtureCanonicalLines);
    const variants = classifyVariants(alignments, fixtureCanonicalLines, 1, "Cape Town");
    const comparisons = buildLineComparisons(alignments, fixtureCanonicalLines, variants);
    expect(variants[0]).toMatchObject({
      type: "uncertain",
      evidenceTier: "asr_uncertain"
    });
    expect(variants[0].reviewerNote).toContain("ASR confidence");
    expect(comparisons[0]).toMatchObject({
      status: "uncertain",
      evidenceTier: "asr_uncertain"
    });
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
    expect(passport.lineComparisons.length).toBeGreaterThan(passport.variants.length);
    expect(passport.lineComparisons.some((comparison) => comparison.status === "matched")).toBe(true);
    expect(JSON.stringify(passport)).not.toContain("canonicalLines");
    for (const line of fixtureCanonicalLines) expect(canonicalReferences).not.toContain(line.text);
  });
});
