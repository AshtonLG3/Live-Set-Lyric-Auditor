import type { AnalysisJob, ClipSource, EventCandidate, LiveVariantPassport, RecallRescueResponse, TrackCandidate, TranscriptSegment, VariantCandidate, VocalQualityReport } from "../../shared/types";
import { formatBytes } from "../../shared/format";
import { fixtureClipDuration, fixtureEvents, fixtureTracks } from "../data/fixtures";
import { transcribeLiveVocal, transcribeRecallFragment } from "../adapters/asr";
import type { TranscriptionResult } from "../adapters/asr";
import { analyzePerformance } from "../adapters/cyanite";
import { narratePassport } from "../adapters/elevenlabs";
import { buildLiveContext, searchEvents } from "../adapters/jambase";
import { isolateVocalsWithDemucs } from "../adapters/demucs";
import type { VocalIsolationResult } from "../adapters/demucs";
import { getCanonicalReference, identifyTrackFromLyrics, searchTracksByLyrics } from "../adapters/musixmatch";
import { extractYouTubeExcerpt } from "../adapters/youtube";
import { env } from "../config";
import { jobMedia, jobs, setStep, updateJob } from "../store";
import { buildPassport } from "./alignment";
import { assessVocalTranscript, buildFallbackQualityReport, shouldRejectSeparatedStem } from "./vocal-quality";

export type AnalyzeInput = {
  file?: Express.Multer.File;
  track?: TrackCandidate;
  event?: EventCandidate | null;
  trackQuery?: string;
  eventCity?: string;
  eventDate?: string;
  durationSeconds?: number;
  autoMatch?: boolean;
  useFixture?: boolean;
  source?: ClipSource;
  recallSegments?: TranscriptSegment[];
};

export async function runRecallRescue(file?: Express.Multer.File, phrase?: string): Promise<RecallRescueResponse> {
  const typedPhrase = phrase?.trim();
  const transcription = typedPhrase
    ? {
        source: "external" as const,
        segments: [{ id: "R1", start: 0, end: 0, text: typedPhrase, confidence: 1 }]
      }
    : await transcribeRecallFragment(file);
  const candidates = await searchTracksByLyrics(transcription.segments);

  return {
    transcript: transcription.segments.map((segment) => segment.text).join(" ").trim(),
    segments: transcription.segments,
    candidates,
    mode: typedPhrase
      ? "typed_lyrics_search"
      : transcription.source === "fixture"
        ? "fixture"
        : "asr_lyrics_search"
  };
}

export async function runAnalysis(jobId: string, input: AnalyzeInput): Promise<void> {
  try {
    updateJob(jobId, (job) => ({ ...job, status: "running" }));

    setStep(jobId, "ingest", "running");
    const recallSegments = normalizeRecallSegments(input.recallSegments);
    const analysisFile = await resolveAnalysisFile(input);
    const effectiveSource = analysisFile && !input.file && input.source?.kind === "live_link"
      ? { ...input.source, processingMode: "provider_excerpt" as const }
      : input.source;
    if (analysisFile) {
      jobMedia.set(jobId, {
        buffer: analysisFile.buffer,
        mimetype: analysisFile.mimetype || "application/octet-stream",
        filename: analysisFile.originalname
      });
    }
    setStep(
      jobId,
      "ingest",
      "complete",
      analysisFile
        ? `${analysisFile.originalname} · ${formatBytes(analysisFile.size)} · ${Math.round(input.durationSeconds ?? fixtureClipDuration)}s`
        : recallSegments.length
          ? `${recallSegments.length} recalled lyric segment${recallSegments.length === 1 ? "" : "s"} loaded.`
          : input.source?.kind === "live_link"
            ? `${providerLabel(input.source)} reference · no processable excerpt`
            : "Seeded fixture clip loaded."
    );

    setStep(jobId, "isolate", "running");
    const initialVocal: VocalIsolationResult = recallSegments.length && !analysisFile
      ? {
          source: "original",
          confidence: 1,
          detail: "Recall text supplied; no vocal isolation needed."
        }
      : await isolateVocalsWithDemucs(analysisFile);
    setStep(jobId, "isolate", "complete", initialVocal.detail);

    setStep(jobId, "profile", "running");
    const performanceContext = await analyzePerformance({ file: analysisFile, source: effectiveSource });
    setStep(
      jobId,
      "profile",
      "complete",
      `${performanceContext.source === "cyanite" ? "Cyanite" : "Demo profile"} · ${Math.round(performanceContext.energyLevel * 100)}% energy · ${performanceContext.arrangement.replaceAll("_", " ")}`
    );

    setStep(jobId, "transcribe", "running");
    let selected = await selectVocalTranscription(jobId, analysisFile, initialVocal, recallSegments);
    setStep(jobId, "transcribe", "complete", transcriptionDetail(selected));

    const persistRecovery = () => updateJob(jobId, (job) => ({
      ...job,
      recovery: {
        filename: analysisFile?.originalname ?? sourceFilename(input.source),
        durationSeconds: input.durationSeconds ?? fixtureClipDuration,
        vocalIsolationSource: selected.vocal.source,
        vocalIsolationConfidence: selected.vocal.confidence,
        vocalQuality: selected.vocalQuality,
        asrSource: selected.transcription.source,
        asrEngine: selected.transcription.engine,
        transcript: selected.transcription.segments,
        source: effectiveSource ?? {
          kind: analysisFile ? "upload" : "fixture",
          processingMode: analysisFile ? "uploaded_media" : "fixture"
        },
        performanceContext,
        event: input.event ?? null
      }
    }));
    persistRecovery();

    setStep(jobId, "anchor", "running");
    let resolved: Awaited<ReturnType<typeof resolveTrack>>;
    try {
      resolved = await resolveTrack(input, selected.transcription.segments);
    } catch (error) {
      const fallback = await maybeRetryOriginalForAnchor(jobId, input, analysisFile, selected, error);
      if (!fallback) {
        throw error;
      }
      selected = fallback;
      setStep(jobId, "transcribe", "complete", transcriptionDetail(selected));
      persistRecovery();
      resolved = await resolveTrack(input, selected.transcription.segments).catch(() => {
        throw new Error("Auto-match could not confirm a Musixmatch track after testing both the Demucs stem and original-audio ASR. The transcript was saved; choose the track manually to generate the Live Variant Passport without reprocessing the clip.");
      });
    }
    const track = resolved.track;
    const event = await resolveEvent(input, track);
    const liveContext = buildLiveContext(event, track);
    setStep(
      jobId,
      "anchor",
      "complete",
      `${track.title} by ${track.artist} · ${resolved.matchMethod.replaceAll("_", " ")}${event ? ` · ${event.venue}` : ""}`
    );

    setStep(jobId, "compare", "running");
    const canonical = await getCanonicalReference(track);
    setStep(
      jobId,
      "compare",
      "complete",
      canonical.restricted
        ? "Lyrics restricted; passport switched to metadata-only comparison."
        : `${canonical.lines.length} reference lines from ${canonical.source}.`
    );

    setStep(jobId, "passport", "running");
    const passport = buildPassport({
      id: jobId,
      track,
      event,
      filename: analysisFile?.originalname ?? sourceFilename(input.source),
      durationSeconds: input.durationSeconds ?? fixtureClipDuration,
      canonicalLines: canonical.lines,
      transcript: selected.transcription.segments,
      sourceCoverage: canonical.sourceCoverage,
      canonicalSource: canonical.source,
      restricted: canonical.restricted,
      language: canonical.language,
      copyright: canonical.copyright,
      trackingUrl: canonical.trackingUrl,
      matchMethod: resolved.matchMethod,
      vocalIsolationSource: selected.vocal.source,
      vocalIsolationConfidence: selected.vocal.confidence,
      vocalQuality: selected.vocalQuality,
      asrSource: selected.transcription.source,
      asrEngine: selected.transcription.engine,
      source: effectiveSource ?? {
        kind: analysisFile ? "upload" : "fixture",
        processingMode: analysisFile ? "uploaded_media" : "fixture"
      },
      liveContext,
      performanceContext
    });
    assertSelectedTrackFitsTranscript(passport);

    updateJob(jobId, (job) => ({
      ...job,
      status: "complete",
      passport,
      recovery: undefined,
      error: undefined
    }));
    setStep(jobId, "passport", "complete", `${passport.variants.length} variant candidates flagged.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown analysis failure";
    updateJob(jobId, (job) => ({
      ...job,
      status: "failed",
      error: message,
      progress: job.progress.map((step) =>
        step.status === "running" ? { ...step, status: "failed", detail: message } : step
      )
    }));
  }
}

export async function reanchorAnalysis(jobId: string, track: TrackCandidate): Promise<AnalysisJob> {
  const job = jobs.get(jobId);
  const passport = job?.passport;
  const recovery = job?.recovery;
  if (!job || (!passport && !recovery)) {
    throw new Error("Transcription must complete before correcting the track anchor.");
  }

  const canonical = await getCanonicalReference(track);
  const event = passport?.event ?? recovery?.event ?? null;
  const liveContext = buildLiveContext(event, track);
  const corrected = buildPassport({
    id: jobId,
    track,
    event,
    filename: passport?.clip.filename ?? recovery!.filename,
    durationSeconds: passport?.clip.durationSeconds ?? recovery!.durationSeconds,
    canonicalLines: canonical.lines,
    transcript: passport?.clip.transcript ?? recovery!.transcript,
    sourceCoverage: canonical.sourceCoverage,
    canonicalSource: canonical.source,
    restricted: canonical.restricted,
    language: canonical.language,
    copyright: canonical.copyright,
    trackingUrl: canonical.trackingUrl,
    matchMethod: "selected_track",
    vocalIsolationSource: passport?.clip.vocalIsolationSource ?? recovery!.vocalIsolationSource,
    vocalIsolationConfidence: passport?.clip.vocalIsolationConfidence ?? recovery!.vocalIsolationConfidence,
    vocalQuality: passport?.clip.vocalQuality ?? recovery!.vocalQuality,
    asrSource: passport?.clip.asrSource ?? recovery!.asrSource,
    asrEngine: passport?.clip.asrEngine ?? recovery!.asrEngine,
    source: passport?.clip.source ?? recovery!.source,
    liveContext,
    performanceContext: passport?.performanceContext ?? recovery!.performanceContext
  });
  const updated = updateJob(jobId, (current) => ({
    ...current,
    status: "complete",
    passport: corrected,
    recovery: undefined,
    error: undefined,
    progress: current.progress.map((step) => {
      if (step.id === "anchor") {
        return { ...step, status: "complete", detail: `${track.title} by ${track.artist} · corrected track anchor` };
      }
      if (step.id === "compare") {
        return {
          ...step,
          status: "complete",
          detail: canonical.restricted
            ? "Lyrics restricted; passport switched to metadata-only comparison."
            : `${canonical.lines.length} reference lines from ${canonical.source}.`
        };
      }
      if (step.id === "passport") {
        return { ...step, status: "complete", detail: `${corrected.variants.length} variant candidates re-anchored without retranscription.` };
      }
      return step;
    })
  }));
  if (!updated) {
    throw new Error("Analysis job no longer exists.");
  }
  return updated;
}

export async function createNarration(
  jobId: string,
  manualVariants: VariantCandidate[] = [],
  editedTexts: Record<string, string> = {},
  reviewDecisions: Record<string, string> = {}
) {
  const job = jobs.get(jobId);
  if (!job?.passport) {
    throw new Error("Analysis job is not complete.");
  }
  const allVariants = [...job.passport.variants, ...manualVariants.slice(0, 25)];
  const variants = allVariants.map((v) => {
    const comparison = job.passport!.lineComparisons.find((lc) => lc.variantId === v.id);
    const edited = comparison ? editedTexts[comparison.id] : undefined;
    const decision = reviewDecisions[v.id];
    return {
      ...v,
      liveText: edited ?? v.liveText,
      reviewerDecision: decision
    };
  });
  const editedComparisons = job.passport.lineComparisons.map((lc) => {
    const edited = editedTexts[lc.id];
    return edited ? { ...lc, liveText: edited } : lc;
  });
  const passport = { ...job.passport, variants, lineComparisons: editedComparisons };
  return narratePassport(jobId, passport);
}

type VocalTranscriptionSelection = {
  transcription: TranscriptionResult;
  vocal: VocalIsolationResult;
  vocalQuality: VocalQualityReport;
};

function isSeparatedStem(source: VocalIsolationResult["source"]): boolean {
  return source === "demucs";
}

function stemSourceLabel(source: VocalIsolationResult["source"]): string {
  return source === "demucs" ? "Demucs" : "Separated-audio";
}

async function selectVocalTranscription(
  jobId: string,
  analysisFile: Express.Multer.File | undefined,
  vocal: VocalIsolationResult,
  recallSegments: TranscriptSegment[]
): Promise<VocalTranscriptionSelection> {
  if (recallSegments.length && !analysisFile) {
    const transcription = { source: "external" as const, segments: recallSegments };
    return {
      transcription,
      vocal,
      vocalQuality: assessVocalTranscript(transcription.segments, "original")
    };
  }

  let primary: VocalTranscriptionSelection;
  try {
    const transcription = await transcribeLiveVocal(analysisFile, vocal.vocalUrl);
    primary = {
      transcription,
      vocal,
      vocalQuality: addIsolationDetail(assessVocalTranscript(transcription.segments, vocal.source), vocal)
    };
  } catch (error) {
    if (isSeparatedStem(vocal.source) && analysisFile) {
      const label = stemSourceLabel(vocal.source);
      const reason = error instanceof Error ? error.message : `${label} stem transcription failed`;
      setStep(jobId, "transcribe", "running", `${label} stem ASR failed; retrying original audio.`);
      return originalFallbackSelection(
        analysisFile,
        assessVocalTranscript([], vocal.source, [reason]),
        `the ${label} stem could not be transcribed`
      );
    }
    throw error;
  }

  if (isSeparatedStem(primary.vocal.source) && analysisFile) {
    setStep(jobId, "transcribe", "running", `Comparing ${stemSourceLabel(primary.vocal.source)} stem with raw audio ASR.`);
    try {
      const original = await originalTranscriptionSelection(analysisFile);
      const fallbackReason = originalFallbackReason(primary, original);
      if (fallbackReason) {
        return selectOriginalFallback(original, primary.vocalQuality, fallbackReason);
      }
      return {
        ...primary,
        vocalQuality: {
          ...primary.vocalQuality,
          detail: `${primary.vocalQuality.detail} Raw comparison scored ${Math.round(original.vocalQuality.score * 100)}%; ${stemSourceLabel(primary.vocal.source)} stem retained.`
        }
      };
    } catch (error) {
      const fallbackError = error instanceof Error ? error.message : "original audio fallback failed";
      if (!shouldRejectSeparatedStem(primary.vocalQuality)) {
        return {
          ...primary,
          vocalQuality: {
            ...primary.vocalQuality,
            issues: [...primary.vocalQuality.issues, `Raw-audio comparison failed: ${fallbackError}`],
            detail: `${primary.vocalQuality.detail} Raw-audio comparison failed: ${fallbackError}`
          }
        };
      }
      return {
        ...primary,
        vocalQuality: {
          ...primary.vocalQuality,
          issues: [...primary.vocalQuality.issues, `Original-audio fallback failed: ${fallbackError}`],
          detail: `${primary.vocalQuality.detail} Original-audio fallback failed: ${fallbackError}`
        }
      };
    }
  }

  return primary;
}

async function maybeRetryOriginalForAnchor(
  jobId: string,
  input: AnalyzeInput,
  analysisFile: Express.Multer.File | undefined,
  selected: VocalTranscriptionSelection,
  anchorError: unknown
): Promise<VocalTranscriptionSelection | null> {
  if (!input.autoMatch || !analysisFile || !isSeparatedStem(selected.vocal.source)) {
    return null;
  }
  const label = stemSourceLabel(selected.vocal.source);
  const reason = anchorError instanceof Error ? anchorError.message : `${label} stem did not anchor to a Musixmatch track`;
  setStep(jobId, "anchor", "running", `${label} transcript could not anchor; retrying original-audio transcript.`);
  return originalFallbackSelection(
    analysisFile,
    selected.vocalQuality,
    reason.includes("confident Musixmatch")
      ? `the ${label} transcript did not produce a confident Musixmatch match`
      : reason
  );
}

async function originalFallbackSelection(
  analysisFile: Express.Multer.File,
  rejectedQuality: VocalQualityReport,
  reason: string
): Promise<VocalTranscriptionSelection> {
  return selectOriginalFallback(await originalTranscriptionSelection(analysisFile), rejectedQuality, reason);
}

function originalFallbackReason(stem: VocalTranscriptionSelection, original: VocalTranscriptionSelection): string | null {
  if (original.vocalQuality.status === "failed") {
    return null;
  }
  const label = stemSourceLabel(stem.vocal.source);
  if (shouldRejectSeparatedStem(stem.vocalQuality)) {
    return stem.vocalQuality.issues[0] ?? `the ${label} stem failed transcript quality checks`;
  }
  if (original.vocalQuality.score >= stem.vocalQuality.score + 0.08) {
    return `raw ASR scored ${Math.round(original.vocalQuality.score * 100)}% versus ${Math.round(stem.vocalQuality.score * 100)}% for the ${label} stem`;
  }
  if (
    stem.vocalQuality.status === "warning" &&
    original.vocalQuality.status === "passed" &&
    original.vocalQuality.score >= stem.vocalQuality.score
  ) {
    return `the ${label} stem carried a quality warning and raw ASR was at least as strong`;
  }
  if (
    stem.vocalQuality.repetitionRatio - original.vocalQuality.repetitionRatio >= 0.18 &&
    original.vocalQuality.score >= stem.vocalQuality.score - 0.03
  ) {
    return `raw ASR had materially less repetition than the ${label} stem`;
  }
  if (
    original.vocalQuality.tokenCount >= stem.vocalQuality.tokenCount * 1.45 &&
    original.vocalQuality.uniqueTokenRatio >= stem.vocalQuality.uniqueTokenRatio &&
    original.vocalQuality.score >= stem.vocalQuality.score - 0.02
  ) {
    return `raw ASR preserved substantially more lyric content than the ${label} stem`;
  }
  return null;
}

async function originalTranscriptionSelection(
  analysisFile: Express.Multer.File
): Promise<VocalTranscriptionSelection> {
  const transcription = await transcribeLiveVocal(analysisFile);
  const selectedQuality = assessVocalTranscript(transcription.segments, "original");
  return {
    transcription,
    vocal: {
      source: "original",
      confidence: Math.max(0.48, selectedQuality.score),
      detail: "Raw/original audio ASR candidate."
    },
    vocalQuality: selectedQuality
  };
}

function selectOriginalFallback(
  original: VocalTranscriptionSelection,
  rejectedQuality: VocalQualityReport,
  reason: string
): VocalTranscriptionSelection {
  return {
    ...original,
    vocal: {
      ...original.vocal,
      detail: `Original audio selected after Demucs stem comparison. ${reason}`
    },
    vocalQuality: buildFallbackQualityReport(original.vocalQuality, rejectedQuality, reason)
  };
}

function transcriptionDetail(selection: VocalTranscriptionSelection): string {
  const sourceLabel = selection.vocal.source === "demucs"
    ? "Demucs stem"
    : selection.vocal.source === "original"
      ? "original audio"
      : "fixture vocal";
  return `${selection.transcription.segments.length} vocal segments from ${selection.transcription.source} via ${sourceLabel}. ${selection.vocalQuality.detail}`;
}

function assertSelectedTrackFitsTranscript(passport: LiveVariantPassport): void {
  if (passport.recordingIdentity.matchMethod !== "selected_track") {
    return;
  }
  if (
    passport.rights.status === "restricted" ||
    passport.recordingIdentity.canonicalSource === "metadata-only" ||
    passport.clip.transcript.length < 4 ||
    passport.lineComparisons.length < 4
  ) {
    return;
  }

  const strongMatches = passport.lineComparisons.filter((line) => line.similarity >= 0.72).length;
  const plausibleMatches = passport.lineComparisons.filter((line) => line.similarity >= 0.48).length;
  const plausibleRatio = plausibleMatches / passport.lineComparisons.length;
  const sourceGapRatio = passport.variants.length
    ? passport.variants.filter((variant) => variant.evidenceTier === "source_gap").length / passport.variants.length
    : 0;

  if (
    (passport.confidenceOverview.alignment < 0.35 && strongMatches < 2 && plausibleRatio < 0.35) ||
    (passport.confidenceOverview.alignment < 0.45 && strongMatches < 2 && sourceGapRatio >= 0.6)
  ) {
    throw new Error(
      `Selected track "${passport.track.title}" by ${passport.track.artist} does not fit this live transcript. Use Auto Match or choose the matching recording before exporting a Live Variant Passport.`
    );
  }
}

function addIsolationDetail(report: VocalQualityReport, vocal: VocalIsolationResult): VocalQualityReport {
  if (!isSeparatedStem(vocal.source)) {
    return report;
  }
  return {
    ...report,
    detail: `${report.detail} ${vocal.detail}`
  };
}

async function resolveTrack(
  input: AnalyzeInput,
  transcript: TranscriptSegment[]
): Promise<{
  track: TrackCandidate;
  matchMethod: "selected_track" | "lyrics_rescue" | "recall_rescue" | "fixture_rescue";
}> {
  if (input.useFixture) {
    return { track: fixtureTracks[0], matchMethod: "fixture_rescue" };
  }
  if (input.track && !input.autoMatch) {
    return { track: input.track, matchMethod: "selected_track" };
  }
  if (input.autoMatch) {
    const rescued = await identifyTrackFromLyrics(transcript);
    if (rescued) {
      return {
        track: rescued,
        matchMethod: input.source?.kind === "recall_recording"
          ? "recall_rescue"
          : rescued.source === "fixture"
            ? "fixture_rescue"
            : "lyrics_rescue"
      };
    }
    throw new Error("The live transcript did not produce a confident Musixmatch track match. Select the track manually or use a clearer vocal excerpt.");
  }
  throw new Error("Choose a catalog track before running Selected track mode.");
}

async function resolveAnalysisFile(input: AnalyzeInput): Promise<Express.Multer.File | undefined> {
  if (input.file) {
    return input.file;
  }
  if (input.useFixture || input.source?.kind === "fixture") {
    return undefined;
  }
  if (input.source?.kind === "live_link" && input.source.provider === "youtube" && input.source.processingMode === "provider_excerpt") {
    if (!env.youtubeExtractionEnabled) {
      throw new Error("YouTube extraction is disabled for this server. Attach an authorized excerpt instead.");
    }
    return extractYouTubeExcerpt(input.source);
  }
  if (input.source?.kind === "live_link") {
    throw new Error("Attach an authorized excerpt for this provider so the app can run real vocal analysis.");
  }
  return undefined;
}

function providerLabel(source: ClipSource): string {
  return source.provider ? source.provider.replaceAll("_", " ") : "Live link";
}

function sourceFilename(source?: ClipSource): string {
  if (source?.kind === "live_link") {
    return `${source.provider ?? "live"}-reference`;
  }
  if (source?.kind === "recall_recording") {
    return "remembered-lyric.webm";
  }
  return "seeded-demo-clip.mp3";
}

async function resolveEvent(input: AnalyzeInput, track: TrackCandidate): Promise<EventCandidate | null> {
  if (input.useFixture) {
    return fixtureEvents[0];
  }
  if (input.event !== undefined) {
    return input.event;
  }
  const events = await searchEvents({
    artist: track.artist,
    city: input.eventCity,
    date: input.eventDate
  });
  return events[0] ?? null;
}

function normalizeRecallSegments(segments?: TranscriptSegment[]): TranscriptSegment[] {
  return (segments ?? [])
    .map((segment, index): TranscriptSegment | null => {
      const text = segment.text?.trim();
      if (!text) return null;
      const start = finiteNumber(segment.start, index * 4);
      const end = Math.max(start + 1, finiteNumber(segment.end, start + 4));
      return {
        id: segment.id || `R${index + 1}`,
        start,
        end,
        text,
        confidence: Math.max(0.1, Math.min(1, finiteNumber(segment.confidence, 1)))
      };
    })
    .filter((segment): segment is TranscriptSegment => segment !== null);
}

function finiteNumber(...values: unknown[]): number {
  const value = values.find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
  return typeof value === "number" ? value : 0;
}
