import type { AnalysisJob } from "../shared/types";

type Subscriber = (job: AnalysisJob) => void;

const subscribers = new Map<string, Set<Subscriber>>();

export function addJobSubscriber(jobId: string, callback: Subscriber): () => void {
  if (!subscribers.has(jobId)) subscribers.set(jobId, new Set());
  subscribers.get(jobId)!.add(callback);
  return () => {
    const subs = subscribers.get(jobId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) subscribers.delete(jobId);
    }
  };
}

export function notifyJobSubscribers(jobId: string, job: AnalysisJob) {
  const subs = subscribers.get(jobId);
  if (!subs) return;
  for (const callback of subs) {
    try { callback(job); } catch { /* subscriber dropped */ }
  }
  if (job.status === "complete" || job.status === "failed") {
    subscribers.delete(jobId);
  }
}
