import type { AnalysisJob } from "../shared/types";
import { notifyJobSubscribers } from "./sse";

const MAX_JOBS = 50;
const JOB_TTL_MS = 60 * 60 * 1000;

export const jobs = new Map<string, AnalysisJob>();
export const jobMedia = new Map<string, { buffer: Buffer; mimetype: string; filename: string }>();

export function createJob(): AnalysisJob {
  evictStaleJobs();
  const now = new Date().toISOString();
  const job: AnalysisJob = {
    id: crypto.randomUUID(),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    progress: [
      { id: "ingest", label: "Validate source and clip", status: "queued" },
      { id: "isolate", label: "Isolate live vocal", status: "queued" },
      { id: "profile", label: "Profile live arrangement", status: "queued" },
      { id: "transcribe", label: "Transcribe vocal", status: "queued" },
      { id: "anchor", label: "Match recording and version", status: "queued" },
      { id: "compare", label: "Compare word timing and structure", status: "queued" },
      { id: "passport", label: "Generate Live Variant Passport", status: "queued" }
    ]
  };
  jobs.set(job.id, job);
  return job;
}

function evictStaleJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const age = now - new Date(job.updatedAt).getTime();
    if (age > JOB_TTL_MS && job.status !== "running") {
      jobs.delete(id);
      jobMedia.delete(id);
    }
  }
  if (jobs.size > MAX_JOBS) {
    const sorted = [...jobs.entries()]
      .filter(([, j]) => j.status !== "running")
      .sort(([, a], [, b]) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
    while (jobs.size > MAX_JOBS && sorted.length) {
      const [id] = sorted.shift()!;
      jobs.delete(id);
      jobMedia.delete(id);
    }
  }
}

export function updateJob(id: string, updater: (job: AnalysisJob) => AnalysisJob): AnalysisJob | undefined {
  const current = jobs.get(id);
  if (!current) {
    return undefined;
  }
  const updated = updater({ ...current, progress: current.progress.map((step) => ({ ...step })) });
  updated.updatedAt = new Date().toISOString();
  jobs.set(id, updated);
  notifyJobSubscribers(id, updated);
  return updated;
}

export function setStep(jobId: string, stepId: string, status: AnalysisJob["progress"][number]["status"], detail?: string) {
  updateJob(jobId, (job) => ({
    ...job,
    progress: job.progress.map((step) =>
      step.id === stepId ? { ...step, status, detail } : step
    )
  }));
}
