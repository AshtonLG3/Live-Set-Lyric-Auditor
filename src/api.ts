import type { AnalysisJob, ClipSource, EventCandidate, HealthResponse, NarrationResponse, RecallRescueResponse, TrackCandidate, TranscriptSegment, VariantCandidate } from "../shared/types";

export async function getHealth(): Promise<HealthResponse> {
  return fetchJson("/api/health");
}

export async function searchTracks(query: string): Promise<TrackCandidate[]> {
  const response = await fetchJson<{ tracks: TrackCandidate[] }>(`/api/music/search?q=${encodeURIComponent(query)}`);
  return response.tracks;
}

export async function searchEvents(input: { artist: string; city: string; date: string }): Promise<EventCandidate[]> {
  const params = new URLSearchParams(input);
  const response = await fetchJson<{ events: EventCandidate[] }>(`/api/events/search?${params.toString()}`);
  return response.events;
}

export async function startAnalysis(input: {
  file?: File;
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
}): Promise<{ jobId: string }> {
  const formData = new FormData();
  if (input.file) formData.append("clip", input.file);
  if (input.track) formData.append("track", JSON.stringify(input.track));
  if (input.event !== undefined) formData.append("event", JSON.stringify(input.event));
  if (input.trackQuery) formData.append("trackQuery", input.trackQuery);
  if (input.eventCity) formData.append("eventCity", input.eventCity);
  if (input.eventDate) formData.append("eventDate", input.eventDate);
  if (input.durationSeconds) formData.append("durationSeconds", String(input.durationSeconds));
  formData.append("autoMatch", String(Boolean(input.autoMatch)));
  formData.append("useFixture", String(Boolean(input.useFixture)));
  if (input.source) formData.append("source", JSON.stringify(input.source));
  if (input.recallSegments?.length) formData.append("recallSegments", JSON.stringify(input.recallSegments));

  const response = await fetch("/api/analyze", {
    method: "POST",
    body: formData
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function rescueRecall(input: { file?: File; phrase?: string }): Promise<RecallRescueResponse> {
  const formData = new FormData();
  if (input.file) formData.append("fragment", input.file);
  if (input.phrase) formData.append("phrase", input.phrase);
  const response = await fetch("/api/recall", { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

export async function getAnalysis(jobId: string): Promise<AnalysisJob> {
  return fetchJson(`/api/analyze/${jobId}`);
}

export async function reanchorAnalysis(jobId: string, track: TrackCandidate): Promise<AnalysisJob> {
  return fetchJson(`/api/analyze/${jobId}/reanchor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track })
  });
}

export async function createNarration(
  jobId: string,
  manualVariants: VariantCandidate[] = [],
  editedTexts: Record<string, string> = {},
  reviewDecisions: Partial<Record<string, string>> = {}
): Promise<NarrationResponse> {
  return fetchJson(`/api/narrate/${jobId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manualVariants, editedTexts, reviewDecisions })
  });
}

export function subscribeToJob(jobId: string, onUpdate: (job: AnalysisJob) => void, onError?: (error: Error) => void): () => void {
  let cancelled = false;
  let fallbackCleanup: (() => void) | undefined;

  try {
    if (typeof EventSource === "undefined") throw new Error("SSE unavailable");
    const source = new EventSource(`/api/analyze/${jobId}/events`);
    source.onmessage = (event) => {
      if (cancelled) return;
      try {
        onUpdate(JSON.parse(event.data));
      } catch { /* malformed message */ }
    };
    source.onerror = () => {
      source.close();
      if (!cancelled && !fallbackCleanup) {
        fallbackCleanup = fallbackPoll(jobId, onUpdate, onError, () => cancelled);
      }
    };
    return () => { cancelled = true; source.close(); fallbackCleanup?.(); };
  } catch {
    fallbackCleanup = fallbackPoll(jobId, onUpdate, onError, () => cancelled);
    return () => { cancelled = true; fallbackCleanup?.(); };
  }
}

function fallbackPoll(jobId: string, onUpdate: (job: AnalysisJob) => void, onError: ((error: Error) => void) | undefined, isCancelled: () => boolean): () => void {
  let timer = 0;
  const poll = async () => {
    try {
      const updated = await getAnalysis(jobId);
      if (isCancelled()) return;
      onUpdate(updated);
      if (updated.status !== "complete" && updated.status !== "failed") {
        timer = window.setTimeout(poll, 800);
      }
    } catch (error) {
      if (isCancelled()) return;
      if (onError) onError(error instanceof Error ? error : new Error("Analysis status could not be refreshed."));
      else timer = window.setTimeout(poll, 2000);
    }
  };
  timer = window.setTimeout(poll, 800);
  return () => window.clearTimeout(timer);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.json();
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.error ?? response.statusText;
  } catch {
    return response.statusText;
  }
}
