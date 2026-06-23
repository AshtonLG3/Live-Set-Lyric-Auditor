import type { EvidenceTier, LineComparison, LineComparisonStatus, VariantCandidate, VariantType, WordDiff } from "../../shared/types";

export type FilterMode = "all" | "performance" | "risk";
export type ReviewDecision = "approved" | "rejected";
export type ReviewDecisions = Partial<Record<string, ReviewDecision>>;

export function matchesFilter(variant: VariantCandidate, filter: FilterMode) {
  if (filter === "all") return true;
  if (filter === "risk") return variant.confidence < 0.7 || variant.translationRisk === "high" || variant.type === "uncertain" || variant.type === "skipped_line";
  return ["adlib", "city_shoutout", "crowd_response", "extension", "repeated_hook", "timing_drift", "interpolation", "censored", "code_switching"].includes(variant.type);
}

export function filterDescription(filter: FilterMode) {
  if (filter === "performance") return "live-performance changes";
  if (filter === "risk") return "candidates needing focused review";
  return "all detected candidates";
}

export function riskMessage(variants: VariantCandidate[]) {
  const risky = variants.filter((variant) => matchesFilter(variant, "risk"));
  return risky.length ? `${risky.length} candidate${risky.length === 1 ? "" : "s"} need focused review before export.` : "No high-risk candidates detected in the current comparison.";
}

export function formatSourceMode(value: string) {
  if (value.includes("fixture")) return "Fixture Fallback";
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatRecordingId(value: string) {
  return value.replace(/^fixture-/i, "fallback-").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

export function formatOffset(value: number) {
  return `00:${formatTime(value)}`;
}

export function formatSignedSeconds(value?: number) {
  const normalized = value ?? 0;
  if (Math.abs(normalized) < 0.05) return "0.0s";
  return `${normalized > 0 ? "+" : ""}${(Math.round(normalized * 10) / 10).toFixed(1)}s`;
}

export function formatSetlistPosition(position?: number, songCount?: number) {
  return position ? `${position}${songCount ? ` of ${songCount}` : ""}` : "Not confirmed";
}

export function tokenizeLocal(value: string) {
  return value.toLowerCase().replace(/[''`]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "track";
}

export function parseTimecode(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return Number.NaN;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return Number.NaN;
}

export function manualVariantToComparison(variant: VariantCandidate): LineComparison {
  return {
    id: `manual-comparison-${variant.id}`,
    start: variant.start,
    end: variant.end,
    canonicalText: variant.canonicalExcerpt,
    liveText: variant.liveText,
    similarity: 0,
    timingDelta: 0,
    status: variant.type === "timing_drift" ? "timing_drift" : "live_only",
    changedWords: {
      kept: [],
      removed: tokenizeLocal(variant.canonicalExcerpt ?? ""),
      added: tokenizeLocal(variant.liveText)
    },
    evidenceTier: variant.evidenceTier ?? "needs_review",
    variantId: variant.id
  };
}

export type LineEditState = {
  editedTexts: Record<string, string>;
  joinedLineIds: Record<string, true>;
};

export function lowercaseFirstLetter(value: string): string {
  return value.replace(/[A-Za-z]/, (letter) => letter.toLowerCase());
}

// Merge `next` into `current`: append next's text to current's and record next's id as
// joined-away. The absorbed line keeps NO text of its own — joins are tracked as structure
// (joinedLineIds), never as a placeholder string smuggled into editedTexts. That is what lets
// chained joins and exports stay clean: there is no sentinel to concatenate or leak.
// Returns new state; the input is left untouched.
export function applyLineJoin(
  state: LineEditState,
  current: { id: string; liveText: string },
  next: { id: string; liveText: string }
): LineEditState {
  const currentText = state.editedTexts[current.id] ?? current.liveText;
  const nextText = state.editedTexts[next.id] ?? next.liveText;
  const merged = `${currentText.trim()} ${lowercaseFirstLetter(nextText.trim())}`.replace(/\s+/g, " ").trim();
  const editedTexts = { ...state.editedTexts, [current.id]: merged };
  delete editedTexts[next.id];
  return {
    editedTexts,
    joinedLineIds: { ...state.joinedLineIds, [next.id]: true }
  };
}

// Remove rows that have been merged into a previous line, so merged-away lines never render
// as editable rows, never feed the diff counts, and never reach an export.
export function dropJoinedLines<T extends { id: string }>(rows: T[], joinedLineIds: Record<string, true>): T[] {
  return rows.filter((row) => !joinedLineIds[row.id]);
}

// Canonicalize a partial show date a reviewer typed into "YYYY", "YYYY-MM", or "YYYY-MM-DD"
// (zero-padded; "/" or "-" separators accepted). The day — and even the month — are optional,
// because exact show dates are hard to recall; JamBase event search prefix-matches these, so a
// month is enough to find the show. Unparseable input is returned trimmed and unchanged.
export function normalizePartialDate(value: string): string {
  const parts = value.trim().split(/[/.\s-]+/).filter(Boolean);
  const [year, month, day] = parts;
  if (!year || !/^\d{4}$/.test(year)) {
    return value.trim();
  }
  const segments = [year];
  if (month) segments.push(String(month).padStart(2, "0"));
  if (month && day) segments.push(String(day).padStart(2, "0"));
  return segments.join("-");
}

// Apply a reviewer's text edit to a single comparison: replace the live text, recompute the
// word-level diff, and re-derive the status. This is the ONE place an edit is applied to a row,
// so the on-screen diff and the exported passport can never drift apart. No edit -> same object.
export function applyEditToComparison(comparison: LineComparison, editedTexts: Record<string, string>): LineComparison {
  const edited = editedTexts[comparison.id];
  if (!edited || edited === comparison.liveText) return comparison;
  const changedWords = wordDiffSummary(comparison.canonicalText ?? "", edited);
  const hasChanges = changedWords.removed.length > 0 || changedWords.added.length > 0;
  const status: LineComparisonStatus = !comparison.canonicalText ? comparison.status : hasChanges ? "changed" : "matched";
  return { ...comparison, liveText: edited, status, changedWords };
}

// Corrected comparison rows for display or export: merged-away lines dropped, every remaining
// row's edit applied (text + diff + status).
export function buildReviewedComparisons(
  lineComparisons: LineComparison[],
  editedTexts: Record<string, string>,
  joinedLineIds: Record<string, true>
): LineComparison[] {
  return dropJoinedLines(lineComparisons, joinedLineIds).map((comparison) => applyEditToComparison(comparison, editedTexts));
}

// A detected variant carries its own copy of the live text, so an edit on the variant's line
// must be mirrored onto the variant or the exported findings keep the original ASR wording.
export function buildReviewedVariants(
  variants: VariantCandidate[],
  lineComparisons: LineComparison[],
  editedTexts: Record<string, string>
): VariantCandidate[] {
  return variants.map((variant) => {
    const comparison = lineComparisons.find((line) => line.variantId === variant.id);
    const edited = comparison ? editedTexts[comparison.id] : undefined;
    return edited && edited !== variant.liveText ? { ...variant, liveText: edited } : variant;
  });
}

export function summarizeComparisons(comparisons: LineComparison[]) {
  return {
    matched: comparisons.filter((comparison) => comparison.status === "matched").length,
    changed: comparisons.filter((comparison) => comparison.status === "changed" || comparison.status === "repeated").length,
    liveOnly: comparisons.filter((comparison) => comparison.status === "live_only" || comparison.status === "uncertain").length,
    skipped: comparisons.filter((comparison) => comparison.status === "skipped").length,
    timing: comparisons.filter((comparison) => comparison.status === "timing_drift").length
  };
}

export function comparisonStatusOrder(status: LineComparisonStatus): number {
  const order: Record<LineComparisonStatus, number> = {
    matched: 0, changed: 1, timing_drift: 2, repeated: 3, live_only: 4, skipped: 5, uncertain: 6
  };
  return order[status];
}

export function formatComparisonStatus(status: LineComparisonStatus) {
  const labels: Record<LineComparisonStatus, string> = {
    matched: "Matched", changed: "Changed", skipped: "Skipped studio line", repeated: "Repeated live line",
    live_only: "Live-only", timing_drift: "Timing drift", uncertain: "Uncertain"
  };
  return labels[status];
}

export function differenceSummary(comparison: LineComparison) {
  if (comparison.evidenceTier === "asr_uncertain") return "ASR confidence needs review";
  if (comparison.status === "matched") return "No lyric difference";
  if (comparison.status === "skipped") return "Studio line not detected live";
  if (comparison.status === "live_only") return "Live phrase has no stable studio anchor";
  if (comparison.status === "timing_drift") return `${Math.round(comparison.timingDelta * 10) / 10}s timing offset`;
  const removed = comparison.changedWords.removed.slice(0, 4).join(" ");
  const added = comparison.changedWords.added.slice(0, 4).join(" ");
  if (removed && added) return `${removed} -> ${added}`;
  if (removed) return `Removed: ${removed}`;
  if (added) return `Added: ${added}`;
  return `${Math.round(comparison.similarity * 100)}% word overlap`;
}

export function comparisonExplanation(comparison: LineComparison) {
  if (comparison.evidenceTier === "asr_uncertain") return "ASR confidence is too low to call this a confirmed lyric change without listening review.";
  if (comparison.status === "matched") return "The live line matches the studio reference closely, so it proves alignment rather than a variant.";
  if (comparison.status === "changed") return "The live wording differs from the studio reference and should be reviewed as a possible live lyric variant.";
  if (comparison.status === "skipped") return "A studio line inside the anchored window was not detected in the live vocal.";
  if (comparison.status === "repeated") return "The live performance repeats a previously matched studio line.";
  if (comparison.status === "live_only") return "This live phrase has no stable studio anchor and may be an ad-lib, crowd response, or manual addition.";
  if (comparison.status === "timing_drift") return "The words match closely, but the timing differs enough to affect subtitle alignment.";
  return "The alignment is weak, so keep this row in human review before treating it as a confirmed difference.";
}

export function variantBadgeLabel(type: VariantType) {
  return type.replaceAll("_", " ");
}

export function formatEvidenceTier(tier?: EvidenceTier) {
  const labels: Record<EvidenceTier, string> = {
    aligned: "Aligned evidence",
    likely_change: "Likely change",
    likely_mishear: "Likely mishear",
    needs_review: "Needs review",
    asr_uncertain: "ASR uncertain",
    source_gap: "Source gap"
  };
  return tier ? labels[tier] : "Needs review";
}

export function wordDiffSummary(canonicalText: string, liveText: string): WordDiff {
  const diff = computeInlineWordDiff(canonicalText, liveText);
  return {
    kept: diff.studio.filter((word) => word.type === "kept").flatMap((word) => tokenizeLocal(word.word)),
    removed: diff.studio.filter((word) => word.type === "removed").flatMap((word) => tokenizeLocal(word.word)),
    added: diff.live.filter((word) => word.type === "added").flatMap((word) => tokenizeLocal(word.word))
  };
}

export type DiffWord = { word: string; type: "kept" | "removed" | "added" };

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[''`]/g, "").replace(/[^a-z0-9]/g, "");
}

export function computeInlineWordDiff(canonicalText: string, liveText: string): { studio: DiffWord[]; live: DiffWord[] } {
  const aWords = splitWords(canonicalText);
  const bWords = splitWords(liveText);
  if (aWords.length === 0 && bWords.length === 0) return { studio: [], live: [] };
  if (aWords.length === 0) return { studio: [], live: bWords.map((w) => ({ word: w, type: "added" })) };
  if (bWords.length === 0) return { studio: aWords.map((w) => ({ word: w, type: "removed" })), live: [] };

  const aNorm = aWords.map(normalizeWord);
  const bNorm = bWords.map(normalizeWord);
  const lcs = lcsTable(aNorm, bNorm);
  const studioStack: DiffWord[] = [];
  const liveStack: DiffWord[] = [];
  let i = aNorm.length;
  let j = bNorm.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aNorm[i - 1] === bNorm[j - 1]) {
      studioStack.push({ word: aWords[i - 1], type: "kept" });
      liveStack.push({ word: bWords[j - 1], type: "kept" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      liveStack.push({ word: bWords[j - 1], type: "added" });
      j--;
    } else {
      studioStack.push({ word: aWords[i - 1], type: "removed" });
      i--;
    }
  }

  studioStack.reverse();
  liveStack.reverse();
  return { studio: studioStack, live: liveStack };
}

function lcsTable(a: string[], b: string[]): number[][] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      table[i][j] = a[i - 1] === b[j - 1] ? table[i - 1][j - 1] + 1 : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table;
}
