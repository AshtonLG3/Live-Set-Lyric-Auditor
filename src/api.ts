import type { AnalysisJob, ClipSource, EventCandidate, HealthResponse, NarrationResponse, RecallRescueResponse, TrackCandidate, VariantCandidate } from "../shared/types";

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

export async function createNarration(jobId: string, manualVariants: VariantCandidate[] = []): Promise<NarrationResponse> {
  return fetchJson(`/api/narrate/${jobId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manualVariants })
  });
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
