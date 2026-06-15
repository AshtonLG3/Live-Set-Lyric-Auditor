import type { CanonicalSource, ClipSource, ConfidenceOverview, EventCandidate, LiveContext, LiveVariantPassport, PerformanceContext, TrackCandidate, TranscriptSegment, VariantCandidate, VariantType } from "../../shared/types";
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
      recommendedAction: recommendedAction(type),
      translationRisk: translationRisk(type),
      severity: confidence >= 0.78 ? "high" : confidence >= 0.58 ? "medium" : "low"
    });
  });

  const skipped = canonicalLines.filter((line) => !matchedCanonicalIds.has(line.id));
  skipped.forEach((line) => {
    variants.push({
      id: `V${variants.length + 1}`,
      type: "skipped_line",
      start: line.start,
      end: line.end,
      liveText: "[not detected in live vocal]",
      canonicalAlignmentReference: `${line.id} (canonical line absent from aligned ASR)`,
      confidence: round(0.58 * sourceCoverage),
      impactNote: "Potential caption or archive gap; queue for human review before marking as a confirmed omission.",
      recommendedAction: "Review live-only caption coverage and confirm the omission.",
      translationRisk: "high",
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
  canonicalSource: CanonicalSource;
  restricted: boolean;
  language?: string;
  copyright?: string;
  trackingUrl?: string;
  matchMethod: "selected_track" | "lyrics_rescue" | "recall_rescue" | "fixture_rescue";
  vocalIsolationSource: "lalalai" | "original" | "fixture";
  vocalIsolationConfidence: number;
  asrSource: "replicate" | "external" | "fixture";
  source: ClipSource;
  liveContext?: LiveContext | null;
  performanceContext?: PerformanceContext;
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
      asrSource: input.asrSource,
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
    variants,
    complianceNotes: [
      "Musixmatch lyric/subtitle content is used only as an in-memory analysis reference.",
      "The passport stores derived variant metadata, timestamps, and confidence notes only.",
      "Uploaded clip buffers are processed in memory for this MVP and are not written to persistent storage.",
      input.source.processingMode === "reference_fixture"
        ? "The linked performance is preserved as evidence and previewed through its provider; provider audio is not downloaded."
        : input.source.processingMode === "provider_excerpt"
          ? "Only the selected provider time range was temporarily extracted for analysis and deleted immediately after loading into memory."
        : "Source media was supplied directly by the user for this analysis.",
      input.performanceContext?.source === "cyanite"
        ? "Configured Cyanite analysis contributes derived energy, mood, BPM, and arrangement metadata."
        : "Performance context uses seeded demo metadata when Cyanite analysis is unavailable.",
      input.vocalIsolationSource === "lalalai"
        ? "Configured LALAL.AI vocal isolation supplied the transcription stem."
        : input.vocalIsolationSource === "original"
          ? "Vocal isolation was unavailable, so transcription used the original user-supplied audio."
          : "Seeded demo isolation metadata was used for the fixture run."
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

function recommendedAction(type: VariantType): string {
  const actions: Record<VariantType, string> = {
    substitution: "Review lyric wording and downstream translations.",
    skipped_line: "Confirm omission and update live-caption coverage.",
    repeated_hook: "Extend live subtitle timing; canonical lyric can remain unchanged.",
    extension: "Add a live-only caption segment or alternate-version note.",
    city_shoutout: "Attach event-specific metadata; no canonical lyric edit required.",
    adlib: "Mark as live ad-lib after human review.",
    timing_drift: "Review RichSync timing against the performance tempo.",
    uncertain: "Keep in the review queue and avoid automated edits."
  };
  return actions[type];
}

function translationRisk(type: VariantType): VariantCandidate["translationRisk"] {
  if (type === "substitution" || type === "skipped_line") return "high";
  if (type === "city_shoutout" || type === "extension" || type === "adlib") return "medium";
  return "low";
}

function scoreVersionConfidence(
  track: TrackCandidate,
  matchMethod: "selected_track" | "lyrics_rescue" | "recall_rescue" | "fixture_rescue",
  canonicalSource: CanonicalSource
): number {
  const identitySignals = [track.id, track.commonTrackId, track.isrc, track.album].filter(Boolean).length / 4;
  const sourceBoost = canonicalSource === "richsync" ? 1 : canonicalSource === "subtitles" ? 0.88 : canonicalSource === "lyrics" ? 0.72 : 0.48;
  const methodBoost = matchMethod === "selected_track"
    ? 0.94
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
    adlib: "Ad-lib",
    timing_drift: "Tempo drift",
    uncertain: "Uncertain section"
  };
  return labels[type];
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
