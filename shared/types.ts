import { APP_VERSION } from "./version";

export type RuntimeMode = "live" | "fixture" | "mixed";

export type IntegrationName =
  | "Musixmatch"
  | "LALAL.AI"
  | "JamBase"
  | "ElevenLabs"
  | "ASR";

export type IntegrationStatus = {
  name: IntegrationName;
  configured: boolean;
  mode: RuntimeMode;
  detail: string;
};

export type HealthResponse = {
  appName: string;
  version: typeof APP_VERSION;
  runtimeMode: RuntimeMode;
  integrations: IntegrationStatus[];
};

export type TrackCandidate = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  hasLyrics: boolean;
  hasSubtitles: boolean;
  rating?: number;
  source: "musixmatch" | "fixture";
};

export type EventCandidate = {
  id: string;
  title: string;
  artist: string;
  venue: string;
  city: string;
  date: string;
  url?: string;
  source: "jambase" | "fixture";
};

export type TranscriptSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
  confidence: number;
};

export type VariantType =
  | "substitution"
  | "skipped_line"
  | "repeated_hook"
  | "extension"
  | "city_shoutout"
  | "adlib"
  | "timing_drift"
  | "uncertain";

export type VariantCandidate = {
  id: string;
  type: VariantType;
  start: number;
  end: number;
  liveText: string;
  canonicalAlignmentReference: string;
  confidence: number;
  impactNote: string;
  severity: "low" | "medium" | "high";
};

export type ConfidenceOverview = {
  overall: number;
  asr: number;
  alignment: number;
  sourceCoverage: number;
};

export type LiveVariantPassport = {
  id: string;
  createdAt: string;
  version: typeof APP_VERSION;
  track: TrackCandidate;
  event: EventCandidate | null;
  clip: {
    filename: string;
    durationSeconds: number;
    vocalIsolationSource: "lalalai" | "fixture";
    asrSource: "external" | "fixture";
  };
  summary: string;
  confidenceOverview: ConfidenceOverview;
  variants: VariantCandidate[];
  complianceNotes: string[];
};

export type JobStatus = "queued" | "running" | "complete" | "failed";
export type StepStatus = "queued" | "running" | "complete" | "failed";

export type AnalysisStep = {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
};

export type AnalysisJob = {
  id: string;
  status: JobStatus;
  progress: AnalysisStep[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  passport?: LiveVariantPassport;
};

export type NarrationResponse = {
  jobId: string;
  mode: "elevenlabs" | "fixture";
  text: string;
  audioUrl?: string;
};

