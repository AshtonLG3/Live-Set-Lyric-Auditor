import type { CanonicalSource, ClipSource, ConfidenceOverview, EventCandidate, EvidenceTier, LineComparison, LineComparisonStatus, LiveContext, LiveVariantPassport, PerformanceContext, RecordingMatchMethod, TrackCandidate, TranscriptSegment, VariantCandidate, VariantType, VocalQualityReport, WordDiff } from "../../shared/types";
import { APP_VERSION } from "../../shared/version";
import type { CanonicalLine } from "../data/fixtures";

export type AlignmentResult = {
  transcript: TranscriptSegment;
  canonical: CanonicalLine | null;
  similarity: number;
  timingDelta: number;
  rawTimingDelta: number;
  clipOffset: number;
};

const LOW_ASR_CONFIDENCE = 0.7;
const STRONG_ALIGNMENT = 0.72;
const MATCH_FLOOR = 0.2;

const citySignals = [
  "cape town",
  "berlin",
  "london",
  "new york",
  "los angeles",
  "nashville",
  "chicago",
  "paris",
  "tokyo",
  "toronto"
];

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(" ") : [];
}

export function tokenSimilarity(a: string, b: string): number {
  const leftTokens = tokenize(a);
  const rightTokens = tokenize(b);
  if (leftTokens.length === 0 && rightTokens.length === 0) return 1;
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  const jaccard = intersection / union;

  const lcsLen = longestCommonSubsequenceLength(leftTokens, rightTokens);
  const lcsRatio = lcsLen / Math.max(leftTokens.length, rightTokens.length);

  return round(jaccard * 0.6 + lcsRatio * 0.4);
}

function longestCommonSubsequenceLength(a: string[], b: string[]): number {
  const rows = a.length;
  const cols = b.length;
  let prev = new Array<number>(cols + 1).fill(0);
  let curr = new Array<number>(cols + 1).fill(0);
  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= cols; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[cols];
}

const PHONETIC_MISHEAR_FLOOR = 0.8;

const SOUNDEX_CODES: Record<string, string> = {
  b: "1", f: "1", p: "1", v: "1",
  c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2",
  d: "3", t: "3",
  l: "4",
  m: "5", n: "5",
  r: "6"
};

// Soundex phonetic code: homophones and near-homophones collapse to the same key
// ("their"/"there" -> T600), so a divergence that is textually different but
// phonetically identical reads as an ASR mishearing rather than a real change.
function soundex(word: string): string {
  const letters = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return "";
  let result = letters[0].toUpperCase();
  let previous = SOUNDEX_CODES[letters[0]] ?? "0";
  for (let i = 1; i < letters.length && result.length < 4; i += 1) {
    const code = SOUNDEX_CODES[letters[i]] ?? "0";
    if (code !== "0" && code !== previous) {
      result += code;
    }
    // h and w are transparent (do not reset the running code); vowels reset it.
    if (letters[i] !== "h" && letters[i] !== "w") {
      previous = code;
    }
  }
  return `${result}000`.slice(0, 4);
}

// Phonetic similarity in [0,1] over the Soundex token streams of two phrases.
// High here while token (spelling) similarity is low is the signature of a
// transcription mishearing, not a performed lyric change.
export function phoneticSimilarity(a: string, b: string): number {
  const left = tokenize(a).map(soundex).filter(Boolean);
  const right = tokenize(b).map(soundex).filter(Boolean);
  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((code) => rightSet.has(code)).length;
  const union = new Set([...left, ...right]).size;
  const jaccard = intersection / union;
  const lcsRatio = longestCommonSubsequenceLength(left, right) / Math.max(left.length, right.length);
  return round(jaccard * 0.5 + lcsRatio * 0.5);
}

function isLikelyMishear(status: LineComparisonStatus, phonetic?: number): boolean {
  return status === "changed" && typeof phonetic === "number" && phonetic >= PHONETIC_MISHEAR_FLOOR;
}

export function alignTranscript(
  transcript: TranscriptSegment[],
  canonicalLines: CanonicalLine[],
  timingReliable = true
): AlignmentResult[] {
  const assignments = alignMonotonic(transcript, canonicalLines);
  const rawAlignments = transcript.map((segment, index) => {
    const canonical = assignments[index] >= 0 ? canonicalLines[assignments[index]] : null;
    const similarity = canonical ? tokenSimilarity(segment.text, canonical.text) : 0;
    const rawTimingDelta = canonical ? Math.abs(segment.start - canonical.start) : 0;
    return {
      transcript: segment,
      canonical,
      similarity,
      timingDelta: rawTimingDelta,
      rawTimingDelta,
      clipOffset: 0
    };
  });

  if (!timingReliable) {
    // Canonical timestamps are fabricated (plain lyrics use index*4 spacing), so any
    // drift or clip-offset number would be noise. Report no timing signal instead of
    // a false one. Line matching itself is unaffected.
    return rawAlignments.map((alignment) => ({
      ...alignment,
      timingDelta: 0,
      rawTimingDelta: 0,
      clipOffset: 0
    }));
  }

  const anchorOffsets = rawAlignments
    .filter((alignment) =>
      alignment.canonical &&
      alignment.similarity >= STRONG_ALIGNMENT &&
      alignment.transcript.confidence >= LOW_ASR_CONFIDENCE
    )
    .map((alignment) => (alignment.canonical?.start ?? 0) - alignment.transcript.start);
  const clipOffset = round(anchorOffsets.length ? median(anchorOffsets) : 0);

  return rawAlignments.map((alignment) => {
    const timingDelta = alignment.canonical
      ? Math.abs(alignment.transcript.start + clipOffset - alignment.canonical.start)
      : 0;
    return {
      ...alignment,
      timingDelta: round(timingDelta),
      clipOffset
    };
  });
}

// Global, order-preserving alignment of live segments onto canonical lines.
// Each segment is matched to a canonical line whose index is non-decreasing across
// the clip (a chorus reprise stays in song order instead of snapping back to an
// earlier duplicate), repeats are allowed for sustained hooks, and weak matches are
// left unanchored as ad-libs. Maximizes total token similarity via dynamic
// programming rather than picking each segment's best line independently.
function alignMonotonic(transcript: TranscriptSegment[], canonicalLines: CanonicalLine[]): number[] {
  const segments = transcript.length;
  const lines = canonicalLines.length;
  if (segments === 0) return [];
  if (lines === 0) return new Array<number>(segments).fill(-1);

  const similarity = transcript.map((segment) =>
    canonicalLines.map((line) => tokenSimilarity(segment.text, line.text))
  );

  // best[i][cursor]: best score aligning segments i.. when only canonical indices
  // >= cursor remain available. choice[i][cursor]: canonical index chosen for
  // segment i (-1 = leave it unanchored). Leaving a segment unanchored earns
  // MATCH_FLOOR so a line is only claimed when its overlap clears the same bar the
  // previous greedy threshold used.
  const best: number[][] = Array.from({ length: segments + 1 }, () => new Array<number>(lines + 1).fill(0));
  const choice: number[][] = Array.from({ length: segments }, () => new Array<number>(lines + 1).fill(-1));

  for (let i = segments - 1; i >= 0; i -= 1) {
    for (let cursor = lines; cursor >= 0; cursor -= 1) {
      let bestScore = MATCH_FLOOR + best[i + 1][cursor];
      let bestChoice = -1;
      for (let line = cursor; line < lines; line += 1) {
        const score = similarity[i][line] + best[i + 1][line];
        if (score > bestScore) {
          bestScore = score;
          bestChoice = line;
        }
      }
      best[i][cursor] = bestScore;
      choice[i][cursor] = bestChoice;
    }
  }

  const assignments: number[] = [];
  let cursor = 0;
  for (let i = 0; i < segments; i += 1) {
    const line = choice[i][cursor];
    assignments.push(line);
    if (line >= 0) cursor = line;
  }
  return assignments;
}

export function classifyVariants(
  alignments: AlignmentResult[],
  canonicalLines: CanonicalLine[],
  sourceCoverage: number,
  eventCity?: string,
  clipDurationSeconds = Infinity
): VariantCandidate[] {
  const variants: VariantCandidate[] = [];
  const matchedCanonicalIds = new Set<string>();
  const canonicalIndexes = new Map(canonicalLines.map((line, index) => [line.id, index]));

  alignments.forEach((alignment, index) => {
    if (alignment.canonical) {
      matchedCanonicalIds.add(alignment.canonical.id);
    }

    const type = classifyAlignment(alignment, alignments[index - 1], eventCity);
    if (!type) {
      return;
    }

    const phonetic = alignment.canonical ? phoneticSimilarity(alignment.transcript.text, alignment.canonical.text) : undefined;
    // A substitution that is textually different but phonetically near-identical
    // is almost always the transcriber mishearing, not the artist changing words.
    // Demote its confidence and label it so a reviewer isn't sent chasing noise.
    const mishearable = type === "substitution" && typeof phonetic === "number" && phonetic >= PHONETIC_MISHEAR_FLOOR;
    const baseConfidence = scoreVariantConfidence(alignment.transcript.confidence, alignment.similarity, sourceCoverage, type);
    const confidence = mishearable ? round(baseConfidence * 0.6) : baseConfidence;
    const evidenceTier = mishearable ? "likely_mishear" : variantEvidenceTier(alignment, type, sourceCoverage);
    const reviewerNote = mishearable
      ? `Live and reference are ${Math.round((phonetic ?? 0) * 100)}% phonetically identical; likely an ASR mishearing rather than a performed change. Confirm by ear before flagging.`
      : reviewerNoteForVariant(alignment, type, evidenceTier);
    variants.push({
      id: `V${variants.length + 1}`,
      type,
      start: alignment.transcript.start,
      end: alignment.transcript.end,
      liveText: trimSnippet(alignment.transcript.text),
      canonicalAlignmentReference: alignment.canonical
        ? `${alignment.canonical.id} (${Math.round(alignment.similarity * 100)}% token overlap)`
        : "No stable canonical alignment",
      canonicalExcerpt: alignment.canonical ? trimSnippet(alignment.canonical.text) : undefined,
      confidence,
      impactNote: impactNote(type, confidence),
      recommendedAction: recommendedAction(type),
      translationRisk: translationRisk(type),
      severity: confidence >= 0.78 ? "high" : confidence >= 0.58 ? "medium" : "low",
      evidenceSource: "asr_alignment",
      evidenceTier,
      reviewerNote
    });
  });

  const skipped = skippedLinesWithinAnchoredWindow(canonicalLines, alignments, matchedCanonicalIds, canonicalIndexes, clipDurationSeconds);
  skipped.forEach((line) => {
    variants.push({
      id: `V${variants.length + 1}`,
      type: "skipped_line",
      start: line.start,
      end: line.end,
      liveText: "[not detected in live vocal]",
      canonicalAlignmentReference: `${line.id} (canonical line absent from aligned ASR)`,
      canonicalExcerpt: trimSnippet(line.text),
      confidence: round(0.58 * sourceCoverage),
      impactNote: "Potential caption or archive gap; queue for human review before marking as a confirmed omission.",
      recommendedAction: "Review live-only caption coverage and confirm the omission.",
      translationRisk: "high",
      severity: "medium",
      evidenceSource: "asr_alignment",
      evidenceTier: sourceCoverage < 0.5 ? "source_gap" : "needs_review",
      reviewerNote: "The line sits inside matched anchors, but it was not heard in the live ASR. Confirm by listening before marking it as a true omission."
    });
  });

  return variants;
}

function skippedLinesWithinAnchoredWindow(
  canonicalLines: CanonicalLine[],
  alignments: AlignmentResult[],
  matchedCanonicalIds: Set<string>,
  canonicalIndexes: Map<string, number>,
  clipDurationSeconds = Infinity
): CanonicalLine[] {
  const matchedIndexes = alignments
    .map((alignment) => alignment.canonical ? canonicalIndexes.get(alignment.canonical.id) : undefined)
    .filter((index): index is number => typeof index === "number");
  const uniqueIndexes = [...new Set(matchedIndexes)];
  if (uniqueIndexes.length < 2) {
    return [];
  }
  const min = Math.min(...uniqueIndexes);
  const max = Math.max(...uniqueIndexes);
  // A clip only covers ~clipDurationSeconds of the song from its first anchor.
  // A stray late match (e.g. a recurring hook) can stretch [min, max] across the
  // whole track, so without this bound the diff lists every unsung line to the
  // song's end as a phantom omission. Cap the window to the clip's actual reach.
  const hasCap = Number.isFinite(clipDurationSeconds) && clipDurationSeconds > 0;
  const windowEnd = hasCap ? canonicalLines[min].start + clipDurationSeconds : Infinity;
  return canonicalLines.filter((line, index) =>
    index >= min && index <= max && line.start <= windowEnd && !matchedCanonicalIds.has(line.id)
  );
}

export function buildLineComparisons(
  alignments: AlignmentResult[],
  canonicalLines: CanonicalLine[],
  variants: VariantCandidate[] = [],
  clipDurationSeconds = Infinity
): LineComparison[] {
  const canonicalIndexes = new Map(canonicalLines.map((line, index) => [line.id, index]));
  const matchedCanonicalIds = new Set(alignments.flatMap((alignment) => alignment.canonical ? [alignment.canonical.id] : []));
  const variantByLiveKey = new Map(
    variants
      .filter((variant) => variant.type !== "skipped_line")
      .map((variant) => [variantKey(variant.start, variant.end, variant.liveText), variant.id])
  );
  const skippedVariantByCanonicalId = new Map(
    variants
      .filter((variant) => variant.type === "skipped_line")
      .map((variant) => [variant.canonicalAlignmentReference.split(" ")[0], variant.id])
  );

  const liveComparisons = alignments.map((alignment, index): LineComparison => {
    const canonicalIndex = alignment.canonical ? canonicalIndexes.get(alignment.canonical.id) : undefined;
    const canonicalPrevious = typeof canonicalIndex === "number" ? canonicalLines[canonicalIndex - 1] : undefined;
    const canonicalNext = typeof canonicalIndex === "number" ? canonicalLines[canonicalIndex + 1] : undefined;
    const status = lineComparisonStatus(alignment, alignments[index - 1]);
    const phonetic = alignment.canonical ? phoneticSimilarity(alignment.transcript.text, alignment.canonical.text) : undefined;
    return {
      id: `C${index + 1}`,
      start: alignment.transcript.start,
      end: alignment.transcript.end,
      canonicalId: alignment.canonical?.id,
      canonicalText: alignment.canonical?.text,
      canonicalPreviousText: canonicalPrevious?.text,
      canonicalNextText: canonicalNext?.text,
      liveText: alignment.transcript.text,
      similarity: alignment.similarity,
      phoneticSimilarity: phonetic,
      timingDelta: alignment.timingDelta,
      rawTimingDelta: alignment.rawTimingDelta,
      clipOffset: alignment.clipOffset,
      status,
      changedWords: wordDiff(alignment.canonical?.text ?? "", alignment.transcript.text),
      evidenceTier: isLikelyMishear(status, phonetic) ? "likely_mishear" : lineEvidenceTier(alignment, status),
      variantId: variantByLiveKey.get(variantKey(alignment.transcript.start, alignment.transcript.end, trimSnippet(alignment.transcript.text)))
    };
  });

  const skipped = skippedLinesWithinAnchoredWindow(canonicalLines, alignments, matchedCanonicalIds, canonicalIndexes, clipDurationSeconds);
  const skippedComparisons = skipped.map((line, index): LineComparison => {
    const canonicalIndex = canonicalIndexes.get(line.id) ?? -1;
    return {
      id: `C${liveComparisons.length + index + 1}`,
      start: line.start,
      end: line.end,
      canonicalId: line.id,
      canonicalText: line.text,
      canonicalPreviousText: canonicalLines[canonicalIndex - 1]?.text,
      canonicalNextText: canonicalLines[canonicalIndex + 1]?.text,
      liveText: "[not detected in live vocal]",
      similarity: 0,
      timingDelta: 0,
      rawTimingDelta: 0,
      clipOffset: alignments[0]?.clipOffset ?? 0,
      status: "skipped",
      changedWords: wordDiff(line.text, ""),
      evidenceTier: "needs_review",
      variantId: skippedVariantByCanonicalId.get(line.id)
    };
  });

  return [...liveComparisons, ...skippedComparisons].sort((a, b) => a.start - b.start || statusSort(a.status) - statusSort(b.status));
}

function lineComparisonStatus(alignment: AlignmentResult, previous?: AlignmentResult): LineComparisonStatus {
  if (alignment.transcript.confidence < LOW_ASR_CONFIDENCE && alignment.similarity < 0.9) {
    return "uncertain";
  }
  if (!alignment.canonical) {
    return alignment.similarity >= 0.18 ? "uncertain" : "live_only";
  }
  if (previous?.canonical?.id === alignment.canonical.id && alignment.similarity >= 0.6) {
    return "repeated";
  }
  if (alignment.similarity >= 0.9 && alignment.timingDelta < 2.5) {
    return "matched";
  }
  if (alignment.similarity >= 0.7 && alignment.timingDelta >= 2.5) {
    return "timing_drift";
  }
  if (alignment.similarity >= 0.28) {
    return "changed";
  }
  return "uncertain";
}

function wordDiff(canonicalText: string, liveText: string): WordDiff {
  const canonicalTokens = tokenize(canonicalText);
  const liveTokens = tokenize(liveText);
  const table = lcsTable(canonicalTokens, liveTokens);
  const kept: string[] = [];
  const removed: string[] = [];
  const added: string[] = [];
  let i = canonicalTokens.length;
  let j = liveTokens.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && canonicalTokens[i - 1] === liveTokens[j - 1]) {
      kept.push(canonicalTokens[i - 1]);
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      added.push(liveTokens[j - 1]);
      j -= 1;
    } else {
      removed.push(canonicalTokens[i - 1]);
      i -= 1;
    }
  }

  return {
    kept: kept.reverse(),
    removed: removed.reverse(),
    added: added.reverse()
  };
}

function lcsTable(a: string[], b: string[]): number[][] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      table[row][col] = a[row - 1] === b[col - 1]
        ? table[row - 1][col - 1] + 1
        : Math.max(table[row - 1][col], table[row][col - 1]);
    }
  }
  return table;
}

function variantKey(start: number, end: number, liveText: string): string {
  return `${start.toFixed(1)}:${end.toFixed(1)}:${normalizeText(liveText)}`;
}

function statusSort(status: LineComparisonStatus): number {
  const order: Record<LineComparisonStatus, number> = {
    matched: 0,
    changed: 1,
    timing_drift: 2,
    repeated: 3,
    live_only: 4,
    skipped: 5,
    uncertain: 6
  };
  return order[status];
}

export function buildPassport(input: {
  id: string;
  track: TrackCandidate;
  event: EventCandidate | null;
  filename: string;
  durationSeconds: number;
  canonicalLines: CanonicalLine[];
  transcript: TranscriptSegment[];
  sourceCoverage: number;
  canonicalSource: CanonicalSource;
  restricted: boolean;
  language?: string;
  copyright?: string;
  trackingUrl?: string;
  matchMethod: RecordingMatchMethod;
  vocalIsolationSource: "lalalai" | "demucs" | "original" | "fixture";
  vocalIsolationConfidence: number;
  vocalQuality?: VocalQualityReport;
  asrSource: "replicate" | "external" | "fixture";
  asrEngine?: string;
  source: ClipSource;
  liveContext?: LiveContext | null;
  performanceContext?: PerformanceContext;
}): LiveVariantPassport {
  // Only richsync (real per-line ts) and LRC subtitles carry true performance
  // timing; plain lyrics fabricate index*4 spacing, so timing drift is suppressed
  // there to avoid reporting a confident number we know is invented.
  const timingReliable = input.canonicalSource !== "lyrics" && input.canonicalSource !== "metadata-only";
  const alignments = alignTranscript(input.transcript, input.canonicalLines, timingReliable);
  const averageAlignment = average(alignments.map((alignment) => alignment.similarity));
  const averageAsr = average(input.transcript.map((segment) => segment.confidence));
  const averageTimingDelta = average(alignments.filter((alignment) => alignment.canonical).map((alignment) => alignment.timingDelta));
  const confidenceOverview: ConfidenceOverview = {
    overall: round((averageAlignment * 0.4 + averageAsr * 0.3 + input.vocalIsolationConfidence * 0.15 + input.sourceCoverage * 0.15) || 0),
    asr: round(averageAsr),
    alignment: round(averageAlignment),
    sourceCoverage: round(input.sourceCoverage),
    asrUncertainSegments: input.transcript.filter((segment) => segment.confidence < LOW_ASR_CONFIDENCE).length,
    timingOffsetSeconds: alignments[0]?.clipOffset ?? 0,
    averageTimingDelta: round(averageTimingDelta)
  };

  const variants = classifyVariants(alignments, input.canonicalLines, confidenceOverview.sourceCoverage, input.event?.city, input.durationSeconds);
  const lineComparisons = buildLineComparisons(alignments, input.canonicalLines, variants, input.durationSeconds);
  const summary = summarizePassport(variants, confidenceOverview.overall);
  const syncFitScore = round(averageAlignment * 0.72 + input.sourceCoverage * 0.28);
  const versionConfidence = scoreVersionConfidence(input.track, input.matchMethod, input.canonicalSource);

  return {
    id: input.id,
    createdAt: new Date().toISOString(),
    version: APP_VERSION,
    track: input.track,
    event: input.event,
    clip: {
      filename: input.filename,
      durationSeconds: input.durationSeconds,
      vocalIsolationSource: input.vocalIsolationSource,
      vocalIsolationConfidence: input.vocalIsolationConfidence,
      vocalQuality: input.vocalQuality,
      asrSource: input.asrSource,
      asrEngine: input.asrEngine,
      transcript: input.transcript,
      source: input.source
    },
    summary,
    liveContext: input.liveContext ?? null,
    performanceContext: input.performanceContext ?? {
      source: "fixture",
      status: "fallback",
      energyLevel: 0.5,
      dominantEmotions: [],
      instruments: [],
      arrangement: "uncertain",
      summary: "Performance profiling was unavailable for this source.",
      confidence: 0.4
    },
    recordingIdentity: {
      trackId: input.track.id,
      commonTrackId: input.track.commonTrackId,
      isrc: input.track.isrc,
      matchMethod: input.matchMethod,
      versionConfidence,
      syncFitScore,
      canonicalSource: input.canonicalSource
    },
    rights: {
      status: input.canonicalSource === "fixture"
        ? "fixture"
        : input.restricted
          ? "restricted"
          : input.canonicalSource === "metadata-only"
            ? "metadata_only"
            : "display_allowed",
      language: input.language ?? input.track.language,
      copyright: input.copyright,
      attribution: "Lyrics powered by Musixmatch",
      trackingRequired: Boolean(input.trackingUrl)
    },
    structureMap: buildStructureMap(variants),
    confidenceOverview,
    lineComparisons,
    variants,
    complianceNotes: [
      "Musixmatch lyric/subtitle content is used only as an in-memory analysis reference.",
      input.restricted
        ? "Canonical lyric display is restricted for this track; reference panels remain metadata-only."
        : "Short cached reference excerpts are included for reviewer display under the configured lyric terms.",
      "The passport stores variant metadata, timestamps, reviewer notes, and cached excerpts needed for audit review.",
      "Uploaded clip buffers are processed in memory for this MVP and are not written to persistent storage.",
      input.source.processingMode === "reference_fixture"
        ? "The linked performance is preserved as evidence and previewed through its provider; provider audio is not downloaded."
        : input.source.processingMode === "provider_excerpt"
          ? "Only the selected provider time range was temporarily extracted for analysis and deleted immediately after loading into memory."
        : "Source media was supplied directly by the user for this analysis.",
      input.performanceContext?.source === "cyanite"
        ? "Configured Cyanite analysis contributes derived energy, mood, BPM, and arrangement metadata."
        : "Performance context uses a labeled fallback profile when Cyanite analysis is unavailable.",
      input.asrEngine
        ? `ASR engine selected by transcript quality gate: ${input.asrEngine}.`
        : "ASR engine was not reported by the configured transcription provider.",
      input.vocalQuality?.fallbackUsed
        ? input.vocalQuality.detail
        : input.vocalIsolationSource === "lalalai"
          ? "Configured LALAL.AI vocal isolation supplied the transcription stem."
          : input.vocalIsolationSource === "demucs"
            ? "Configured Replicate Demucs vocal isolation supplied the transcription stem."
            : input.vocalIsolationSource === "original"
              ? "Vocal isolation was unavailable or rejected, so transcription used the original user-supplied audio."
              : "Fixture isolation metadata was used for the labeled fallback run."
    ]
  };
}

function classifyAlignment(alignment: AlignmentResult, previous?: AlignmentResult, eventCity?: string): VariantType | null {
  const normalized = normalizeText(alignment.transcript.text);
  const tokens = tokenize(alignment.transcript.text);
  const canonicalTokens = alignment.canonical ? tokenize(alignment.canonical.text) : [];
  const extraTokens = tokens.filter((token) => !canonicalTokens.includes(token));
  const duration = alignment.transcript.end - alignment.transcript.start;
  const weaklyAnchored = !alignment.canonical || alignment.similarity < 0.5;

  if (alignment.transcript.confidence < LOW_ASR_CONFIDENCE && alignment.similarity < 0.9) {
    return "uncertain";
  }
  if (citySignalSet(eventCity).some((city) => normalized.includes(city))) {
    return "city_shoutout";
  }
  if (weaklyAnchored && matchesCrowdSignal(normalized, tokens)) {
    return "crowd_response";
  }
  if (!alignment.canonical || alignment.similarity < 0.28) {
    // A sustained unmatched lyric line is a snippet of another song (medley /
    // interpolation); a short unmatched burst is an ad-lib.
    return tokens.length >= 5 ? "interpolation" : "adlib";
  }
  if (previous?.canonical?.id === alignment.canonical.id && alignment.similarity >= 0.6) {
    return "repeated_hook";
  }
  if (containsRepeatedPhrase(tokens)) {
    return "repeated_hook";
  }
  if (hasProfanitySwap(tokens, canonicalTokens)) {
    return "censored";
  }
  if (alignment.similarity >= 0.7 && alignment.timingDelta >= 2.5) {
    return "timing_drift";
  }
  if (alignment.similarity < 0.72 && extraTokens.length >= 1) {
    return "substitution";
  }
  if (duration >= 4.5 && extraTokens.length >= 1) {
    return "extension";
  }
  return null;
}

function citySignalSet(eventCity?: string): string[] {
  const eventSignal = eventCity ? normalizeText(eventCity) : "";
  return [...new Set([...citySignals, eventSignal].filter(Boolean))];
}

const crowdSignals = [
  "make some noise",
  "put your hands up",
  "hands up",
  "let me hear you",
  "let me hear ya",
  "clap your hands",
  "sing along",
  "are you ready",
  "scream"
];

// Audience-directed call-and-response, including a dominant repeated chant
// ("hey hey hey"). Only meaningful when the line is not a solid canonical match.
function matchesCrowdSignal(normalized: string, tokens: string[]): boolean {
  if (crowdSignals.some((phrase) => normalized.includes(phrase))) {
    return true;
  }
  if (tokens.length >= 3) {
    const counts = new Map<string, number>();
    for (const token of tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    const dominant = Math.max(...counts.values());
    if (dominant >= 3 && dominant / tokens.length >= 0.6) {
      return true;
    }
  }
  return false;
}

const profanityWords = new Set([
  "damn", "goddamn", "hell", "ass", "shit", "bullshit", "bitch", "bastard",
  "fuck", "fucking", "fuckin", "motherfucker", "dick", "pussy", "nigga", "nigger"
]);

// A profanity present on exactly one side of an otherwise-matched line is a
// clean<->explicit swap (radio edit or live self-censoring), not a generic
// word substitution.
function hasProfanitySwap(liveTokens: string[], canonicalTokens: string[]): boolean {
  const live = new Set(liveTokens);
  const canonical = new Set(canonicalTokens);
  const liveOnly = [...live].some((token) => profanityWords.has(token) && !canonical.has(token));
  const canonicalOnly = [...canonical].some((token) => profanityWords.has(token) && !live.has(token));
  return liveOnly || canonicalOnly;
}

function variantEvidenceTier(alignment: AlignmentResult, type: VariantType, sourceCoverage: number): EvidenceTier {
  if (sourceCoverage < 0.45 || (!alignment.canonical && alignment.similarity < 0.18)) {
    return "source_gap";
  }
  if (alignment.transcript.confidence < LOW_ASR_CONFIDENCE || type === "uncertain") {
    return "asr_uncertain";
  }
  if (alignment.similarity >= STRONG_ALIGNMENT && alignment.transcript.confidence >= 0.76) {
    return "likely_change";
  }
  return "needs_review";
}

function lineEvidenceTier(alignment: AlignmentResult, status: LineComparisonStatus): EvidenceTier {
  if (status === "matched") {
    return "aligned";
  }
  if (alignment.transcript.confidence < LOW_ASR_CONFIDENCE || status === "uncertain") {
    return "asr_uncertain";
  }
  if (!alignment.canonical && status === "live_only") {
    return "source_gap";
  }
  if (status === "changed" || status === "timing_drift" || status === "repeated") {
    return "likely_change";
  }
  return "needs_review";
}

function reviewerNoteForVariant(alignment: AlignmentResult, type: VariantType, evidenceTier: EvidenceTier): string | undefined {
  if (evidenceTier === "asr_uncertain") {
    return `ASR confidence is ${Math.round(alignment.transcript.confidence * 100)}%; do not treat this as a confirmed lyric change until a reviewer hears the clip.`;
  }
  if (type === "timing_drift") {
    return `Timing drift is measured after applying a ${formatSignedSeconds(alignment.clipOffset)} clip offset from aligned anchors.`;
  }
  if (evidenceTier === "source_gap") {
    return "Source coverage is thin here; keep this as an evidence gap until a stronger anchor is available.";
  }
  return undefined;
}

function scoreVariantConfidence(asr: number, similarity: number, sourceCoverage: number, type: VariantType): number {
  const typeBoost: Record<VariantType, number> = {
    substitution: 0.02,
    skipped_line: -0.08,
    repeated_hook: 0.06,
    extension: 0.03,
    city_shoutout: 0.1,
    crowd_response: 0.07,
    interpolation: 0.0,
    censored: 0.04,
    adlib: -0.02,
    timing_drift: 0.02,
    uncertain: -0.18
  };
  const base = asr * 0.44 + Math.max(1 - Math.abs(0.58 - similarity), 0.2) * 0.32 + sourceCoverage * 0.24;
  return round(Math.max(0.22, Math.min(0.96, base + typeBoost[type])));
}

function impactNote(type: VariantType, confidence: number): string {
  const qualifier = confidence >= 0.78 ? "High-priority" : confidence >= 0.58 ? "Reviewable" : "Low-confidence";
  const notes: Record<VariantType, string> = {
    substitution: "word-level difference that may affect lyric QA, captions, or archive transcription.",
    skipped_line: "possible omitted studio line that needs human confirmation.",
    repeated_hook: "repeated hook or phrase that may change caption timing and fan-facing summaries.",
    extension: "extended phrase or added tag that may require live-only caption coverage.",
    city_shoutout: "location-specific live change useful for event metadata and fan experiences.",
    crowd_response: "audience response or call-and-response moment missing from automated transcription.",
    interpolation: "snippet of another song woven into the performance; flag for medley/interpolation handling and separate rights review.",
    censored: "explicit/clean word swap (radio-style edit or live self-censoring) that matters for lyric QA and the right rights version.",
    adlib: "unmatched vocal phrase likely outside the canonical lyric reference.",
    timing_drift: "timing offset that can affect subtitle alignment.",
    uncertain: "weak signal that should remain in review rather than automation."
  };
  return `${qualifier}: ${notes[type]}`;
}

function recommendedAction(type: VariantType): string {
  const actions: Record<VariantType, string> = {
    substitution: "Review lyric wording and downstream translations.",
    skipped_line: "Confirm omission and update live-caption coverage.",
    repeated_hook: "Extend live subtitle timing; canonical lyric can remain unchanged.",
    extension: "Add a live-only caption segment or alternate-version note.",
    city_shoutout: "Attach event-specific metadata; no canonical lyric edit required.",
    crowd_response: "Add as an audience-response caption or live-performance annotation.",
    interpolation: "Tag as an interpolation/medley and identify the source song separately.",
    censored: "Confirm the clean/explicit swap and route it to the correct lyric version.",
    adlib: "Mark as live ad-lib after human review.",
    timing_drift: "Review RichSync timing against the performance tempo.",
    uncertain: "Keep in the review queue and avoid automated edits."
  };
  return actions[type];
}

function translationRisk(type: VariantType): VariantCandidate["translationRisk"] {
  if (type === "substitution" || type === "skipped_line" || type === "censored") return "high";
  if (type === "city_shoutout" || type === "crowd_response" || type === "extension" || type === "adlib" || type === "interpolation") return "medium";
  return "low";
}

function scoreVersionConfidence(
  track: TrackCandidate,
  matchMethod: RecordingMatchMethod,
  canonicalSource: CanonicalSource
): number {
  const identitySignals = [track.id, track.commonTrackId, track.isrc, track.album].filter(Boolean).length / 4;
  const sourceBoost = canonicalSource === "richsync" ? 1 : canonicalSource === "subtitles" ? 0.88 : canonicalSource === "lyrics" ? 0.72 : 0.48;
  const methodBoost = matchMethod === "selected_track"
    ? 0.94
    : matchMethod === "audio_identify"
      ? 0.91
      : matchMethod === "recall_rescue"
        ? 0.86
        : matchMethod === "lyrics_rescue"
          ? 0.82
          : 0.78;
  return round(identitySignals * 0.38 + sourceBoost * 0.34 + methodBoost * 0.28);
}

function buildStructureMap(variants: VariantCandidate[]): LiveVariantPassport["structureMap"] {
  const liveChanges = variants
    .filter((variant) => variant.confidence >= 0.5)
    .sort((a, b) => a.start - b.start)
    .map((variant) => structureLabel(variant.type));
  return {
    canonical: ["Opening", "Verse passage", "Hook", "Late section", "Final hook"],
    live: ["Live opening", ...liveChanges, "Live close"]
  };
}

function structureLabel(type: VariantType): string {
  const labels: Record<VariantType, string> = {
    substitution: "Changed lyric",
    skipped_line: "Skipped line",
    repeated_hook: "Hook repeat",
    extension: "Extended phrase",
    city_shoutout: "City shoutout",
    crowd_response: "Crowd response",
    interpolation: "Interpolation",
    censored: "Censored swap",
    adlib: "Ad-lib",
    timing_drift: "Tempo drift",
    uncertain: "Uncertain section"
  };
  return labels[type];
}

function summarizePassport(variants: VariantCandidate[], overall: number): string {
  const prominent = summarizeVariantTypes(variants
    .filter((variant) => variant.confidence >= 0.58)
    .slice(0, 6));
  const asrUncertain = variants.filter((variant) => variant.evidenceTier === "asr_uncertain").length;
  if (!prominent) {
    return `No strong live lyric variants detected. Overall confidence ${Math.round(overall * 100)}%.`;
  }
  return `Detected ${variants.length} live variant candidates, led by ${prominent}. Overall confidence ${Math.round(overall * 100)}%.${asrUncertain ? ` ${asrUncertain} held as ASR-uncertain.` : ""}`;
}

function summarizeVariantTypes(variants: VariantCandidate[]): string {
  const counts = new Map<VariantType, number>();
  variants.forEach((variant) => counts.set(variant.type, (counts.get(variant.type) ?? 0) + 1));
  return [...counts.entries()]
    .map(([type, count]) => count === 1 ? type.replace("_", " ") : `${count} ${type.replace("_", " ")} candidates`)
    .join(", ");
}

function containsRepeatedPhrase(tokens: string[]): boolean {
  if (tokens.length < 6) {
    return false;
  }
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index + size * 2 <= tokens.length; index += 1) {
      const first = tokens.slice(index, index + size).join(" ");
      const second = tokens.slice(index + size, index + size * 2).join(" ");
      if (first === second) {
        return true;
      }
    }
  }
  return false;
}

function trimSnippet(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatSignedSeconds(value: number): string {
  if (value === 0) {
    return "0.0s";
  }
  return `${value > 0 ? "+" : ""}${Math.round(value * 10) / 10}s`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
