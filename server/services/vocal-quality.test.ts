import { describe, expect, it } from "vitest";
import { assessVocalTranscript, buildFallbackQualityReport, shouldRejectSeparatedStem } from "./vocal-quality";
import type { TranscriptSegment } from "../../shared/types";

describe("vocal transcript quality gate", () => {
  it("rejects a Demucs stem transcript dominated by a short repeated phrase", () => {
    const repeated = Array.from({ length: 28 }, (_, index): TranscriptSegment => ({
      id: `S${index + 1}`,
      start: index * 2,
      end: index * 2 + 2,
      text: "I'm trying to be",
      confidence: 0.72
    }));

    const report = assessVocalTranscript(repeated, "demucs");

    expect(report.status).toBe("failed");
    expect(report.dominantPhrase).toBe("im trying to be");
    expect(report.issues.join(" ")).toContain("repeated short phrase");
    expect(shouldRejectSeparatedStem(report)).toBe(true);
  });

  it("marks original audio fallback reports explicitly", () => {
    const rejected = assessVocalTranscript([
      { id: "S1", start: 0, end: 4, text: "I'm trying to be", confidence: 0.72 },
      { id: "S2", start: 4, end: 8, text: "I'm trying to be", confidence: 0.72 },
      { id: "S3", start: 8, end: 12, text: "I'm trying to be", confidence: 0.72 },
      { id: "S4", start: 12, end: 16, text: "I'm trying to be", confidence: 0.72 },
      { id: "S5", start: 16, end: 20, text: "I'm trying to be", confidence: 0.72 }
    ], "demucs");
    const selected = assessVocalTranscript([
      { id: "O1", start: 0, end: 4, text: "Talk to God wonder if he's mad or angry", confidence: 0.84 },
      { id: "O2", start: 4, end: 8, text: "Listen God I know I've been sinning lately", confidence: 0.82 }
    ], "original");

    const fallback = buildFallbackQualityReport(selected, rejected, "the Demucs stem repeated one phrase");

    expect(fallback.status).toBe("fallback_original");
    expect(fallback.fallbackUsed).toBe(true);
    expect(fallback.rejectedSource).toBe("demucs");
    expect(fallback.detail).toContain("original audio transcript selected");
  });
});
