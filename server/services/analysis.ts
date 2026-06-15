import type { ClipSource, EventCandidate, RecallRescueResponse, TrackCandidate, TranscriptSegment } from "../../shared/types";
import { fixtureClipDuration, fixtureEvents, fixtureTracks } from "../data/fixtures";
import { transcribeLiveVocal, transcribeRecallFragment } from "../adapters/asr";
import { analyzePerformance } from "../adapters/cyanite";
import { narratePassport } from "../adapters/elevenlabs";
import { buildLiveContext, searchEvents } from "../adapters/jambase";
import { isolateVocals } from "../adapters/lalal";
import { getCanonicalReference, identifyTrackFromLyrics, searchTracksByLyrics } from "../adapters/musixmatch";
import { extractYouTubeExcerpt } from "../adapters/youtube";
import { jobs, setStep, updateJob } from "../store";
import { buildPassport } from "./alignment";

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
    const analysisFile = await resolveAnalysisFile(input);
    const effectiveSource = analysisFile && !input.file && input.source?.kind === "live_link"
      ? { ...input.source, processingMode: "provider_excerpt" as const }
      : input.source;
    setStep(
      jobId,
      "ingest",
      "complete",
      analysisFile
        ? `${analysisFile.originalname} · ${formatBytes(analysisFile.size)} · ${Math.round(input.durationSeconds ?? fixtureClipDuration)}s`
        : input.source?.kind === "live_link"
          ? `${providerLabel(input.source)} reference · no processable excerpt`
          : "Seeded fixture clip loaded."
    );

    setStep(jobId, "isolate", "running");
    const vocal = await isolateVocals(analysisFile);
    setStep(jobId, "isolate", "complete", vocal.detail);

    setStep(jobId, "profile", "running");
    const performanceContext = await analyzePerformance({ file: analysisFile, source: effectiveSource });
    setStep(
      jobId,
      "profile",
      "complete",
      `${performanceContext.source === "cyanite" ? "Cyanite" : "Demo profile"} · ${Math.round(performanceContext.energyLevel * 100)}% energy · ${performanceContext.arrangement.replaceAll("_", " ")}`
    );

    setStep(jobId, "transcribe", "running");
    const transcription = await transcribeLiveVocal(analysisFile, vocal.vocalUrl);
    setStep(jobId, "transcribe", "complete", `${transcription.segments.length} vocal segments from ${transcription.source}.`);

    setStep(jobId, "anchor", "running");
    const resolved = await resolveTrack(input, transcription.segments);
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
      transcript: transcription.segments,
      sourceCoverage: canonical.sourceCoverage,
      canonicalSource: canonical.source,
      restricted: canonical.restricted,
      language: canonical.language,
      copyright: canonical.copyright,
      trackingUrl: canonical.trackingUrl,
      matchMethod: resolved.matchMethod,
      vocalIsolationSource: vocal.source,
      vocalIsolationConfidence: vocal.confidence,
      asrSource: transcription.source,
      source: effectiveSource ?? {
        kind: analysisFile ? "upload" : "fixture",
        processingMode: analysisFile ? "uploaded_media" : "fixture"
      },
      liveContext,
      performanceContext
    });

    updateJob(jobId, (job) => ({
      ...job,
      status: "complete",
      passport
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

export async function createNarration(jobId: string) {
  const job = jobs.get(jobId);
  if (!job?.passport) {
    throw new Error("Analysis job is not complete.");
  }
  return narratePassport(jobId, job.passport);
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
  if (input.source?.kind === "live_link" && input.source.provider === "youtube") {
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
  if (input.event !== undefined) {
    return input.event;
  }
  const events = await searchEvents({
    artist: track.artist,
    city: input.eventCity ?? fixtureEvents[0].city,
    date: input.eventDate ?? fixtureEvents[0].date
  });
  return events[0] ?? null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
