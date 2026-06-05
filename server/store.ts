import type { AnalysisJob } from "../shared/types";

export const jobs = new Map<string, AnalysisJob>();

export function createJob(): AnalysisJob {
  const now = new Date().toISOString();
  const job: AnalysisJob = {
    id: crypto.randomUUID(),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    progress: [
      { id: "anchor", label: "Anchor track and event", status: "queued" },
      { id: "isolate", label: "Isolate live vocal", status: "queued" },
      { id: "transcribe", label: "Transcribe vocal", status: "queued" },
      { id: "compare", label: "Align to canonical reference", status: "queued" },
      { id: "passport", label: "Generate Live Variant Passport", status: "queued" }
    ]
  };
  jobs.set(job.id, job);
  return job;
}

export function updateJob(id: string, updater: (job: AnalysisJob) => AnalysisJob): AnalysisJob | undefined {
  const current = jobs.get(id);
  if (!current) {
    return undefined;
  }
  const updated = updater({ ...current, progress: current.progress.map((step) => ({ ...step })) });
  updated.updatedAt = new Date().toISOString();
  jobs.set(id, updated);
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

