import { APP_VERSION } from "./version";

export type RuntimeMode = "live" | "fixture" | "mixed";

export type IntegrationName =
  | "Musixmatch"
  | "Audio ID"
  | "LALAL.AI"
  | "Demucs"
  | "JamBase"
  | "Cyanite"
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
  lyricSimilarity?: number;
  url?: string;
  source: "musixmatch" | "fixture" | "manual";
};

export type EventCandidate = {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  venue: string;
  venueId?: string;
  city: string;
  date: string;
  tourName?: string;
  festivalName?: string;
  lineup?: string[];
  setlist?: {
    available: boolean;
    songs?: string[];
    sourceUrl?: string;
  };
  url?: string;
  source: "jambase" | "fixture";
};

export type LiveContext = {
  source: "jambase" | "fixture";
  eventId: string;
  artistId?: string;
  venueId?: string;
  tourName?: string;
  festivalName?: string;
  lineup: string[];
  setlist: {
    available: boolean;
    position?: number;
    songCount?: number;
    previousSong?: string;
    nextSong?: string;
    sourceUrl?: string;
  };
  summary: string;
  confidence: number;
};

export type PerformanceContext = {
  source: "cyanite" | "fixture";
  status: "complete" | "fallback";
  energyLevel: number;
  bpm?: number;
  dominantEmotions: string[];
  instruments: string[];
  valence?: number;
  arousal?: number;
  arrangement: "full_band" | "stripped_back" | "high_intensity" | "crowd_forward" | "uncertain";
  summary: string;
  confidence: number;
};

export type AnalysisRecovery = {
  filename: string;
  durationSeconds: number;
  track?: TrackCandidate;
  trackQuery?: string;
  autoMatch?: boolean;
  vocalIsolationSource: "lalalai" | "demucs" | "original" | "fixture";
  vocalIsolationConfidence: number;
  vocalQuality?: VocalQualityReport;
  asrSource: "replicate" | "external" | "fixture";
  asrEngine?: string;
  transcript: TranscriptSegment[];
  source: ClipSource;
  performanceContext: PerformanceContext;
  event: EventCandidate | null;
  eventCity?: string;
  eventDate?: string;
};

export type VocalQualityStatus = "passed" | "warning" | "failed" | "fallback_original";

export type VocalQualityReport = {
  selectedSource: "lalalai" | "demucs" | "original" | "fixture";
  rejectedSource?: "lalalai" | "demucs";
  status: VocalQualityStatus;
  score: number;
  segmentCount: number;
  tokenCount: number;
  uniqueTokenRatio: number;
  repetitionRatio: number;
  averageConfidence: number;
  dominantPhrase?: string;
  issues: string[];
  fallbackUsed: boolean;
  detail: string;
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
  processingMode: "uploaded_media" | "authorized_excerpt" | "provider_excerpt" | "reference_fixture" | "recall_recording" | "fixture";
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
  | "crowd_response"
  | "adlib"
  | "timing_drift"
  | "uncertain";

export type EvidenceTier =
  | "aligned"
  | "likely_change"
  | "needs_review"
  | "asr_uncertain"
  | "source_gap";

export type VariantCandidate = {
  id: string;
  type: VariantType;
  start: number;
  end: number;
  liveText: string;
  canonicalAlignmentReference: string;
  canonicalExcerpt?: string;
  confidence: number;
  impactNote: string;
  recommendedAction: string;
  translationRisk: "low" | "medium" | "high";
  severity: "low" | "medium" | "high";
  evidenceSource?: "asr_alignment" | "manual_entry";
  evidenceTier?: EvidenceTier;
  reviewerNote?: string;
};

export type LineComparisonStatus =
  | "matched"
  | "changed"
  | "skipped"
  | "repeated"
  | "live_only"
  | "timing_drift"
  | "uncertain";

export type WordDiff = {
  kept: string[];
  removed: string[];
  added: string[];
};

export type LineComparison = {
  id: string;
  start: number;
  end: number;
  canonicalId?: string;
  canonicalText?: string;
  canonicalPreviousText?: string;
  canonicalNextText?: string;
  liveText: string;
  similarity: number;
  timingDelta: number;
  rawTimingDelta?: number;
  clipOffset?: number;
  status: LineComparisonStatus;
  changedWords: WordDiff;
  evidenceTier?: EvidenceTier;
  variantId?: string;
};

export type CanonicalSource = "richsync" | "subtitles" | "lyrics" | "metadata-only" | "fixture";

export type RecordingMatchMethod = "selected_track" | "audio_identify" | "lyrics_rescue" | "recall_rescue" | "fixture_rescue";

export type RecordingIdentity = {
  trackId: string;
  commonTrackId?: string;
  isrc?: string;
  matchMethod: RecordingMatchMethod;
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
  asrUncertainSegments?: number;
  timingOffsetSeconds?: number;
  averageTimingDelta?: number;
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
    vocalIsolationSource: "lalalai" | "demucs" | "original" | "fixture";
    vocalIsolationConfidence: number;
    vocalQuality?: VocalQualityReport;
    asrSource: "replicate" | "external" | "fixture";
    asrEngine?: string;
    transcript: TranscriptSegment[];
    source: ClipSource;
  };
  summary: string;
  liveContext: LiveContext | null;
  performanceContext: PerformanceContext;
  recordingIdentity: RecordingIdentity;
  rights: RightsStatus;
  structureMap: StructureMap;
  confidenceOverview: ConfidenceOverview;
  lineComparisons: LineComparison[];
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
  recovery?: AnalysisRecovery;
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
