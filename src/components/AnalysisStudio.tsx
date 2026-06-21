import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  AudioWaveform,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Fingerprint,
  Gauge,
  Link2,
  ListMusic,
  Pencil,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import type {
  AnalysisJob,
  AnalysisStep,
  EventCandidate,
  HealthResponse,
  NarrationResponse,
  TrackCandidate,
  VariantCandidate,
  VocalQualityReport
} from "../../shared/types";
import { formatEventDate } from "../../shared/format";
import { MediaPlayerBar, type MediaPlayerHandle } from "./MediaPlayerBar";
import { CorrectionPanel } from "./CorrectionPanel";
import { ManualMomentPanel } from "./ManualMomentPanel";
import { DiffView } from "./DiffView";
import {
  type ReviewDecision,
  type ReviewDecisions,
  matchesFilter,
  riskMessage,
  formatSourceMode,
  formatRecordingId,
  formatTime,
  formatSignedSeconds,
  formatSetlistPosition,
  manualVariantToComparison,
  summarizeComparisons,
  comparisonStatusOrder,
  wordDiffSummary
} from "./studio-utils";

export type { ReviewDecision, ReviewDecisions };

type Props = {
  job: AnalysisJob | null;
  health: HealthResponse | null;
  selectedTrack?: TrackCandidate;
  selectedEvent?: EventCandidate | null;
  narration: NarrationResponse | null;
  error: string;
  decisions: ReviewDecisions;
  manualVariants: VariantCandidate[];
  onDecision: (id: string, decision: ReviewDecision) => void;
  editedTexts: Record<string, string>;
  onEditLiveText: (comparisonId: string, newText: string) => void;
  onAddManualVariant: (variant: VariantCandidate) => void;
  onNarrate: () => Promise<void> | void;
  onCorrectTrack: (track: TrackCandidate) => Promise<void> | void;
  onRetranscribe: () => Promise<void> | void;
  onVisitTrack: (track: TrackCandidate) => Promise<void> | void;
  onJoinLines: (current: NonNullable<AnalysisJob["passport"]>["lineComparisons"][number], next: NonNullable<AnalysisJob["passport"]>["lineComparisons"][number]) => void;
  onSplitLine: (comparison: NonNullable<AnalysisJob["passport"]>["lineComparisons"][number]) => void;
};

export function AnalysisStudio(props: Props) {
  const playerRef = useRef<MediaPlayerHandle>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [insertAfterTime, setInsertAfterTime] = useState(0);
  const passport = props.job?.passport;
  const recovery = props.job?.recovery;
  const track = passport?.track ?? (recovery ? undefined : props.selectedTrack);
  const event = passport ? passport.event : props.selectedEvent ?? null;
  const detectedVariants = passport?.variants ?? (props.job ? [] : previewVariants);
  const variants = useMemo(() => [...detectedVariants, ...props.manualVariants], [detectedVariants, props.manualVariants]);
  const comparisonRows = useMemo(() => {
    const detectedRows = passport?.lineComparisons ?? [];
    const merged = [...detectedRows, ...props.manualVariants.map(manualVariantToComparison)]
      .sort((a, b) => a.start - b.start || comparisonStatusOrder(a.status) - comparisonStatusOrder(b.status));
    return merged.map((row) => {
      const edited = props.editedTexts[row.id];
      if (!edited || edited === row.liveText) return row;
      const changedWords = wordDiffSummary(row.canonicalText ?? "", edited);
      const hasChanges = changedWords.removed.length > 0 || changedWords.added.length > 0;
      const newStatus = !row.canonicalText ? row.status
        : hasChanges ? "changed" as const
        : "matched" as const;
      return {
        ...row,
        liveText: edited,
        status: newStatus,
        changedWords
      };
    });
  }, [passport?.lineComparisons, props.manualVariants, props.editedTexts]);
  const steps = props.job?.progress ?? defaultSteps;
  const completeSteps = steps.filter((step) => step.status === "complete").length;
  const progress = Math.round((completeSteps / Math.max(1, steps.length)) * 100);
  const comparisonCounts = useMemo(() => summarizeComparisons(comparisonRows), [comparisonRows]);
  const approvedCount = Object.values(props.decisions).filter((decision) => decision === "approved").length;
  const rejectedCount = Object.values(props.decisions).filter((decision) => decision === "rejected").length;
  const status = props.job?.status ?? "queued";
  const active = status === "running" || status === "queued";
  const divergence = Math.round((1 - (passport?.confidenceOverview.alignment ?? 0.72)) * 100);
  const liveContext = passport?.liveContext;
  const performanceContext = passport?.performanceContext;
  const energyLevel = Math.round((performanceContext?.energyLevel ?? 0.86) * 100);
  const riskCount = variants.filter((v) => matchesFilter(v, "risk")).length;
  const transcript = passport?.clip.transcript ?? recovery?.transcript ?? [];
  const displayDuration = mediaDuration || passport?.clip.durationSeconds || recovery?.durationSeconds || 0;
  const activeTranscriptId = transcript.find((segment) => currentTime >= segment.start && currentTime < segment.end)?.id;
  const overallConfidence = Math.round((passport?.confidenceOverview.overall ?? 0.81) * 100);
  const asrUncertainCount = passport?.confidenceOverview.asrUncertainSegments ?? transcript.filter((segment) => segment.confidence < 0.7).length;
  const timingOffsetSeconds = passport?.confidenceOverview.timingOffsetSeconds ?? comparisonRows.find((row) => typeof row.clipOffset === "number")?.clipOffset ?? 0;
  const averageTimingDeltaSeconds = passport?.confidenceOverview.averageTimingDelta ?? average(comparisonRows.filter((row) => row.canonicalId).map((row) => row.timingDelta));
  const pendingCount = Math.max(0, variants.length - approvedCount - rejectedCount);
  const hasPassport = Boolean(passport);
  const needsTrackRecovery = Boolean(recovery && !passport);
  const canRunScribeRecovery = Boolean(props.job?.status === "failed" && !passport);
  // A run that finished without a passport (e.g. failed track-match) must not borrow
  // the marketing-preview numbers and read as a valid high-confidence passport. Preview
  // defaults are only honest before any run (no job yet).
  const ranWithoutResult = Boolean(props.job) && !hasPassport;
  const metricValue = (value: number) => (ranWithoutResult ? "—" : `${value}%`);
  const passportNeedsReview = Boolean(passport && (riskCount > 0 || overallConfidence < 70));
  const waveStatus = active
    ? undefined
    : ranWithoutResult
      ? props.job?.status === "failed" ? "FAILED" : "PENDING"
      : passportNeedsReview ? "REVIEW NEEDED" : "PASSPORT READY";
  const captureStatus = active
    ? undefined
    : ranWithoutResult
      ? props.job?.status === "failed" ? "FAILED" : "PENDING"
      : passportNeedsReview ? "REVIEW" : "VALIDATED";

  useEffect(() => {
    setManualOpen(false);
    setCorrectionOpen(false);
  }, [props.job?.id]);

  useEffect(() => {
    if (props.job?.status === "failed" && needsTrackRecovery) {
      setCorrectionOpen(true);
    }
  }, [needsTrackRecovery, props.job?.id, props.job?.status]);

  function handleInsertMoment(afterStart: number) {
    setInsertAfterTime(afterStart);
    setManualOpen(true);
  }

  function handleManualAdd(variant: VariantCandidate) {
    props.onAddManualVariant(variant);
    setManualOpen(false);
  }

  return (
    <main className="studio-shell studio-analysis-page">
      <MediaPlayerBar
        ref={playerRef}
        jobId={props.job?.id}
        active={active}
        progress={progress}
        statusLabel={waveStatus}
        captureStatusLabel={captureStatus}
        focusVariant={variants[0]}
        onTimeUpdate={setCurrentTime}
        onDurationChange={setMediaDuration}
      />

      <section className="studio-analysis-content">
        <ProvenanceBanner passport={passport} health={props.health} />

        <div className="studio-analysis-context">
          <ContextCard icon={<Fingerprint size={17} />} label="Track Anchor" status="Musixmatch">
            <TrackAnchorTitle track={track} onVisitTrack={props.onVisitTrack} />
            <span>{track?.artist ?? "Catalog search"}{track?.album ? ` · ${track.album}` : ""}</span>
            {(passport || recovery) && <button type="button" className="studio-correction-toggle" onClick={() => setCorrectionOpen((open) => !open)}><Pencil size={13} /> {passport ? "Correct match" : "Choose track"}</button>}
          </ContextCard>
          <ContextCard icon={<CalendarDays size={17} />} label="Event Anchor" status={event ? "JamBase" : "Optional"}>
            {event?.url
              ? <a className="studio-context-link" href={event.url} target="_blank" rel="noreferrer"><strong>{event.venue}</strong></a>
              : <strong>{event?.venue ?? "No event selected"}</strong>}
            <span>{event ? `${event.city} · ${formatEventDate(event.date)}` : "Add city and date for event context"}</span>
          </ContextCard>
          <ContextCard icon={<Link2 size={17} />} label="Clip Evidence" status={formatSourceMode(passport?.clip.source.processingMode ?? recovery?.source.processingMode ?? props.health?.runtimeMode ?? "fixture")}>
            <strong>{formatSourceMode(passport?.clip.source.kind ?? recovery?.source.kind ?? "fixture")}</strong>
            <span>{Math.round(passport?.clip.durationSeconds ?? recovery?.durationSeconds ?? 24)}s analyzed · source preserved</span>
          </ContextCard>
          <ContextCard icon={<ShieldCheck size={17} />} label="Review Signal" status={riskCount ? `${riskCount} Risk` : "Clear"} tone={riskCount ? "risk" : "active"}>
            <strong>{riskCount ? "Focused review needed" : "No high-risk variants"}</strong>
            <span>{riskMessage(variants)}</span>
          </ContextCard>
        </div>

        {correctionOpen && (
          <CorrectionPanel track={track} recovery={needsTrackRecovery} onCorrectTrack={props.onCorrectTrack} onClose={() => setCorrectionOpen(false)} />
        )}

        <EvidenceChainPanel
          passport={passport}
          recovery={recovery}
          health={props.health}
          vocalQuality={passport?.clip.vocalQuality ?? recovery?.vocalQuality}
          asrEngine={passport?.clip.asrEngine ?? recovery?.asrEngine}
          asrUncertainCount={asrUncertainCount}
          variantCount={variants.length}
          timingOffsetSeconds={timingOffsetSeconds}
          averageTimingDeltaSeconds={averageTimingDeltaSeconds}
        />

        <MusixmatchIdentityChain passport={passport} track={track} />

        <section id="analysis-timeline" className="studio-rack-panel studio-analysis-rack">
          <header><span><Activity size={18} /> Analysis Timeline</span><small><i /> {active ? "Processing" : props.job?.status === "failed" ? "Failed" : "Complete"}</small></header>
          <div className="studio-rack-body">
            <div className="studio-timeline" aria-label="Analysis timeline">
              {steps.map((step) => <StudioStep key={step.id} step={step} />)}
            </div>
            <AnalysisLog steps={steps} active={active} />
          </div>
        </section>

        {(props.error || props.job?.error) && <p className="studio-error">{props.error || props.job?.error}</p>}
        {canRunScribeRecovery && (
          <section className="studio-scribe-recovery" aria-label="ElevenLabs Scribe recovery">
            <div>
              <strong>Whisper could not finish this transcript.</strong>
              <span>Try ElevenLabs Scribe on the saved clip without importing it again.</span>
            </div>
            <button className="studio-secondary-button" type="button" disabled={active} onClick={() => void props.onRetranscribe()}>
              <Sparkles size={16} /> Try ElevenLabs Scribe
            </button>
          </section>
        )}

        {transcript.length > 0 && (
          <section id="transcript-review" className="studio-rack-panel studio-transcript-panel" aria-label="Transcription Review">
            <header><span><AudioLines size={18} /> Transcription Review</span><small><i /> {transcript.length} segments</small></header>
            <div className="studio-rack-body">
              <div className="studio-transcript-toolbar">
                <span>{formatAsrEngine(passport?.clip.asrEngine ?? recovery?.asrEngine)} · {Math.round(average(transcript.map((segment) => segment.confidence)) * 100)}% avg</span>
                <button className="studio-secondary-button" type="button" disabled={active || (!passport && !recovery)} onClick={() => void props.onRetranscribe()} title="Runs ElevenLabs Scribe on the saved source media and refreshes the passport comparison">
                  <Sparkles size={16} /> ElevenLabs Scribe
                </button>
              </div>
              <div className="studio-transcript-list">{transcript.map((segment) => <button key={segment.id} type="button" className={activeTranscriptId === segment.id ? "active" : ""} onClick={() => playerRef.current?.seekTo(segment.start, true)} aria-current={activeTranscriptId === segment.id ? "true" : undefined}><span className="studio-mono">{formatTime(segment.start)}</span><strong>{segment.text}</strong><small>{Math.round(segment.confidence * 100)}%</small></button>)}</div>
            </div>
          </section>
        )}

        {comparisonRows.length > 0 && (
          <DiffView
            comparisons={comparisonRows}
            variants={variants}
            decisions={props.decisions}
            counts={comparisonCounts}
            confidence={overallConfidence}
            rightsStatus={passport?.rights.status}
            onLiveTextEdit={props.onEditLiveText}
            onDecision={props.onDecision}
            onInsertMoment={handleInsertMoment}
            onSeekToTime={(s) => playerRef.current?.seekTo(s, true)}
            onJoinWithNext={props.onJoinLines}
            onSplitLine={props.onSplitLine}
          />
        )}

        {manualOpen && (
          <ManualMomentPanel
            currentTime={currentTime}
            displayDuration={displayDuration}
            focusStart={insertAfterTime}
            onAdd={handleManualAdd}
            onClose={() => setManualOpen(false)}
          />
        )}

        <section className="studio-intelligence-grid" aria-label="Live and performance context">
          <article className="studio-panel studio-intelligence-card">
            <div className="studio-panel-heading"><span><ListMusic size={17} /> Live Context</span><span className="studio-mono">{liveContext?.source === "jambase" ? "JamBase" : "Demo Ready"}</span></div>
            <div className="studio-intelligence-body">
              <div className="studio-data-list">
                <DataLine label="Event" value={event ? `${event.venue}, ${event.city}` : "Event anchor pending"} />
                <DataLine label="Tour / festival" value={liveContext?.tourName ?? liveContext?.festivalName ?? "Not supplied"} />
                <DataLine label="Setlist position" value={formatSetlistPosition(liveContext?.setlist.position, liveContext?.setlist.songCount)} />
                <DataLine label="Lineup" value={liveContext?.lineup.join(", ") || event?.artist || "Not supplied"} />
              </div>
              <p>{liveContext?.summary ?? "JamBase event, venue, lineup, and setlist evidence will appear after anchoring."}</p>
            </div>
          </article>

          <article className="studio-panel studio-intelligence-card">
            <div className="studio-panel-heading"><span><AudioWaveform size={17} /> Performance Context</span><span className="studio-mono">{performanceContext?.source === "cyanite" ? "Cyanite" : "Demo Profile"}</span></div>
            <div className="studio-intelligence-body">
              <div className="studio-performance-readout">
                <div><span>Energy</span><strong>{energyLevel}%</strong></div>
                <div><span>Tempo</span><strong>{performanceContext?.bpm ? `${performanceContext.bpm} BPM` : "Pending"}</strong></div>
                <div><span>Arrangement</span><strong>{formatSourceMode(performanceContext?.arrangement ?? "high_intensity")}</strong></div>
              </div>
              <div className="studio-context-tags">
                {(performanceContext?.dominantEmotions ?? ["Energetic", "Uplifting", "Powerful"]).map((emotion, index) => <span key={`${emotion}-${index}`}>{formatSourceMode(emotion)}</span>)}
              </div>
              <p>{performanceContext?.summary ?? "Cyanite-derived energy, mood, BPM, and arrangement context will appear after profiling."}</p>
            </div>
          </article>
        </section>

        <section className="studio-metric-strip" aria-label="Passport metrics">
          <MetricCard icon={<Gauge size={16} />} label="Divergence Score" value={metricValue(divergence)} detail="Derived from alignment fit" tone="orange" />
          <MetricCard icon={<Clock3 size={16} />} label="Cadence Offset" value={ranWithoutResult ? "—" : formatCadenceDelta(averageTimingDeltaSeconds)} detail={`After ${formatSignedSeconds(timingOffsetSeconds)} clip offset`} tone={averageTimingDeltaSeconds >= 2.5 ? "orange" : "cyan"} />
          <MetricCard icon={<AudioWaveform size={16} />} label="Live Energy" value={metricValue(energyLevel)} detail={`${formatSourceMode(performanceContext?.arrangement ?? "high_intensity")}${performanceContext?.bpm ? ` · ${performanceContext.bpm} BPM` : ""}`} tone={energyLevel >= 78 ? "orange" : "cyan"} />
          <MetricCard icon={<BadgeCheck size={16} />} label="Passport Status" value={ranWithoutResult ? (props.job?.status === "failed" ? "Failed" : "Pending") : riskCount ? "Review" : "Valid"} detail={ranWithoutResult ? (props.job?.status === "failed" ? "No passport generated" : "Analysis running") : riskCount ? `${riskCount} risk candidate${riskCount === 1 ? "" : "s"}` : "Ready to export"} tone={(ranWithoutResult && props.job?.status === "failed") || riskCount ? "orange" : "cyan"} />
        </section>

        <section className="studio-lower-grid">
          <article className="studio-panel">
            <div className="studio-panel-heading"><span><BadgeCheck size={17} /> Passport Summary</span><span className={`studio-status-dot ${ranWithoutResult ? "" : "studio-status-dot-active"}`} /></div>
            <div className="p-4 md:p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <StudioMetric label="Overall" value={metricValue(overallConfidence)} />
                <StudioMetric label="ASR" value={metricValue(Math.round((passport?.confidenceOverview.asr ?? 0.88) * 100))} />
                <StudioMetric label="Alignment" value={metricValue(Math.round((passport?.confidenceOverview.alignment ?? 0.72) * 100))} />
              </div>
              <p className="mt-4 text-sm leading-6">{passport?.summary ?? (ranWithoutResult ? "No Live Variant Passport was generated for this run — resolve the error above and re-run." : "Run a session to replace the preview with derived Live Variant Passport data.")}</p>
              <div className="mt-4 flex flex-wrap gap-2">{(passport?.structureMap.live ?? (ranWithoutResult ? [] : ["Live opening", "City shoutout", "Hook repeat"])).map((item, index) => <span key={`${item}-${index}`} className="studio-chip">{item}</span>)}</div>
              {passport && <ExportPreview passport={passport} approvedCount={approvedCount} rejectedCount={rejectedCount} pendingCount={pendingCount} manualCount={props.manualVariants.length} editedCount={Object.keys(props.editedTexts).length} />}
              <button className="studio-secondary-button mt-4 w-full" type="button" onClick={() => void props.onNarrate()}><Sparkles size={16} /> Generate narration</button>
              <p className="studio-export-note">Top-bar export includes {approvedCount} approved, {rejectedCount} rejected, and {pendingCount} pending decisions.</p>
              {props.narration && <div className="studio-narration"><p className="studio-label">{props.narration.mode}</p><p className="mt-2 text-sm leading-6">{props.narration.text}</p>{props.narration.audioUrl && <audio className="mt-3 w-full" controls src={props.narration.audioUrl} />}</div>}
            </div>
          </article>

          <article className="studio-panel">
            <div className="studio-panel-heading"><span><Fingerprint size={17} /> Recording Intelligence</span><span className="studio-mono">{formatSourceMode(passport?.recordingIdentity.matchMethod ?? "demo_ready")}</span></div>
            <div className="p-4 md:p-5">
              <div className="studio-data-list">
                <DataLine label="Track ID" value={formatRecordingId(passport?.recordingIdentity.trackId ?? track?.id ?? "pending")} />
                <DataLine label="Common track" value={formatRecordingId(passport?.recordingIdentity.commonTrackId ?? "not supplied")} />
                <DataLine label="ISRC" value={passport?.recordingIdentity.isrc ?? "Not supplied"} />
                <DataLine label="Lyric source" value={formatSourceMode(passport?.recordingIdentity.canonicalSource ?? "fixture")} />
                <DataLine label="Attribution" value={passport?.rights.attribution ?? "Lyrics powered by Musixmatch"} />
                <DataLine label="Language" value={passport?.rights.language?.toUpperCase() ?? track?.language?.toUpperCase() ?? "EN"} />
                <DataLine label="Performance profile" value={performanceContext?.source === "cyanite" ? "Cyanite live analysis" : "Demo-safe fallback"} />
                <DataLine label="Vocal quality" value={formatVocalQuality(passport?.clip.vocalQuality ?? recovery?.vocalQuality)} />
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <ReadinessFlag label="Lyrics" active={track?.hasLyrics ?? true} />
                <ReadinessFlag label="Subtitles" active={track?.hasSubtitles ?? true} />
                <ReadinessFlag label="Word sync" active={track?.hasRichSync ?? true} />
                <ReadinessFlag label="Vocal" active={!track?.instrumental} />
              </div>
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}

// Guardrail against demoing fixtures as a real run: when the passport's identity,
// canonical lyrics, or transcript came from seeded fixtures, say so loudly. A real
// keyed run (real Musixmatch canonical + real ASR) gets a quiet positive confirmation
// instead, so the presenter always knows which one is on screen.
function ProvenanceBanner({ passport, health }: { passport?: AnalysisJob["passport"]; health: HealthResponse | null }) {
  if (!passport) return null;
  const seeded = passport.recordingIdentity.canonicalSource === "fixture"
    || passport.clip.asrSource === "fixture"
    || passport.recordingIdentity.matchMethod === "fixture_rescue";

  if (!seeded) {
    return (
      <div className="studio-provenance studio-provenance-live" role="status" aria-label="Run provenance">
        <ShieldCheck size={15} /><strong>Live partner run</strong>
        <span>Canonical lyrics, recording identity, and transcript came from configured partner APIs.</span>
      </div>
    );
  }

  const fixturePartners = (health?.integrations ?? []).filter((integration) => integration.mode === "fixture").map((integration) => integration.name);
  return (
    <div className="studio-provenance studio-provenance-demo" role="status" aria-label="Run provenance">
      <CircleAlert size={15} /><strong>Seeded demo data</strong>
      <span>This passport was generated from built-in fixtures{fixturePartners.length ? ` (${fixturePartners.join(", ")} not configured)` : ""}, not a live Musixmatch run. Upload a real clip with partner keys set for a true end-to-end demo.</span>
    </div>
  );
}

function ContextCard({ icon, label, status, tone = "active", children }: { icon: React.ReactNode; label: string; status: string; tone?: "active" | "risk"; children: React.ReactNode }) {
  return <article className={`studio-context-card ${tone === "risk" ? "risk" : ""}`}><header><span>{icon}{label}</span><small><i />{status}</small></header><div>{children}</div></article>;
}

function TrackAnchorTitle({ track, onVisitTrack }: { track?: TrackCandidate; onVisitTrack: (track: TrackCandidate) => Promise<void> | void }) {
  if (!track) return <strong>Track match pending</strong>;
  const url = musixmatchTrackUrl(track);
  return url
    ? <a className="studio-context-link" href={url} target="_blank" rel="noreferrer" title="Open Musixmatch track"><strong>{track.title}</strong></a>
    : <><strong>{track.title}</strong>{track.source === "musixmatch" && <button type="button" className="studio-correction-toggle" onClick={() => void onVisitTrack(track)}>Visit matched track</button>}</>;
}

function musixmatchTrackUrl(track: TrackCandidate): string | undefined {
  if (!track.url || !/^https?:\/\//i.test(track.url)) return undefined;
  return track.url;
}

function EvidenceChainPanel({
  passport,
  recovery,
  health,
  vocalQuality,
  asrEngine,
  asrUncertainCount,
  variantCount,
  timingOffsetSeconds,
  averageTimingDeltaSeconds
}: {
  passport?: AnalysisJob["passport"];
  recovery?: AnalysisJob["recovery"];
  health: HealthResponse | null;
  vocalQuality?: VocalQualityReport;
  asrEngine?: string;
  asrUncertainCount: number;
  variantCount: number;
  timingOffsetSeconds: number;
  averageTimingDeltaSeconds: number;
}) {
  const source = passport?.clip.source ?? recovery?.source;
  const asrSource = passport?.clip.asrSource ?? recovery?.asrSource ?? "fixture";
  const canonicalSource = passport?.recordingIdentity.canonicalSource ?? "fixture";
  const rightsStatus = passport?.rights.status ?? (health?.runtimeMode === "live" ? "pending" : "fixture");
  const sourceDetail = source?.processingMode === "provider_excerpt"
    ? "Provider excerpt analyzed and deleted"
    : source?.processingMode === "authorized_excerpt"
      ? "User-authorized excerpt"
      : "Uploaded or recalled source";

  return (
    <section className="studio-evidence-chain" aria-label="Evidence chain">
      <EvidenceStep label="Source" value={formatSourceMode(source?.processingMode ?? health?.runtimeMode ?? "fixture")} detail={sourceDetail} />
      <EvidenceStep label="Vocal" value={formatVocalSource(vocalQuality)} detail={vocalQuality?.detail ?? "Stem quality gate pending"} tone={vocalQuality && vocalQuality.status !== "passed" ? "risk" : "active"} />
      <EvidenceStep label="ASR" value={`${formatSourceMode(asrSource)} · ${Math.round((passport?.confidenceOverview.asr ?? 0) * 100)}%`} detail={`${formatAsrEngine(asrEngine)} · ${asrUncertainCount ? `${asrUncertainCount} uncertain segment${asrUncertainCount === 1 ? "" : "s"}` : "No low-confidence segments"}`} tone={asrUncertainCount ? "risk" : "active"} />
      <EvidenceStep label="Canonical" value={formatSourceMode(canonicalSource)} detail={passport?.track.title ?? "Track anchor pending"} />
      <EvidenceStep label="Timing" value={formatCadenceDelta(averageTimingDeltaSeconds)} detail={`Clip offset ${formatSignedSeconds(timingOffsetSeconds)}`} tone={averageTimingDeltaSeconds >= 2.5 ? "risk" : "active"} />
      <EvidenceStep label="Export" value={`${variantCount} candidate${variantCount === 1 ? "" : "s"}`} detail={formatSourceMode(rightsStatus)} tone={rightsStatus === "restricted" || rightsStatus === "metadata_only" ? "risk" : "active"} />
    </section>
  );
}

function EvidenceStep({ label, value, detail, tone = "active" }: { label: string; value: string; detail: string; tone?: "active" | "risk" }) {
  return <article className={`studio-evidence-step ${tone === "risk" ? "risk" : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

// The Musixmatch identity lineage is the contest's headline integration axis, so it
// gets its own chain: track.search -> track_id -> commontrack_id -> ISRC -> the
// richsync/subtitle/lyrics tier the canonical reference came from -> rights status.
function MusixmatchIdentityChain({ passport, track }: { passport?: AnalysisJob["passport"]; track?: TrackCandidate }) {
  const identity = passport?.recordingIdentity;
  const versionConfidence = identity?.versionConfidence;
  const canonicalSource = identity?.canonicalSource ?? "fixture";
  const rightsStatus = passport?.rights.status ?? "fixture";
  const isrc = identity?.isrc;
  return (
    <section className="studio-mxm-identity" aria-label="Musixmatch identity chain">
      <header>
        <span><Fingerprint size={16} /> Musixmatch Identity Chain</span>
        <small className="studio-mono">{formatSourceMode(identity?.matchMethod ?? "demo_ready")}{typeof versionConfidence === "number" ? ` · ${Math.round(versionConfidence * 100)}% version confidence` : ""}</small>
      </header>
      <div className="studio-mxm-chain">
        <EvidenceStep label="Track ID" value={formatRecordingId(identity?.trackId ?? track?.id ?? "pending")} detail="track.search → track_id" />
        <EvidenceStep label="Common Track" value={formatRecordingId(identity?.commonTrackId ?? "not supplied")} detail="commontrack_id" />
        <EvidenceStep label="ISRC" value={isrc ?? "Not supplied"} detail="recording identity" tone={isrc ? "active" : "risk"} />
        <EvidenceStep label="Lyric Source" value={formatSourceMode(canonicalSource)} detail="richsync · subtitle · lyrics" />
        <EvidenceStep label="Rights" value={formatSourceMode(rightsStatus)} detail={passport?.rights.attribution ?? "Lyrics powered by Musixmatch"} tone={rightsStatus === "restricted" || rightsStatus === "metadata_only" ? "risk" : "active"} />
      </div>
    </section>
  );
}

function ExportPreview({ passport, approvedCount, rejectedCount, pendingCount, manualCount, editedCount }: { passport: NonNullable<AnalysisJob["passport"]>; approvedCount: number; rejectedCount: number; pendingCount: number; manualCount: number; editedCount: number }) {
  const firstVariant = passport.variants[0];
  return (
    <div className="studio-export-preview" aria-label="Export preview">
      <div><span>Passport</span><strong>{passport.id} · v{passport.version}</strong></div>
      <div><span>Decision state</span><strong>{approvedCount} approved · {rejectedCount} rejected · {pendingCount} pending</strong></div>
      <div><span>Manual review</span><strong>{manualCount} added · {editedCount} edited line{editedCount === 1 ? "" : "s"}</strong></div>
      <div><span>Evidence</span><strong>ASR {Math.round(passport.confidenceOverview.asr * 100)}% · {formatAsrEngine(passport.clip.asrEngine)}</strong></div>
      <div><span>Vocal gate</span><strong>{formatVocalQuality(passport.clip.vocalQuality)}</strong></div>
      <div><span>Lead candidate</span><strong>{firstVariant ? `${formatSourceMode(firstVariant.type)} · ${formatSourceMode(firstVariant.evidenceTier ?? "needs_review")}` : "No candidate"}</strong></div>
    </div>
  );
}

function MetricCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: "cyan" | "orange" }) {
  return <article className={`studio-analysis-metric ${tone ? `tone-${tone}` : ""}`}><p>{icon}{label}</p><strong>{value}</strong><small>{detail}</small><span><i /></span></article>;
}

function AnalysisLog({ steps, active }: { steps: AnalysisStep[]; active: boolean }) {
  const current = steps.find((step) => step.status === "running") ?? steps.at(-1);
  return <div className="studio-analysis-log" aria-label="Analysis processing log"><p><span>[SYS]</span> Source evidence validated and secured in memory.</p><p><span>[PIPE]</span> {current?.label ?? "Passport assembly"} {active ? "is active" : "complete"}.</p><p><span>[MXM]</span> Canonical reference aligned without persisting lyric content.<i /></p></div>;
}

function StudioStep({ step }: { step: AnalysisStep }) {
  const label = step.status === "complete" ? "Done"
    : step.status === "failed" ? "Failed"
      : step.status === "running" ? "Running"
        : "Queued";
  return <div className={`studio-step ${step.status === "running" ? "studio-step-active" : ""} ${step.status === "failed" ? "studio-step-failed" : ""}`}><div className="flex items-center justify-between gap-2">{step.status === "complete" ? <CheckCircle2 size={17} className="studio-cyan" /> : step.status === "failed" ? <CircleAlert size={17} className="studio-orange" /> : step.status === "running" ? <Activity size={17} className="studio-cyan animate-pulse" /> : <span className="studio-step-dot" />}<span className="studio-mono">{label}</span></div><p className="mt-3 text-sm font-bold leading-5">{step.label}</p><div className="studio-step-progress"><span style={{ width: step.status === "complete" ? "100%" : step.status === "running" ? "64%" : "0%" }} /></div></div>;
}

function DataLine({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function StudioMetric({ label, value }: { label: string; value: string }) { return <div className="studio-metric"><span>{label}</span><strong>{value}</strong></div>; }
function ReadinessFlag({ label, active }: { label: string; active: boolean }) { return <span className={`studio-readiness ${active ? "studio-readiness-active" : ""}`}>{active ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}{label}</span>; }

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatCadenceDelta(seconds: number) {
  if (seconds >= 1) return `${(Math.round(seconds * 10) / 10).toFixed(1)}s`;
  return `${Math.round(seconds * 1000)}ms`;
}

function formatVocalSource(report?: VocalQualityReport) {
  if (!report) return "Pending";
  const source = report.selectedSource === "lalalai" ? "LALAL.AI" : report.selectedSource === "demucs" ? "Demucs" : report.selectedSource === "original" ? "Original audio" : "Fixture";
  return report.fallbackUsed ? "Original fallback" : source;
}

function formatVocalQuality(report?: VocalQualityReport) {
  if (!report) return "Pending";
  const score = `${Math.round(report.score * 100)}%`;
  if (report.fallbackUsed) return `Fallback used · ${score}`;
  return `${formatSourceMode(report.status)} · ${score}`;
}

function formatAsrEngine(engine?: string) {
  if (!engine) return "Engine pending";
  if (engine.startsWith("elevenlabs/")) return "ElevenLabs Scribe";
  if (engine.startsWith("openai/whisper")) return "OpenAI Whisper";
  if (engine.startsWith("vaibhavs10/incredibly-fast-whisper:")) return "Fast Whisper";
  return engine.split(":")[0] ?? engine;
}

const defaultSteps: AnalysisStep[] = [
  { id: "ingest", label: "Validate source", status: "complete" },
  { id: "isolate", label: "Isolate live vocal", status: "complete" },
  { id: "profile", label: "Profile live arrangement", status: "complete" },
  { id: "transcribe", label: "Transcribe vocal", status: "running" },
  { id: "anchor", label: "Match recording", status: "queued" },
  { id: "compare", label: "Compare timing", status: "queued" },
  { id: "passport", label: "Generate Passport", status: "queued" }
];

const previewVariants: VariantCandidate[] = [
  { id: "P1", type: "city_shoutout", start: 4.2, end: 8.5, liveText: "Cape Town carry this chorus through the avenue", canonicalAlignmentReference: "L2 (76% token overlap)", canonicalExcerpt: "Carry this chorus through the avenue", confidence: 0.84, impactNote: "Event-specific wording is likely intentional.", recommendedAction: "Attach event metadata; no canonical lyric edit required.", translationRisk: "medium", severity: "medium", evidenceSource: "asr_alignment" },
  { id: "P2", type: "repeated_hook", start: 12.8, end: 17.4, liveText: "Sing it once more, sing it once more until the morning arrives", canonicalAlignmentReference: "L4 (81% token overlap)", canonicalExcerpt: "Sing it once more until the morning arrives", confidence: 0.78, impactNote: "The hook appears twice in the live structure.", recommendedAction: "Extend live subtitle timing while preserving the canonical lyric.", translationRisk: "low", severity: "medium", evidenceSource: "asr_alignment" },
  { id: "P3", type: "skipped_line", start: 16, end: 20, liveText: "[not detected in live vocal]", canonicalAlignmentReference: "L5 (canonical line absent)", canonicalExcerpt: "Late section reference excerpt", confidence: 0.58, impactNote: "Low confidence omission candidate.", recommendedAction: "Confirm the omission and review live-caption coverage.", translationRisk: "high", severity: "high", evidenceSource: "asr_alignment" }
];
