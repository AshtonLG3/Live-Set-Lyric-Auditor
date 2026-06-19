import type { TranscriptSegment, VocalQualityReport } from "../../shared/types";

type VocalSource = VocalQualityReport["selectedSource"];

export function assessVocalTranscript(
  segments: TranscriptSegment[],
  selectedSource: VocalSource,
  extraIssues: string[] = []
): VocalQualityReport {
  const normalizedSegments = segments
    .map((segment) => normalizeText(segment.text))
    .filter(Boolean);
  const tokens = normalizedSegments.flatMap((text) => text.split(" ").filter(Boolean));
  const tokenCount = tokens.length;
  const uniqueTokenRatio = tokenCount ? round(new Set(tokens).size / tokenCount) : 0;
  const averageConfidence = round(average(segments.map((segment) => segment.confidence)));
  const phraseStats = dominantPhraseStats(normalizedSegments);
  const ngramStats = dominantNgramStats(tokens, 3);
  const repetitionRatio = round(Math.max(phraseStats.ratio, ngramStats.ratio));
  const issues = [...extraIssues];

  if (segments.length === 0 || tokenCount === 0) {
    issues.push("ASR returned no usable vocal transcript.");
  }
  if (segments.length >= 5 && phraseStats.ratio >= 0.35 && wordCount(phraseStats.phrase) <= 6) {
    issues.push(`Transcript is dominated by a repeated short phrase: "${phraseStats.phrase}".`);
  }
  if (tokenCount >= 40 && uniqueTokenRatio < 0.28) {
    issues.push("Transcript has very low vocabulary variety for its length.");
  }
  if (tokenCount >= 40 && ngramStats.ratio >= 0.18 && uniqueTokenRatio < 0.42) {
    issues.push(`Transcript has a repeated ${ngramStats.size}-word loop: "${ngramStats.phrase}".`);
  }
  if (averageConfidence > 0 && averageConfidence < 0.58) {
    issues.push("Average ASR confidence is below the review threshold.");
  }

  const score = round(clamp(
    uniqueTokenRatio * 0.42 +
    (1 - repetitionRatio) * 0.34 +
    averageConfidence * 0.24,
    0,
    1
  ));
  const status = issues.length >= 2 || score < 0.34
    ? "failed"
    : issues.length || score < 0.48
      ? "warning"
      : "passed";

  return {
    selectedSource,
    status,
    score,
    segmentCount: segments.length,
    tokenCount,
    uniqueTokenRatio,
    repetitionRatio,
    averageConfidence,
    dominantPhrase: phraseStats.ratio > 0 ? phraseStats.phrase : undefined,
    issues,
    fallbackUsed: false,
    detail: qualityDetail(selectedSource, status, score, issues)
  };
}

export function shouldRejectSeparatedStem(report: VocalQualityReport): boolean {
  const isSeparatedStem = report.selectedSource === "lalalai" || report.selectedSource === "demucs";
  return isSeparatedStem && (report.status === "failed" || report.repetitionRatio >= 0.35);
}

export function buildFallbackQualityReport(
  selected: VocalQualityReport,
  rejected: VocalQualityReport,
  reason: string
): VocalQualityReport {
  const rejectedLabel = rejected.selectedSource === "demucs" ? "Demucs" : "LALAL.AI";
  return {
    ...selected,
    status: "fallback_original",
    rejectedSource: rejected.selectedSource === "demucs" ? "demucs" : "lalalai",
    fallbackUsed: true,
    issues: [`${rejectedLabel} stem not selected: ${reason}`, `Stem score was ${Math.round(rejected.score * 100)}%.`, ...selected.issues],
    detail: `${rejectedLabel} stem was not selected; original audio transcript selected. ${reason}`
  };
}

function dominantPhraseStats(phrases: string[]): { phrase: string; ratio: number } {
  if (phrases.length === 0) {
    return { phrase: "", ratio: 0 };
  }
  const counts = new Map<string, number>();
  phrases.forEach((phrase) => counts.set(phrase, (counts.get(phrase) ?? 0) + 1));
  const [phrase, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  return { phrase, ratio: count / phrases.length };
}

function dominantNgramStats(tokens: string[], size: number): { phrase: string; ratio: number; size: number } {
  if (tokens.length < size) {
    return { phrase: "", ratio: 0, size };
  }
  const counts = new Map<string, number>();
  for (let index = 0; index + size <= tokens.length; index += 1) {
    const phrase = tokens.slice(index, index + size).join(" ");
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  const total = Math.max(1, tokens.length - size + 1);
  const [phrase, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  return { phrase, ratio: count / total, size };
}

function qualityDetail(source: VocalSource, status: VocalQualityReport["status"], score: number, issues: string[]): string {
  const label = source === "lalalai" ? "LALAL.AI stem" : source === "demucs" ? "Demucs stem" : source === "original" ? "original audio" : "fixture vocal";
  if (status === "passed") {
    return `${label} passed transcript quality gate (${Math.round(score * 100)}%).`;
  }
  if (status === "warning") {
    return `${label} needs transcript review (${Math.round(score * 100)}%): ${issues[0] ?? "quality warning"}`;
  }
  return `${label} failed transcript quality gate (${Math.round(score * 100)}%): ${issues[0] ?? "quality failure"}`;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value: string): number {
  return value ? value.split(" ").filter(Boolean).length : 0;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
