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
  commonTrackId?: string;
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  durationSeconds?: number;
  hasLyrics: boolean;
  hasSubtitles: boolean;
  hasRichSync?: boolean;
  instrumental?: boolean;
  explicit?: boolean;
  language?: string;
  genre?: string;
  releaseType?: string;
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

export type SourceProvider = "youtube" | "vimeo" | "soundcloud" | "direct_media" | "other";

export type ClipSource = {
  kind: "upload" | "live_link" | "recall_recording" | "fixture";
  processingMode: "uploaded_media" | "authorized_excerpt" | "reference_fixture" | "recall_recording" | "fixture";
  provider?: SourceProvider;
  url?: string;
  startSeconds?: number;
  endSeconds?: number;
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
  recommendedAction: string;
  translationRisk: "low" | "medium" | "high";
  severity: "low" | "medium" | "high";
};

export type CanonicalSource = "richsync" | "subtitles" | "lyrics" | "metadata-only" | "fixture";

export type RecordingIdentity = {
  trackId: string;
  commonTrackId?: string;
  isrc?: string;
  matchMethod: "selected_track" | "lyrics_rescue" | "recall_rescue" | "fixture_rescue";
  versionConfidence: number;
  syncFitScore: number;
  canonicalSource: CanonicalSource;
};

export type RightsStatus = {
  status: "display_allowed" | "restricted" | "metadata_only" | "fixture";
  language?: string;
  copyright?: string;
  attribution: string;
  trackingRequired: boolean;
};

export type StructureMap = {
  canonical: string[];
  live: string[];
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
    source: ClipSource;
  };
  summary: string;
  recordingIdentity: RecordingIdentity;
  rights: RightsStatus;
  structureMap: StructureMap;
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

export type RecallRescueResponse = {
  transcript: string;
  segments: TranscriptSegment[];
  candidates: TrackCandidate[];
  mode: "typed_lyrics_search" | "asr_lyrics_search" | "fixture";
};
