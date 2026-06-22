import { describe, expect, it } from "vitest";
import { alignTranscript, buildLineComparisons, buildPassport, classifyVariants, normalizeText, phoneticSimilarity, tokenSimilarity } from "./alignment";
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

  it("caps skipped comparison rows at the clip length so a 45s clip does not list the whole song", () => {
    // A full-song canonical (30 lines at 4s spacing = 116s) against a ~45s clip.
    const canonicalLines = Array.from({ length: 30 }, (_, i) => ({
      id: `L${i + 1}`,
      start: i * 4,
      end: i * 4 + 4,
      text: `token${i}alpha token${i}bravo token${i}charlie`
    }));
    const seg = (id: string, start: number, text: string) => ({ id, start, end: start + 3, text, confidence: 0.95 });
    const align = (segment: ReturnType<typeof seg>, lineIndex: number) => ({
      transcript: segment,
      canonical: canonicalLines[lineIndex],
      similarity: 1,
      timingDelta: 0,
      rawTimingDelta: 0,
      clipOffset: 0
    });
    // The clip performs the opening lines, then a late hook that recurs near the
    // song's end (line 28 at 112s) gets anchored — ballooning the skip window.
    const alignments = [align(seg("T1", 0, canonicalLines[0].text), 0), align(seg("T2", 4, canonicalLines[1].text), 1), align(seg("T3", 8, canonicalLines[2].text), 2), align(seg("T4", 20, canonicalLines[28].text), 28)];

    const comparisons = buildLineComparisons(alignments, canonicalLines, [], 45);
    const skipped = comparisons.filter((comparison) => comparison.status === "skipped");

    expect(skipped.length).toBeGreaterThan(0); // near-clip omissions are still flagged
    expect(comparisons.every((comparison) => comparison.start <= 45)).toBe(true); // nothing past the clip length
    expect(skipped.some((comparison) => comparison.canonicalId === "L4")).toBe(true); // line at 12s kept
    expect(skipped.some((comparison) => comparison.start > 45)).toBe(false); // 112s phantom dropped
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

  it("scores homophones as phonetically similar and distinct words as not", () => {
    expect(phoneticSimilarity("their", "there")).toBeGreaterThan(0.85);
    expect(phoneticSimilarity("i can hear you", "i can here you")).toBeGreaterThan(0.85);
    expect(phoneticSimilarity("i love you", "i hate you")).toBeLessThan(0.7);
  });

  it("flags a phonetically near-identical divergence as a likely ASR mishear", () => {
    const canonicalLines = [{ id: "L1", start: 0, end: 4, text: "i can hear you calling" }];
    const alignments = alignTranscript([
      { id: "T1", start: 0, end: 4, text: "i can here you calling", confidence: 0.9 }
    ], canonicalLines);
    const comparisons = buildLineComparisons(alignments, canonicalLines);
    expect(comparisons[0].status).toBe("changed");
    expect(comparisons[0].phoneticSimilarity).toBeGreaterThan(0.85);
    expect(comparisons[0].evidenceTier).toBe("likely_mishear");
  });

  it("keeps a phonetically distinct divergence as a real change, not a mishear", () => {
    const canonicalLines = [{ id: "L1", start: 0, end: 4, text: "i can hear you calling" }];
    const alignments = alignTranscript([
      { id: "T1", start: 0, end: 4, text: "i can help you falling", confidence: 0.9 }
    ], canonicalLines);
    const comparisons = buildLineComparisons(alignments, canonicalLines);
    expect(comparisons[0].evidenceTier).not.toBe("likely_mishear");
  });

  it("auto-detects a crowd call-and-response moment", () => {
    const canonicalLines = [{ id: "L1", start: 0, end: 4, text: "the night opens slowly under skies" }];
    const alignments = alignTranscript([
      { id: "T1", start: 8, end: 12, text: "everybody put your hands up", confidence: 0.9 }
    ], canonicalLines);
    const variants = classifyVariants(alignments, canonicalLines, 0.9);
    expect(variants.some((variant) => variant.type === "crowd_response")).toBe(true);
  });

  it("classifies a sustained unmatched lyric span as an interpolation, not an ad-lib", () => {
    const canonicalLines = [{ id: "L1", start: 0, end: 4, text: "the night opens slowly under skies" }];
    const alignments = alignTranscript([
      { id: "T1", start: 8, end: 14, text: "sweet dreams are made of this everybody", confidence: 0.9 }
    ], canonicalLines);
    const variants = classifyVariants(alignments, canonicalLines, 0.9);
    expect(variants.some((variant) => variant.type === "interpolation")).toBe(true);
    expect(variants.some((variant) => variant.type === "adlib")).toBe(false);
  });

  it("flags an explicit/clean word swap as a censored variant", () => {
    const canonicalLines = [{ id: "L1", start: 0, end: 4, text: "i dont give a damn about it" }];
    const alignments = alignTranscript([
      { id: "T1", start: 0, end: 4, text: "i dont give a hoot about it", confidence: 0.9 }
    ], canonicalLines);
    const variants = classifyVariants(alignments, canonicalLines, 0.9);
    expect(variants.some((variant) => variant.type === "censored")).toBe(true);
  });

  it("flags a multilingual code-switched live line", () => {
    const canonicalLines = [{ id: "L1", start: 0, end: 4, text: "dance with me under the lights tonight" }];
    const alignments = alignTranscript([
      { id: "T1", start: 0, end: 4, text: "baila with me under the lights tonight", confidence: 0.9 }
    ], canonicalLines);
    const variants = classifyVariants(alignments, canonicalLines, 0.9);
    expect(variants.some((variant) => variant.type === "code_switching")).toBe(true);
  });

  it("anchors a chorus reprise in song order instead of an earlier duplicate", () => {
    const canonicalLines = [
      { id: "L1", start: 0, end: 4, text: "verse one alpha bravo" },
      { id: "L2", start: 4, end: 8, text: "chorus shine so bright" },
      { id: "L3", start: 8, end: 12, text: "verse two charlie delta" },
      { id: "L4", start: 12, end: 16, text: "chorus shine so bright" }
    ];
    const alignments = alignTranscript([
      { id: "T1", start: 0, end: 4, text: "verse two charlie delta", confidence: 0.95 },
      { id: "T2", start: 4, end: 8, text: "chorus shine so bright", confidence: 0.95 }
    ], canonicalLines);

    // Greedy matching grabs the first "chorus" duplicate (L2) for T2, producing a
    // backward L3 -> L2 jump and a corrupted +4s offset. A global ordered alignment
    // must keep canonical order: T1 -> L3, T2 -> L4, anchoring the clip at +8s.
    expect(alignments.map((alignment) => alignment.canonical?.id)).toEqual(["L3", "L4"]);
    expect(alignments[0].clipOffset).toBe(8);
  });

  it("zeroes timing signals when canonical timestamps are unreliable", () => {
    const segments = [
      { id: "T1", start: 30, end: 34, text: fixtureCanonicalLines[0].text, confidence: 0.95 },
      { id: "T2", start: 34, end: 38, text: fixtureCanonicalLines[1].text, confidence: 0.95 },
      { id: "T3", start: 44, end: 48, text: fixtureCanonicalLines[2].text, confidence: 0.95 }
    ];
    const reliable = alignTranscript(segments, fixtureCanonicalLines, true);
    const unreliable = alignTranscript(segments, fixtureCanonicalLines, false);

    // With real timing the offset anchors and T3 still drifts.
    expect(reliable.some((alignment) => alignment.timingDelta >= 2.5)).toBe(true);
    // With fabricated (index*4 lyrics) timing, no drift is asserted at all.
    expect(unreliable.every((alignment) => alignment.timingDelta === 0)).toBe(true);
    expect(unreliable.every((alignment) => alignment.clipOffset === 0)).toBe(true);
    // Alignment itself is unaffected — same canonical lines are matched.
    expect(unreliable.map((alignment) => alignment.canonical?.id)).toEqual(reliable.map((alignment) => alignment.canonical?.id));
  });

  it("does not report fabricated timing drift for lyrics-only canonical sources", () => {
    const segments = [
      { id: "T1", start: 30, end: 34, text: fixtureCanonicalLines[0].text, confidence: 0.95 },
      { id: "T2", start: 34, end: 38, text: fixtureCanonicalLines[1].text, confidence: 0.95 },
      { id: "T3", start: 44, end: 48, text: fixtureCanonicalLines[2].text, confidence: 0.95 }
    ];
    const base = {
      id: "job-timing",
      track: fixtureTracks[0],
      event: null,
      filename: "demo.mp3",
      durationSeconds: 24,
      canonicalLines: fixtureCanonicalLines,
      transcript: segments,
      sourceCoverage: 0.8,
      restricted: false,
      matchMethod: "selected_track" as const,
      vocalIsolationSource: "original" as const,
      vocalIsolationConfidence: 0.6,
      asrSource: "replicate" as const,
      source: { kind: "upload" as const, processingMode: "uploaded_media" as const }
    };
    const richsync = buildPassport({ ...base, canonicalSource: "richsync" });
    const lyrics = buildPassport({ ...base, canonicalSource: "lyrics" });

    expect(richsync.variants.some((variant) => variant.type === "timing_drift")).toBe(true);
    expect(lyrics.variants.some((variant) => variant.type === "timing_drift")).toBe(false);
    expect(lyrics.confidenceOverview.timingOffsetSeconds).toBe(0);
    expect(lyrics.confidenceOverview.averageTimingDelta).toBe(0);
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
