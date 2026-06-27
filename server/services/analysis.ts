import type { AnalysisJob, AnalysisRecovery, ClipSource, EventCandidate, LiveVariantPassport, PerformanceContext, RecallRescueResponse, RecordingMatchMethod, TrackCandidate, TranscriptSegment, VariantCandidate, VocalQualityReport } from "../../shared/types";
import { formatBytes } from "../../shared/format";
import { fixtureClipDuration, fixturePerformanceContext } from "../data/fixtures";
import { transcribeLiveVocal, transcribeRecallFragment } from "../adapters/asr";
import type { TranscriptionResult } from "../adapters/asr";
import { analyzePerformance } from "../adapters/cyanite";
import { narratePassport, transcribeWithElevenLabs } from "../adapters/elevenlabs";
import { buildLiveContext, searchEvents } from "../adapters/jambase";
import { identifyTrackFromAudio } from "../adapters/audio-id";
import type { AudioIdentityMatch } from "../adapters/audio-id";
import { getCanonicalReference, identifyTrackFromLyrics, searchTracksByLyrics } from "../adapters/musixmatch";
import { extractProviderExcerpt } from "../adapters/youtube";
import { detectLiveLinkProvider } from "../source-validation";
import { env } from "../config";
import { PublicError } from "../errors";
import { jobMedia, jobs, setStep, updateJob } from "../store";
import { buildPassport } from "./alignment";
import { transcodeMediaToMp3, trimMediaExcerptToMp3 } from "./media";
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
  source?: ClipSource;
  recallSegments?: TranscriptSegment[];
};

type VocalIsolationResult = {
  source: "lalalai" | "demucs" | "original" | "fixture";
  confidence: number;
  detail: string;
  vocalUrl?: string;
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
    if (input.source?.kind === "live_link" && input.source.processingMode === "provider_excerpt") {
      setStep(jobId, "ingest", "running", `Fetching selected ${providerLabel(input.source)} range for the live-link excerpt.`);
    }
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
    const audioIdentity = input.autoMatch ? identifyTrackFromAudio(analysisFile) : Promise.resolve(undefined);
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
            : "Source media pending."
    );

    setStep(jobId, "isolate", "running");
    const initialVocal: VocalIsolationResult = recallSegments.length && !analysisFile
      ? {
          source: "original",
          confidence: 1,
          detail: "Recall text supplied; no vocal isolation needed."
        }
      : analysisFile
        ? {
            source: "original",
            confidence: 0.58,
            detail: "Fast mode: original audio goes to ASR first; split rescue is not run automatically."
          }
        : {
            source: "original",
            confidence: 0,
            detail: "No vocal media was supplied."
          };
    setStep(jobId, "isolate", "complete", initialVocal.detail);

    setStep(jobId, "profile", "running", "Cyanite profile started in parallel with transcription.");
    let performanceContext = fixturePerformanceContext;
    const performanceContextPromise = analyzePerformance({ file: analysisFile, source: effectiveSource })
      .catch((error) => fallbackPerformanceContext(error));

    const recoveryBase = () => ({
      filename: analysisFile?.originalname ?? sourceFilename(input.source),
      durationSeconds: input.durationSeconds ?? fixtureClipDuration,
      track: input.track,
      trackQuery: input.trackQuery,
      autoMatch: input.autoMatch,
      source: effectiveSource ?? {
        kind: analysisFile ? "upload" as const : "recall_recording" as const,
        processingMode: analysisFile ? "uploaded_media" as const : "recall_recording" as const
      },
      performanceContext,
      event: input.event ?? null,
      eventCity: input.eventCity,
      eventDate: input.eventDate
    });
    updateJob(jobId, (job) => ({
      ...job,
      recovery: {
        ...recoveryBase(),
        vocalIsolationSource: initialVocal.source,
        vocalIsolationConfidence: initialVocal.confidence,
        vocalQuality: assessVocalTranscript([], initialVocal.source),
        asrSource: env.elevenlabsKey ? "external" : "replicate",
        asrEngine: env.elevenlabsKey ? `elevenlabs/${env.elevenlabsSttModel}` : "Whisper",
        transcript: []
      }
    }));

    setStep(jobId, "transcribe", "running");
    let selected = await selectVocalTranscription(jobId, analysisFile, initialVocal, recallSegments, effectiveSource);
    setStep(jobId, "transcribe", "complete", transcriptionDetail(selected));

    const persistRecovery = () => updateJob(jobId, (job) => ({
      ...job,
      recovery: {
        ...recoveryBase(),
        vocalIsolationSource: selected.vocal.source,
        vocalIsolationConfidence: selected.vocal.confidence,
        vocalQuality: selected.vocalQuality,
        asrSource: selected.transcription.source,
        asrEngine: selected.transcription.engine,
        transcript: selected.transcription.segments
      }
    }));
    persistRecovery();

    setStep(jobId, "anchor", "running");
    let resolved: Awaited<ReturnType<typeof resolveTrack>>;
    try {
      resolved = await resolveTrack(input, selected.transcription.segments, await audioIdentity);
    } catch (error) {
      const fallback = await maybeRetryOriginalForAnchor(jobId, input, analysisFile, selected, error);
      if (!fallback) {
        throw error;
      }
      selected = fallback;
      setStep(jobId, "transcribe", "complete", transcriptionDetail(selected));
      persistRecovery();
      resolved = await resolveTrack(input, selected.transcription.segments, await audioIdentity).catch(() => {
        throw new Error("Auto-match could not confirm a Musixmatch track from the saved ASR transcript. The transcript was saved; choose the track manually to generate the Live Variant Passport without reprocessing the clip.");
      });
    }
    let track = resolved.track;
    const event = await resolveEvent(input, track);
    const liveContext = buildLiveContext(event, track);
    setStep(
      jobId,
      "anchor",
      "complete",
      `${track.title} by ${track.artist} · ${resolved.matchMethod.replaceAll("_", " ")}${resolved.detail ? ` · ${resolved.detail}` : ""}${event ? ` · ${event.venue}` : ""}`
    );

    setStep(jobId, "compare", "running");
    const canonical = await getCanonicalReference(track);
    track = enrichTrackWithCanonical(track, canonical);
    setStep(
      jobId,
      "compare",
      "complete",
      canonical.restricted
        ? "Lyrics restricted; passport switched to metadata-only comparison."
        : `${canonical.lines.length} reference lines from ${canonical.source}.`
    );

    performanceContext = await settlePerformanceContext(performanceContextPromise);
    setStep(jobId, "profile", "complete", performanceContextDetail(performanceContext));
    persistRecovery();

    setStep(jobId, "passport", "running");
    const passport = buildPassportForSelection({
      jobId,
      input,
      analysisFile,
      effectiveSource,
      track,
      event,
      canonical,
      liveContext,
      performanceContext,
      resolved,
      selected
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

function fallbackPerformanceContext(error: unknown): PerformanceContext {
  const detail = error instanceof Error ? error.message : "unknown Cyanite profile error";
  console.warn(`Cyanite profile did not complete before passport generation; using fallback profile. ${detail}`);
  return fixturePerformanceContext;
}

export async function settlePerformanceContext(
  promise: Promise<PerformanceContext>,
  graceMs: number = env.passportPerformanceGraceMs
): Promise<PerformanceContext> {
  // Cyanite is a supplementary profile and routinely outlasts its own poll window, so it must
  // never block the user-facing passport. It already ran in parallel with transcribe/anchor/
  // compare; past a short grace, generate the passport with the labeled fallback. The configured
  // Cyanite webhook can still deliver the real profile afterwards.
  return Promise.race([
    promise,
    new Promise<PerformanceContext>((resolve) => setTimeout(() => resolve(fixturePerformanceContext), graceMs))
  ]);
}

function performanceContextDetail(context: PerformanceContext): string {
  return `${context.source === "cyanite" ? "Cyanite" : "Fallback profile"} · ${Math.round(context.energyLevel * 100)}% energy · ${context.arrangement.replaceAll("_", " ")}`;
}

export async function reanchorAnalysis(
  jobId: string,
  track: TrackCandidate,
  options: { event?: EventCandidate | null; eventCity?: string; eventDate?: string } = {}
): Promise<AnalysisJob> {
  const job = jobs.get(jobId);
  const passport = job?.passport;
  const recovery = job?.recovery;
  if (!job || (!passport && !recovery)) {
    throw new Error("Transcription must complete before correcting the track anchor.");
  }

  const canonical = await getCanonicalReference(track);
  const correctedTrack = enrichTrackWithCanonical(track, canonical);
  const clip = passport?.clip;
  const event = await resolveEvent({
    event: options.event !== undefined ? options.event : passport?.event ?? recovery?.event ?? null,
    eventCity: options.eventCity ?? recovery?.eventCity,
    eventDate: options.eventDate ?? recovery?.eventDate
  }, correctedTrack);
  const liveContext = buildLiveContext(event, correctedTrack);
  const corrected = buildPassport({
    id: jobId,
    track: correctedTrack,
    event,
    filename: clip?.filename ?? recovery!.filename,
    durationSeconds: clip?.durationSeconds ?? recovery!.durationSeconds,
    canonicalLines: canonical.lines,
    transcript: clip?.transcript ?? recovery!.transcript,
    sourceCoverage: canonical.sourceCoverage,
    canonicalSource: canonical.source,
    restricted: canonical.restricted,
    language: canonical.language,
    copyright: canonical.copyright,
    trackingUrl: canonical.trackingUrl,
    matchMethod: "selected_track",
    vocalIsolationSource: clip?.vocalIsolationSource ?? recovery!.vocalIsolationSource,
    vocalIsolationConfidence: clip?.vocalIsolationConfidence ?? recovery!.vocalIsolationConfidence,
    vocalQuality: passport ? clip?.vocalQuality : recovery!.vocalQuality,
    asrSource: clip?.asrSource ?? recovery!.asrSource,
    asrEngine: passport ? clip?.asrEngine : recovery!.asrEngine,
    source: clip?.source ?? recovery!.source,
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
        return { ...step, status: "complete", detail: `${correctedTrack.title} by ${correctedTrack.artist} · corrected track anchor` };
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

type RetranscriptionProvider = "scribe" | "whisper";

function isSeparatedStem(source: VocalIsolationResult["source"]): boolean {
  return source === "demucs" || source === "lalalai";
}

export async function retranscribeAnalysis(jobId: string): Promise<AnalysisJob> {
  const job = jobs.get(jobId);
  const passport = job?.passport;
  const media = jobMedia.get(jobId);
  const recovery = job?.recovery ?? (job && media && !passport ? buildRecoveryFromSavedMedia(job, media) : undefined);
  if (!job || (!passport && !recovery)) {
    throw new Error("A completed passport or failed ASR recovery is required before retranscribing.");
  }
  if (!media) {
    throw new Error("No saved audio or video is available for retranscription.");
  }
  if (!passport && recovery && !job.recovery) {
    updateJob(jobId, (current) => ({ ...current, recovery }));
  }

  const provider = chooseRetranscriptionProvider(passport, recovery, job.error, job);
  const label = retranscriptionProviderLabel(provider);
  setStep(jobId, "transcribe", "running", `Running ${label} on the saved source media.`);
  try {
    const file = mediaToMulterFile(media);
    const transcription = await runRetranscriptionProvider(provider, file);
    if (!passport) {
      return buildPassportFromRetranscriptionRecovery(jobId, recovery!, file, transcription, provider);
    }

    const canonical = await getCanonicalReference(passport.track);
    const track = enrichTrackWithCanonical(passport.track, canonical);
    const event = passport.event;
    const liveContext = buildLiveContext(event, track);
    const vocalQuality = assessVocalTranscript(transcription.segments, "original");
    const updatedPassport = buildPassport({
      id: jobId,
      track,
      event,
      filename: passport.clip.filename,
      durationSeconds: passport.clip.durationSeconds,
      canonicalLines: canonical.lines,
      transcript: transcription.segments,
      sourceCoverage: canonical.sourceCoverage,
      canonicalSource: canonical.source,
      restricted: canonical.restricted,
      language: canonical.language,
      copyright: canonical.copyright,
      trackingUrl: canonical.trackingUrl,
      matchMethod: passport.recordingIdentity.matchMethod,
      vocalIsolationSource: "original",
      vocalIsolationConfidence: passport.clip.vocalIsolationConfidence,
      vocalQuality,
      asrSource: transcription.source,
      asrEngine: transcription.engine,
      source: passport.clip.source,
      liveContext,
      performanceContext: passport.performanceContext
    });

    const updated = updateJob(jobId, (current) => ({
      ...current,
      status: "complete",
      passport: updatedPassport,
      error: undefined,
      progress: current.progress.map((step) =>
        step.id === "transcribe"
          ? { ...step, status: "complete", detail: `${label} retranscribed ${transcription.segments.length} segment${transcription.segments.length === 1 ? "" : "s"}.` }
          : step.id === "compare"
            ? { ...step, status: "complete", detail: canonical.restricted ? "Lyrics restricted; passport switched to metadata-only comparison." : `${canonical.lines.length} reference lines from ${canonical.source}.` }
            : step.id === "passport"
              ? { ...step, status: "complete", detail: `${updatedPassport.variants.length} variant candidates refreshed after ${label}.` }
              : step
      )
    }));
    if (!updated) {
      throw new Error("Analysis job no longer exists.");
    }
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const failureMessage = `${label} retry failed: ${message}`;
    updateJob(jobId, (current) => ({
      ...current,
      status: "failed",
      error: failureMessage,
      progress: current.progress.map((step) =>
        step.id === "transcribe" || step.status === "running"
          ? { ...step, status: "failed", detail: failureMessage }
          : step
      )
    }));
    // Surface the precise reason to the client. A bare re-throw would reach the
    // generic error handler and collapse to "Unexpected server error.", so the
    // retry would look like it silently did nothing.
    throw new PublicError(failureMessage, 502);
  }
}

function chooseRetranscriptionProvider(
  passport: AnalysisJob["passport"] | undefined,
  recovery: AnalysisRecovery | undefined,
  error?: string,
  job?: AnalysisJob
): RetranscriptionProvider {
  const errorText = error ?? "";
  if (!passport && job && isTranscribeStepRunning(job)) {
    return "whisper";
  }
  if (!passport && mentionsScribe(errorText) && !mentionsWhisper(errorText)) {
    return "whisper";
  }
  if (!passport && mentionsWhisper(errorText) && !mentionsScribe(errorText)) {
    return "scribe";
  }

  const asrEngine = passport?.clip.asrEngine ?? recovery?.asrEngine;
  const asrSource = passport?.clip.asrSource ?? recovery?.asrSource;
  if (isScribeEngine(asrEngine) || (passport && asrSource === "external" && !asrEngine)) {
    return "whisper";
  }
  return "scribe";
}

function isTranscribeStepRunning(job: AnalysisJob): boolean {
  return job.status === "running" && job.progress.some((step) => step.id === "transcribe" && step.status === "running");
}

async function runRetranscriptionProvider(provider: RetranscriptionProvider, file: Express.Multer.File): Promise<TranscriptionResult> {
  if (provider === "scribe") {
    return transcribeWithElevenLabs(file);
  }
  return transcribeLiveVocal(file);
}

function retranscriptionProviderLabel(provider: RetranscriptionProvider): string {
  return provider === "scribe" ? "ElevenLabs Scribe" : "Whisper fallback";
}

function isScribeEngine(engine?: string): boolean {
  return Boolean(engine && /^(elevenlabs\/|elevenlabs scribe$)/i.test(engine.trim()));
}

function mentionsScribe(value: string): boolean {
  return /elevenlabs|scribe/i.test(value);
}

function mentionsWhisper(value: string): boolean {
  return /whisper|replicate/i.test(value);
}

function buildRecoveryFromSavedMedia(
  job: AnalysisJob,
  media: { buffer: Buffer; mimetype: string; filename: string }
): AnalysisRecovery {
  const source: ClipSource = { kind: "upload", processingMode: "uploaded_media" };
  const issue = job.error
    ? `Previous run failed before recovery metadata was saved: ${job.error}`
    : "Previous run failed before recovery metadata was saved.";
  return {
    filename: media.filename,
    durationSeconds: fixtureClipDuration,
    autoMatch: true,
    vocalIsolationSource: "original",
    vocalIsolationConfidence: 0.58,
    vocalQuality: assessVocalTranscript([], "original", [issue]),
    asrSource: env.elevenlabsKey ? "external" : "replicate",
    asrEngine: env.elevenlabsKey ? `elevenlabs/${env.elevenlabsSttModel}` : "Whisper",
    transcript: [],
    source,
    performanceContext: fixturePerformanceContext,
    event: null
  };
}

async function buildPassportFromRetranscriptionRecovery(
  jobId: string,
  recovery: NonNullable<AnalysisJob["recovery"]>,
  analysisFile: Express.Multer.File,
  transcription: TranscriptionResult,
  provider: RetranscriptionProvider
): Promise<AnalysisJob> {
  const label = retranscriptionProviderLabel(provider);
  const selected: VocalTranscriptionSelection = {
    transcription,
    vocal: {
      source: "original",
      confidence: recovery.vocalIsolationConfidence,
      detail: `${label} recovered the transcript after the previous ASR run failed.`
    },
    vocalQuality: assessVocalTranscript(transcription.segments, "original")
  };
  const retryInput: AnalyzeInput = {
    track: recovery.track,
    trackQuery: recovery.trackQuery,
    event: recovery.event,
    eventCity: recovery.eventCity,
    eventDate: recovery.eventDate,
    durationSeconds: recovery.durationSeconds,
    autoMatch: recovery.autoMatch ?? !recovery.track,
    source: recovery.source
  };

  setStep(jobId, "transcribe", "complete", `${label} recovered ${transcription.segments.length} segment${transcription.segments.length === 1 ? "" : "s"}.`);
  setStep(jobId, "anchor", "running", `Matching recording from ${label} transcript.`);
  let track: TrackCandidate;
  let resolved: Awaited<ReturnType<typeof resolveTrack>>;
  try {
    resolved = await resolveTrack(retryInput, transcription.segments);
    track = resolved.track;
  } catch (error) {
    throw new Error(`${label} produced a transcript, but the track still could not be anchored: ${error instanceof Error ? error.message : "unknown anchor error"}`);
  }

  const event = await resolveEvent(retryInput, track);
  const liveContext = buildLiveContext(event, track);
  setStep(
    jobId,
    "anchor",
    "complete",
    `${track.title} by ${track.artist} · ${resolved.matchMethod.replaceAll("_", " ")}${resolved.detail ? ` · ${resolved.detail}` : ""}${event ? ` · ${event.venue}` : ""}`
  );

  setStep(jobId, "compare", "running");
  const canonical = await getCanonicalReference(track);
  track = enrichTrackWithCanonical(track, canonical);
  setStep(
    jobId,
    "compare",
    "complete",
    canonical.restricted
      ? "Lyrics restricted; passport switched to metadata-only comparison."
      : `${canonical.lines.length} reference lines from ${canonical.source}.`
  );

  setStep(jobId, "passport", "running", `Generating passport from ${label} transcript.`);
  const passport = buildPassportForSelection({
    jobId,
    input: retryInput,
    analysisFile,
    effectiveSource: recovery.source,
    track,
    event,
    canonical,
    liveContext,
    performanceContext: recovery.performanceContext,
    resolved,
    selected
  });
  assertSelectedTrackFitsTranscript(passport);

  const updated = updateJob(jobId, (current) => ({
    ...current,
    status: "complete",
    passport,
    recovery: undefined,
    error: undefined
  }));
  setStep(jobId, "passport", "complete", `${passport.variants.length} variant candidates flagged after ${label} recovery.`);
  if (!updated) {
    throw new Error("Analysis job no longer exists.");
  }
  return jobs.get(jobId) ?? updated;
}

function mediaToMulterFile(media: { buffer: Buffer; mimetype: string; filename: string }): Express.Multer.File {
  return {
    fieldname: "clip",
    originalname: media.filename,
    encoding: "7bit",
    mimetype: media.mimetype,
    size: media.buffer.length,
    buffer: media.buffer,
    stream: undefined as never,
    destination: "",
    filename: media.filename,
    path: ""
  };
}

function enrichTrackWithCanonical(track: TrackCandidate, canonical: Awaited<ReturnType<typeof getCanonicalReference>>): TrackCandidate {
  return canonical.trackUrl && canonical.trackUrl !== track.url
    ? { ...track, url: canonical.trackUrl }
    : track;
}

function stemSourceLabel(source: VocalIsolationResult["source"]): string {
  return source === "lalalai" ? "LALAL.AI" : source === "demucs" ? "Demucs" : "Separated-audio";
}

async function selectVocalTranscription(
  jobId: string,
  analysisFile: Express.Multer.File | undefined,
  vocal: VocalIsolationResult,
  recallSegments: TranscriptSegment[],
  effectiveSource?: ClipSource
): Promise<VocalTranscriptionSelection> {
  if (recallSegments.length && !analysisFile) {
    const transcription = { source: "external" as const, segments: recallSegments };
    return {
      transcription,
      vocal,
      vocalQuality: assessVocalTranscript(transcription.segments, "original")
    };
  }

  let scribeError: string | undefined;
  if (analysisFile && !vocal.vocalUrl && env.elevenlabsKey) {
    try {
      const scribe = await transcribeWithPrimaryScribe(jobId, analysisFile, effectiveSource);
      const scribeVocal = {
        ...vocal,
        detail: scribe.normalized
          ? "ElevenLabs Scribe selected as the primary ASR engine after normalizing the provider excerpt."
          : "ElevenLabs Scribe selected as the primary ASR engine on original audio."
      };
      const vocalQuality = addIsolationDetail(assessVocalTranscript(scribe.transcription.segments, vocal.source), scribeVocal);
      return {
        transcription: scribe.transcription,
        vocal: scribeVocal,
        vocalQuality: scribe.normalized ? appendVocalDetail(vocalQuality, scribeVocal.detail) : vocalQuality
      };
    } catch (error) {
      scribeError = error instanceof Error ? error.message : "ElevenLabs Scribe transcription failed";
      setStep(jobId, "transcribe", "running", `ElevenLabs Scribe failed; retrying Whisper fallback. ${scribeError}`);
    }
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
    if (scribeError) {
      const whisperError = error instanceof Error ? error.message : "Whisper fallback failed";
      throw new Error(`ElevenLabs Scribe failed: ${scribeError}; Whisper fallback failed: ${whisperError}`);
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

async function transcribeWithPrimaryScribe(
  jobId: string,
  file: Express.Multer.File,
  effectiveSource?: ClipSource
): Promise<{ transcription: TranscriptionResult; normalized: boolean }> {
  try {
    return { transcription: await transcribeWithElevenLabs(file), normalized: false };
  } catch (error) {
    const firstError = error instanceof Error ? error.message : "ElevenLabs Scribe transcription failed";
    if (!isProviderExcerptSource(effectiveSource) || !shouldRetryScribeWithNormalizedExcerpt(firstError)) {
      throw new Error(firstError);
    }

    setStep(jobId, "transcribe", "running", `Scribe rejected the provider excerpt; normalizing MP3 and retrying. ${firstError}`);
    try {
      const normalized = await transcodeMediaToMp3(file, "scribe");
      const transcription = await transcribeWithElevenLabs(normalized);
      jobMedia.set(jobId, {
        buffer: normalized.buffer,
        mimetype: normalized.mimetype || "audio/mpeg",
        filename: normalized.originalname
      });
      return { transcription, normalized: true };
    } catch (retryError) {
      const retryDetail = retryError instanceof Error ? retryError.message : "normalized provider excerpt retry failed";
      throw new Error(`${firstError}; normalized provider excerpt retry failed: ${retryDetail}`);
    }
  }
}

function isProviderExcerptSource(source?: ClipSource): boolean {
  return source?.kind === "live_link" && source.processingMode === "provider_excerpt";
}

function shouldRetryScribeWithNormalizedExcerpt(message: string): boolean {
  return !/timed out|401|403|429|unauthorized|forbidden|api key|auth|quota|credit|rate limit|too many requests|model not found/i.test(message);
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
  const sourceLabel = selection.vocal.source === "lalalai"
    ? "LALAL.AI stem"
    : selection.vocal.source === "demucs"
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

function appendVocalDetail(report: VocalQualityReport, detail: string): VocalQualityReport {
  return {
    ...report,
    detail: `${report.detail} ${detail}`
  };
}

type PassportBuildArgs = {
  jobId: string;
  input: AnalyzeInput;
  analysisFile?: Express.Multer.File;
  effectiveSource?: ClipSource;
  track: TrackCandidate;
  event: EventCandidate | null;
  canonical: Awaited<ReturnType<typeof getCanonicalReference>>;
  liveContext: ReturnType<typeof buildLiveContext>;
  performanceContext: Awaited<ReturnType<typeof analyzePerformance>>;
  resolved: Awaited<ReturnType<typeof resolveTrack>>;
  selected: VocalTranscriptionSelection;
};

function buildPassportForSelection(args: PassportBuildArgs): LiveVariantPassport {
  return buildPassport({
    id: args.jobId,
    track: args.track,
    event: args.event,
    filename: args.analysisFile?.originalname ?? sourceFilename(args.input.source),
    durationSeconds: args.input.durationSeconds ?? fixtureClipDuration,
    canonicalLines: args.canonical.lines,
    transcript: args.selected.transcription.segments,
    sourceCoverage: args.canonical.sourceCoverage,
    canonicalSource: args.canonical.source,
    restricted: args.canonical.restricted,
    language: args.canonical.language,
    copyright: args.canonical.copyright,
    trackingUrl: args.canonical.trackingUrl,
    matchMethod: args.resolved.matchMethod,
    vocalIsolationSource: args.selected.vocal.source,
    vocalIsolationConfidence: args.selected.vocal.confidence,
    vocalQuality: args.selected.vocalQuality,
    asrSource: args.selected.transcription.source,
    asrEngine: args.selected.transcription.engine,
    source: args.effectiveSource ?? {
      kind: args.analysisFile ? "upload" : "recall_recording",
      processingMode: args.analysisFile ? "uploaded_media" : "recall_recording"
    },
    liveContext: args.liveContext,
    performanceContext: args.performanceContext
  });
}

async function resolveTrack(
  input: AnalyzeInput,
  transcript: TranscriptSegment[],
  audioIdentity?: AudioIdentityMatch
): Promise<{
  track: TrackCandidate;
  matchMethod: RecordingMatchMethod;
  detail?: string;
}> {
  if (input.track && !input.autoMatch) {
    return { track: input.track, matchMethod: "selected_track" };
  }
  if (input.autoMatch) {
    if (audioIdentity) {
      return {
        track: audioIdentity.track,
        matchMethod: "audio_identify",
        detail: audioIdentity.detail
      };
    }
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
    if (input.source?.kind === "upload" && input.source.startSeconds !== undefined && input.source.endSeconds !== undefined) {
      return trimMediaExcerptToMp3(input.file, input.source.startSeconds, input.source.endSeconds);
    }
    return input.file;
  }
  if (input.source?.kind === "live_link" && input.source.processingMode === "provider_excerpt" && detectLiveLinkProvider(input.source.url ?? "")) {
    if (!env.youtubeExtractionEnabled) {
      throw new Error("Live-link extraction is disabled for this server. Attach an authorized excerpt instead.");
    }
    return extractProviderExcerpt(input.source);
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
  return "source-media";
}

async function resolveEvent(
  input: Pick<AnalyzeInput, "event" | "eventCity" | "eventDate">,
  track: TrackCandidate
): Promise<EventCandidate | null> {
  if (input.event) {
    return input.event;
  }
  const hasEventHint = Boolean(input.eventCity?.trim() || input.eventDate?.trim());
  if (!hasEventHint) {
    return null;
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
