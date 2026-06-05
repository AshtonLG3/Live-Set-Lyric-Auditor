import type { EventCandidate, TrackCandidate } from "../../shared/types";
import { fixtureClipDuration, fixtureEvents, fixtureTracks } from "../data/fixtures";
import { transcribeLiveVocal } from "../adapters/asr";
import { narratePassport } from "../adapters/elevenlabs";
import { searchEvents } from "../adapters/jambase";
import { isolateVocals } from "../adapters/lalal";
import { getCanonicalReference, searchTracks } from "../adapters/musixmatch";
import { jobs, setStep, updateJob } from "../store";
import { buildPassport } from "./alignment";

export type AnalyzeInput = {
  file?: Express.Multer.File;
  track?: TrackCandidate;
  event?: EventCandidate | null;
  trackQuery?: string;
  eventCity?: string;
  eventDate?: string;
};

export async function runAnalysis(jobId: string, input: AnalyzeInput): Promise<void> {
  try {
    updateJob(jobId, (job) => ({ ...job, status: "running" }));

    setStep(jobId, "anchor", "running");
    const track = await resolveTrack(input);
    const event = await resolveEvent(input, track);
    setStep(jobId, "anchor", "complete", `${track.title} by ${track.artist}${event ? ` at ${event.venue}` : ""}`);

    setStep(jobId, "isolate", "running");
    const vocal = await isolateVocals(input.file);
    setStep(jobId, "isolate", "complete", vocal.detail);

    setStep(jobId, "transcribe", "running");
    const transcription = await transcribeLiveVocal(input.file);
    setStep(jobId, "transcribe", "complete", `${transcription.segments.length} vocal segments from ${transcription.source}.`);

    setStep(jobId, "compare", "running");
    const canonical = await getCanonicalReference(track);
    setStep(jobId, "compare", "complete", `${canonical.lines.length} reference lines from ${canonical.source}.`);

    setStep(jobId, "passport", "running");
    const passport = buildPassport({
      id: jobId,
      track,
      event,
      filename: input.file?.originalname ?? "seeded-demo-clip.mp3",
      durationSeconds: input.file ? fixtureClipDuration : fixtureClipDuration,
      canonicalLines: canonical.lines,
      transcript: transcription.segments,
      sourceCoverage: canonical.sourceCoverage,
      vocalIsolationSource: vocal.source,
      vocalIsolationConfidence: vocal.confidence,
      asrSource: transcription.source
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

async function resolveTrack(input: AnalyzeInput): Promise<TrackCandidate> {
  if (input.track) {
    return input.track;
  }
  const tracks = await searchTracks(input.trackQuery ?? fixtureTracks[0].title);
  return tracks[0] ?? fixtureTracks[0];
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

