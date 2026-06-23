import { describe, expect, it } from "vitest";
import { applyEditToComparison, applyLineJoin, buildReviewedVariants, dropJoinedLines, normalizePartialDate } from "./studio-utils";
import type { LineComparison, VariantCandidate } from "../../shared/types";

describe("normalizePartialDate", () => {
  it("canonicalizes a full date, padding single digits and unifying separators", () => {
    expect(normalizePartialDate("1993/9/1")).toBe("1993-09-01");
    expect(normalizePartialDate("2023-09-11")).toBe("2023-09-11");
  });

  it("allows a year-month with the day omitted", () => {
    expect(normalizePartialDate("2023-9")).toBe("2023-09");
    expect(normalizePartialDate("2023/09")).toBe("2023-09");
  });

  it("allows a bare year when that is all the reviewer remembers", () => {
    expect(normalizePartialDate("1993")).toBe("1993");
  });

  it("returns unparseable input trimmed and unchanged", () => {
    expect(normalizePartialDate("  not a date ")).toBe("not a date");
    expect(normalizePartialDate("")).toBe("");
  });
});

function comparison(overrides: Partial<LineComparison> = {}): LineComparison {
  return {
    id: "C1", start: 0, end: 4, liveText: "cape town carry this", similarity: 0.5, timingDelta: 0,
    status: "changed", changedWords: { kept: [], removed: [], added: [] }, ...overrides
  };
}

function variant(overrides: Partial<VariantCandidate> = {}): VariantCandidate {
  return {
    id: "V1", type: "city_shoutout", start: 4, end: 8, liveText: "cape town carry this",
    canonicalAlignmentReference: "L2", confidence: 0.8, impactNote: "", recommendedAction: "",
    translationRisk: "medium", severity: "high", evidenceSource: "asr_alignment", ...overrides
  };
}

describe("applyLineJoin", () => {
  it("merges the next line into the current line and marks it joined without placeholder text", () => {
    const result = applyLineJoin(
      { editedTexts: {}, joinedLineIds: {} },
      { id: "C1", liveText: "But it feels right where we are" },
      { id: "C2", liveText: "I'm falling deep in your arms" }
    );
    expect(result.editedTexts.C1).toBe("But it feels right where we are i'm falling deep in your arms");
    expect(result.joinedLineIds.C2).toBe(true);
    // The absorbed line carries no text of its own — no sentinel, no leftover edit.
    expect(result.editedTexts.C2).toBeUndefined();
  });

  it("chains a third line into the head without resurrecting placeholder text", () => {
    // This is the reported bug: join line 2 into line 1, then line 3 into the head.
    let state = applyLineJoin(
      { editedTexts: {}, joinedLineIds: {} },
      { id: "C1", liveText: "Line one" },
      { id: "C2", liveText: "Line two" }
    );
    state = applyLineJoin(
      state,
      { id: "C1", liveText: state.editedTexts.C1 },
      { id: "C3", liveText: "Line three" }
    );
    expect(state.editedTexts.C1).toBe("Line one line two line three");
    expect(state.joinedLineIds).toEqual({ C2: true, C3: true });
    // The old sentinel must never appear anywhere in the resulting state.
    expect(JSON.stringify(state)).not.toContain("joined with previous");
  });

  it("does not mutate the input state", () => {
    const original = { editedTexts: {}, joinedLineIds: {} };
    applyLineJoin(original, { id: "C1", liveText: "a" }, { id: "C2", liveText: "b" });
    expect(original).toEqual({ editedTexts: {}, joinedLineIds: {} });
  });
});

describe("dropJoinedLines", () => {
  it("removes rows whose id was joined into a previous line", () => {
    const rows = [{ id: "C1" }, { id: "C2" }, { id: "C3" }];
    expect(dropJoinedLines(rows, { C2: true }).map((row) => row.id)).toEqual(["C1", "C3"]);
  });

  it("returns every row when nothing is joined", () => {
    const rows = [{ id: "C1" }, { id: "C2" }];
    expect(dropJoinedLines(rows, {})).toHaveLength(2);
  });
});

describe("applyEditToComparison", () => {
  it("returns the same comparison object when there is no edit for it", () => {
    const row = comparison();
    expect(applyEditToComparison(row, {})).toBe(row);
  });

  it("applies the edited text and recomputes the word diff and status", () => {
    const row = comparison({ id: "C1", canonicalText: "carry this chorus through the avenue", liveText: "cape town carry this" });
    const result = applyEditToComparison(row, { C1: "carry this chorus through the avenue" });
    expect(result.liveText).toBe("carry this chorus through the avenue");
    // The correction now matches the canonical reference exactly: status flips to matched
    // and the stale "cape town" diff is gone.
    expect(result.status).toBe("matched");
    expect(result.changedWords.added).toEqual([]);
    expect(result.changedWords.removed).toEqual([]);
  });
});

describe("buildReviewedVariants", () => {
  it("rewrites a detected variant's live text from the edit made on its line", () => {
    const comparisons = [comparison({ id: "C2", variantId: "V1", canonicalText: "carry this chorus" })];
    const result = buildReviewedVariants([variant({ id: "V1", liveText: "cape town carry this" })], comparisons, { C2: "carry this chorus exactly as corrected" });
    expect(result[0].liveText).toBe("carry this chorus exactly as corrected");
  });

  it("leaves a variant untouched when its line was not edited", () => {
    const comparisons = [comparison({ id: "C2", variantId: "V1" })];
    const result = buildReviewedVariants([variant({ id: "V1", liveText: "original text" })], comparisons, {});
    expect(result[0].liveText).toBe("original text");
  });
});
