import type { ConfidenceOverview, EventCandidate, LiveVariantPassport, TrackCandidate, TranscriptSegment, VariantCandidate, VariantType } from "../../shared/types";
import { APP_VERSION } from "../../shared/version";
import type { CanonicalLine } from "../data/fixtures";

export type AlignmentResult = {
  transcript: TranscriptSegment;
  canonical: CanonicalLine | null;
  similarity: number;
  timingDelta: number;
};

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
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return round(intersection / union);
}

export function alignTranscript(transcript: TranscriptSegment[], canonicalLines: CanonicalLine[]): AlignmentResult[] {
  return transcript.map((segment) => {
    const scored = canonicalLines
      .map((line) => ({
        line,
        similarity: tokenSimilarity(segment.text, line.text),
        timingDelta: Math.abs(segment.start - line.start)
      }))
      .sort((a, b) => b.similarity - a.similarity || a.timingDelta - b.timingDelta);

    const best = scored[0];
    return {
      transcript: segment,
      canonical: best && best.similarity >= 0.2 ? best.line : null,
      similarity: best?.similarity ?? 0,
      timingDelta: best?.timingDelta ?? 0
    };
  });
}

export function classifyVariants(
  alignments: AlignmentResult[],
  canonicalLines: CanonicalLine[],
  sourceCoverage: number
): VariantCandidate[] {
  const variants: VariantCandidate[] = [];
  const matchedCanonicalIds = new Set<string>();

  alignments.forEach((alignment, index) => {
    if (alignment.canonical) {
      matchedCanonicalIds.add(alignment.canonical.id);
    }

    const type = classifyAlignment(alignment, alignments[index - 1]);
    if (!type) {
      return;
    }

    const confidence = scoreVariantConfidence(alignment.transcript.confidence, alignment.similarity, sourceCoverage, type);
    variants.push({
      id: `V${variants.length + 1}`,
      type,
      start: alignment.transcript.start,
      end: alignment.transcript.end,
      liveText: trimSnippet(alignment.transcript.text),
      canonicalAlignmentReference: alignment.canonical
        ? `${alignment.canonical.id} (${Math.round(alignment.similarity * 100)}% token overlap)`
        : "No stable canonical alignment",
      confidence,
      impactNote: impactNote(type, confidence),
      severity: confidence >= 0.78 ? "high" : confidence >= 0.58 ? "medium" : "low"
    });
  });

  const skipped = canonicalLines.filter((line) => !matchedCanonicalIds.has(line.id));
  skipped.slice(0, 2).forEach((line) => {
    variants.push({
      id: `V${variants.length + 1}`,
      type: "skipped_line",
      start: line.start,
      end: line.end,
      liveText: "[not detected in live vocal]",
      canonicalAlignmentReference: `${line.id} (canonical line absent from aligned ASR)`,
      confidence: round(0.58 * sourceCoverage),
      impactNote: "Potential caption or archive gap; queue for human review before marking as a confirmed omission.",
      severity: "medium"
    });
  });

  return variants;
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
  vocalIsolationSource: "lalalai" | "fixture";
  vocalIsolationConfidence: number;
  asrSource: "external" | "fixture";
}): LiveVariantPassport {
  const alignments = alignTranscript(input.transcript, input.canonicalLines);
  const averageAlignment = average(alignments.map((alignment) => alignment.similarity));
  const averageAsr = average(input.transcript.map((segment) => segment.confidence));
  const confidenceOverview: ConfidenceOverview = {
    overall: round((averageAlignment * 0.4 + averageAsr * 0.3 + input.vocalIsolationConfidence * 0.15 + input.sourceCoverage * 0.15) || 0),
    asr: round(averageAsr),
    alignment: round(averageAlignment),
    sourceCoverage: round(input.sourceCoverage)
  };

  const variants = classifyVariants(alignments, input.canonicalLines, confidenceOverview.sourceCoverage);
  const summary = summarizePassport(variants, confidenceOverview.overall);

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
      asrSource: input.asrSource
    },
    summary,
    confidenceOverview,
    variants,
    complianceNotes: [
      "Musixmatch lyric/subtitle content is used only as an in-memory analysis reference.",
      "The passport stores derived variant metadata, timestamps, and confidence notes only.",
      "Uploaded clip buffers are processed in memory for this MVP and are not written to persistent storage."
    ]
  };
}

function classifyAlignment(alignment: AlignmentResult, previous?: AlignmentResult): VariantType | null {
  const normalized = normalizeText(alignment.transcript.text);
  const tokens = tokenize(alignment.transcript.text);
  const canonicalTokens = alignment.canonical ? tokenize(alignment.canonical.text) : [];
  const extraTokens = tokens.filter((token) => !canonicalTokens.includes(token));
  const duration = alignment.transcript.end - alignment.transcript.start;

  if (citySignals.some((city) => normalized.includes(city))) {
    return "city_shoutout";
  }
  if (!alignment.canonical || alignment.similarity < 0.28) {
    return "adlib";
  }
  if (previous?.canonical?.id === alignment.canonical.id && alignment.similarity >= 0.6) {
    return "repeated_hook";
  }
  if (containsRepeatedPhrase(tokens)) {
    return "repeated_hook";
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

function scoreVariantConfidence(asr: number, similarity: number, sourceCoverage: number, type: VariantType): number {
  const typeBoost: Record<VariantType, number> = {
    substitution: 0.02,
    skipped_line: -0.08,
    repeated_hook: 0.06,
    extension: 0.03,
    city_shoutout: 0.1,
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
    adlib: "unmatched vocal phrase likely outside the canonical lyric reference.",
    timing_drift: "timing offset that can affect subtitle alignment.",
    uncertain: "weak signal that should remain in review rather than automation."
  };
  return `${qualifier}: ${notes[type]}`;
}

function summarizePassport(variants: VariantCandidate[], overall: number): string {
  const prominent = variants
    .filter((variant) => variant.confidence >= 0.58)
    .slice(0, 3)
    .map((variant) => variant.type.replace("_", " "))
    .join(", ");
  if (!prominent) {
    return `No strong live lyric variants detected. Overall confidence ${Math.round(overall * 100)}%.`;
  }
  return `Detected ${variants.length} live variant candidates, led by ${prominent}. Overall confidence ${Math.round(overall * 100)}%.`;
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

