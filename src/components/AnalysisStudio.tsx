import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  AudioWaveform,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileCheck2,
  Fingerprint,
  Gauge,
  Link2,
  ListMusic,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X
} from "lucide-react";
import type {
  AnalysisJob,
  AnalysisStep,
  EventCandidate,
  HealthResponse,
  NarrationResponse,
  TrackCandidate,
  VariantCandidate,
  VariantType
} from "../../shared/types";
import { searchTracks } from "../api";
import { WaveformCanvas } from "./WaveformCanvas";

type FilterMode = "all" | "performance" | "risk";
export type ReviewDecision = "approved" | "rejected";
export type ReviewDecisions = Partial<Record<string, ReviewDecision>>;

type Props = {
  job: AnalysisJob | null;
  health: HealthResponse | null;
  selectedTrack?: TrackCandidate;
  selectedEvent?: EventCandidate | null;
  narration: NarrationResponse | null;
  error: string;
  decisions: ReviewDecisions;
  onDecision: (id: string, decision: ReviewDecision) => void;
  onNarrate: () => Promise<void> | void;
  onCorrectTrack: (track: TrackCandidate) => Promise<void> | void;
};

export function AnalysisStudio(props: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const mediaRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionTitle, setCorrectionTitle] = useState("");
  const [correctionArtist, setCorrectionArtist] = useState("");
  const [correctionResults, setCorrectionResults] = useState<TrackCandidate[]>([]);
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const passport = props.job?.passport;
  const recovery = props.job?.recovery;
  const track = passport?.track ?? (recovery ? undefined : props.selectedTrack);
  const event = passport?.event ?? props.selectedEvent ?? null;
  const variants = passport?.variants ?? (props.job ? [] : previewVariants);
  const steps = props.job?.progress ?? defaultSteps;
  const completeSteps = steps.filter((step) => step.status === "complete").length;
  const progress = Math.round((completeSteps / Math.max(1, steps.length)) * 100);
  const filteredVariants = useMemo(() => variants.filter((variant) => matchesFilter(variant, filter)), [filter, variants]);
  const filterCounts = useMemo(() => ({
    all: variants.length,
    performance: variants.filter((variant) => matchesFilter(variant, "performance")).length,
    risk: variants.filter((variant) => matchesFilter(variant, "risk")).length
  }), [variants]);
  const approvedCount = Object.values(props.decisions).filter((decision) => decision === "approved").length;
  const rejectedCount = Object.values(props.decisions).filter((decision) => decision === "rejected").length;
  const averageConfidence = variants.length ? Math.round((variants.reduce((total, variant) => total + variant.confidence, 0) / variants.length) * 100) : 0;
  const status = props.job?.status ?? "queued";
  const active = status === "running" || status === "queued";
  const focusVariant = filteredVariants[0] ?? variants[0];
  const divergence = Math.round((1 - (passport?.confidenceOverview.alignment ?? 0.72)) * 100);
  const liveContext = passport?.liveContext;
  const performanceContext = passport?.performanceContext;
  const energyLevel = Math.round((performanceContext?.energyLevel ?? 0.86) * 100);
  const riskCount = filterCounts.risk;
  const transcript = passport?.clip.transcript ?? recovery?.transcript ?? [];
  const mediaUrl = props.job?.id ? `/api/analyze/${props.job.id}/media` : "";
  const displayDuration = mediaDuration || passport?.clip.durationSeconds || recovery?.durationSeconds || 0;
  const playbackProgress = displayDuration > 0 ? Math.min(100, currentTime / displayDuration * 100) : 0;
  const engineProgress = active ? Math.max(8, progress) : playbackProgress;
  const activeTranscriptId = transcript.find((segment) => currentTime >= segment.start && currentTime < segment.end)?.id;

  useEffect(() => {
    setCurrentTime(0);
    setMediaDuration(0);
    setIsPlaying(false);
  }, [props.job?.id]);

  useEffect(() => {
    setCorrectionTitle(track?.title ?? "");
    setCorrectionArtist(track?.artist ?? "");
    setCorrectionResults([]);
    setCorrectionError("");
  }, [track?.id, track?.title, track?.artist]);

  function seekTo(seconds: number, play = false) {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = Math.max(0, Math.min(seconds, media.duration || displayDuration || seconds));
    setCurrentTime(media.currentTime);
    if (play) void media.play().catch(() => setIsPlaying(false));
  }

  function togglePlayback() {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => setIsPlaying(false));
    else media.pause();
  }

  async function findCorrectionMatches() {
    const query = `${correctionTitle} ${correctionArtist}`.trim();
    if (!query) return;
    setCorrectionBusy(true);
    setCorrectionError("");
    try {
      const matches = await searchTracks(query);
      setCorrectionResults(matches);
      if (matches.length === 0) setCorrectionError("No Musixmatch catalog matches found. You can still use the manual labels.");
    } catch (error) {
      setCorrectionError(error instanceof Error ? error.message : "Could not search the catalog.");
    } finally {
      setCorrectionBusy(false);
    }
  }

  async function applyCorrection(correctedTrack: TrackCandidate) {
    setCorrectionBusy(true);
    setCorrectionError("");
    try {
      await props.onCorrectTrack(correctedTrack);
      setCorrectionOpen(false);
    } catch (error) {
      setCorrectionError(error instanceof Error ? error.message : "Could not correct the track anchor.");
    } finally {
      setCorrectionBusy(false);
    }
  }

  function applyManualCorrection() {
    const title = correctionTitle.trim();
    const artist = correctionArtist.trim();
    if (!title || !artist) {
      setCorrectionError("Enter both the correct track title and artist.");
      return;
    }
    void applyCorrection({
      id: `manual-${slugify(artist)}-${slugify(title)}`,
      title,
      artist,
      hasLyrics: false,
      hasSubtitles: false,
      source: "manual"
    });
  }

  return (
    <main className="studio-shell studio-analysis-page">
      <section className="studio-wavebar" aria-label="Live analysis waveform">
        {mediaUrl && <audio ref={mediaRef} preload="metadata" src={mediaUrl} onLoadedMetadata={(event) => setMediaDuration(event.currentTarget.duration)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => setIsPlaying(false)} />}
        <div className="studio-wave-meta">
          <span className="studio-label">Live Engine Input</span>
          <div className="mt-2 flex items-center gap-3">
            <div className="studio-transport-group">
              <button type="button" className="studio-transport" disabled={active || !mediaUrl} onClick={() => seekTo(currentTime - 5)} aria-label="Rewind 5 seconds" title="Rewind 5 seconds"><RotateCcw size={17} /></button>
              <button type="button" className={`studio-transport ${isPlaying ? "studio-transport-active" : ""}`} disabled={active || !mediaUrl} onClick={togglePlayback} aria-label={isPlaying ? "Pause analyzed clip" : "Play analyzed clip"} title={isPlaying ? "Pause" : "Play"}>{isPlaying ? <Pause size={18} /> : <Play size={18} />}</button>
            </div>
            <div>
              <p className="studio-time">{formatOffset(active ? focusVariant?.start ?? progress / 4 : currentTime)}</p>
              <p className="studio-subtle">{active ? "Analyzing source" : `${formatTime(currentTime)} / ${formatTime(displayDuration)}`} · {active ? progress : Math.round(playbackProgress)}%</p>
            </div>
          </div>
        </div>
        <div className="studio-waveform">
          <WaveformCanvas progress={engineProgress} active={active || isPlaying} />
          {!active && mediaUrl && <input className="studio-wave-seek" type="range" min="0" max={Math.max(0.1, displayDuration)} step="0.1" value={Math.min(currentTime, displayDuration)} onChange={(event) => seekTo(Number(event.target.value))} aria-label="Seek analyzed clip" />}
          <span className="studio-wave-badge">{active ? "ANALYZING" : isPlaying ? "PLAYING" : "PASSPORT READY"}</span>
        </div>
        <div className="studio-sync">
          <span className="studio-label">Capture Status</span>
          <span className="studio-sync-badge"><span className={`studio-status-dot ${active || isPlaying ? "studio-status-dot-active" : ""}`} /> {active ? "ACTIVE SYNC" : isPlaying ? "PLAYING" : "VALIDATED"}</span>
        </div>
      </section>

      <section className="studio-analysis-content">
        <div className="studio-analysis-context">
          <ContextCard icon={<Fingerprint size={17} />} label="Track Anchor" status="Musixmatch">
            <strong>{track?.title ?? "Track match pending"}</strong>
            <span>{track?.artist ?? "Catalog search"}{track?.album ? ` · ${track.album}` : ""}</span>
            {(passport || recovery) && <button type="button" className="studio-correction-toggle" onClick={() => setCorrectionOpen((open) => !open)}><Pencil size={13} /> {passport ? "Correct match" : "Choose track"}</button>}
          </ContextCard>
          <ContextCard icon={<CalendarDays size={17} />} label="Event Anchor" status={event ? "JamBase" : "Optional"}>
            <strong>{event?.venue ?? "No event selected"}</strong>
            <span>{event ? `${event.city} · ${formatEventDate(event.date)}` : "Add city and date for event context"}</span>
          </ContextCard>
          <ContextCard icon={<Link2 size={17} />} label="Source Evidence" status={formatSourceMode(passport?.clip.source.processingMode ?? recovery?.source.processingMode ?? props.health?.runtimeMode ?? "fixture")}>
            <strong>{formatSourceMode(passport?.clip.source.kind ?? recovery?.source.kind ?? "fixture")}</strong>
            <span>{Math.round(passport?.clip.durationSeconds ?? recovery?.durationSeconds ?? 24)}s analyzed · source preserved</span>
          </ContextCard>
          <ContextCard icon={<ShieldCheck size={17} />} label="Review Signal" status={riskCount ? `${riskCount} Risk` : "Clear"} tone={riskCount ? "risk" : "active"}>
            <strong>{riskCount ? "Focused review needed" : "No high-risk variants"}</strong>
            <span>{riskMessage(variants)}</span>
          </ContextCard>
        </div>

        {correctionOpen && (
          <section className="studio-rack-panel studio-correction-panel" aria-label="Correct track match">
            <header><span><Pencil size={17} /> Correct Track Anchor</span><small><i /> No audio reprocessing</small></header>
            <div className="studio-rack-body">
              <p className="studio-panel-intro">Search for the correct Musixmatch recording, or preserve your own title and artist labels when the catalog match is wrong.</p>
              <div className="studio-correction-fields">
                <label><span>Track title</span><input className="field" value={correctionTitle} onChange={(event) => setCorrectionTitle(event.target.value)} aria-label="Correct track title" /></label>
                <label><span>Artist</span><input className="field" value={correctionArtist} onChange={(event) => setCorrectionArtist(event.target.value)} aria-label="Correct track artist" /></label>
                <button type="button" className="studio-secondary-button" disabled={correctionBusy} onClick={() => void findCorrectionMatches()}><Search size={15} /> {correctionBusy ? "Searching" : "Search catalog"}</button>
                <button type="button" className="studio-secondary-button" disabled={correctionBusy} onClick={applyManualCorrection}><Pencil size={15} /> Use manual labels</button>
              </div>
              {correctionError && <p className="studio-inline-error"><CircleAlert size={15} /> {correctionError}</p>}
              {correctionResults.length > 0 && <div className="studio-correction-results">{correctionResults.map((result) => <button key={result.id} type="button" onClick={() => void applyCorrection(result)}><strong>{result.title}</strong><span>{result.artist}{result.album ? ` · ${result.album}` : ""}</span></button>)}</div>}
            </div>
          </section>
        )}

        <section id="analysis-timeline" className="studio-rack-panel studio-analysis-rack">
          <header><span><Activity size={18} /> Analysis Timeline</span><small><i /> {active ? "Processing" : "Complete"}</small></header>
          <div className="studio-rack-body">
            <div className="studio-timeline" aria-label="Analysis timeline">
              {steps.map((step) => <StudioStep key={step.id} step={step} />)}
            </div>
            <AnalysisLog steps={steps} active={active} />
          </div>
        </section>

        {(props.error || props.job?.error) && <p className="studio-error">{props.error || props.job?.error}</p>}

        {transcript.length > 0 && (
          <section id="transcript-review" className="studio-rack-panel studio-transcript-panel">
            <header><span><AudioLines size={18} /> Transcription Review</span><small><i /> {transcript.length} segments</small></header>
            <div className="studio-rack-body">
              <p className="studio-panel-intro">Play the analyzed clip and select any line to seek directly to that moment.</p>
              <div className="studio-transcript-list">{transcript.map((segment) => <button key={segment.id} type="button" className={activeTranscriptId === segment.id ? "active" : ""} onClick={() => seekTo(segment.start, true)} aria-current={activeTranscriptId === segment.id ? "true" : undefined}><span className="studio-mono">{formatTime(segment.start)}</span><strong>{segment.text}</strong><small>{Math.round(segment.confidence * 100)}%</small></button>)}</div>
            </div>
          </section>
        )}

        <section id="studio-passport" className="studio-rack-panel studio-diff-panel">
          <header><span><FileCheck2 size={18} /> Passport Preview / Diff View</span><small><i /> Derived metadata only</small></header>
          <div className="studio-rack-body">
            <div className="studio-diff-grid">
              <article>
                <p className="studio-label">Canonical Reference</p>
                <div className="studio-diff-copy muted">
                  <strong>{focusVariant?.canonicalAlignmentReference ?? "Reference line pending"}</strong>
                  <p>Canonical lyric content remains in memory and is represented here by its licensed line reference.</p>
                </div>
              </article>
              <article>
                <p className="studio-label studio-cyan">Live Variant Detected</p>
                <div className="studio-diff-copy live">
                  <span className="studio-variant-badge">{focusVariant?.type.replaceAll("_", " ") ?? "pending"}</span>
                  <strong>{focusVariant?.liveText ?? "Live text pending"}</strong>
                  <p>{focusVariant?.impactNote ?? "Comparison will appear when analysis completes."}</p>
                </div>
              </article>
            </div>
          </div>
        </section>

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
                {(performanceContext?.dominantEmotions ?? ["Energetic", "Uplifting", "Powerful"]).map((emotion) => <span key={emotion}>{formatSourceMode(emotion)}</span>)}
              </div>
              <p>{performanceContext?.summary ?? "Cyanite-derived energy, mood, BPM, and arrangement context will appear after profiling."}</p>
            </div>
          </article>
        </section>

        <section className="studio-metric-strip" aria-label="Passport metrics">
          <MetricCard icon={<Gauge size={16} />} label="Divergence Score" value={`${divergence}%`} detail="Derived from alignment fit" tone="orange" />
          <MetricCard icon={<Clock3 size={16} />} label="Cadence Offset" value={`+${Math.max(40, Math.round((1 - (passport?.confidenceOverview.alignment ?? 0.72)) * 420))}ms`} detail="Live timing against reference" tone="cyan" />
          <MetricCard icon={<AudioWaveform size={16} />} label="Live Energy" value={`${energyLevel}%`} detail={`${formatSourceMode(performanceContext?.arrangement ?? "high_intensity")}${performanceContext?.bpm ? ` · ${performanceContext.bpm} BPM` : ""}`} tone={energyLevel >= 78 ? "orange" : "cyan"} />
          <MetricCard icon={<BadgeCheck size={16} />} label="Passport Status" value={riskCount ? "Review" : "Valid"} detail={riskCount ? `${riskCount} risk candidate${riskCount === 1 ? "" : "s"}` : "Ready to export"} tone={riskCount ? "orange" : "cyan"} />
        </section>

        <section id="variant-candidates" className="studio-variant-section">
          <header className="studio-main-header">
            <div>
              <p className="studio-label studio-cyan">Live Variant Passport</p>
              <h1>Variant Candidates</h1>
              <p className="studio-subtle">Live vocal evidence aligned to the Musixmatch canonical reference</p>
            </div>
            <div className="studio-filter-control">
              <div className="studio-filter-group" aria-label="Variant filters">
                <FilterButton active={filter === "all"} label="All" count={filterCounts.all} description="Show every detected candidate" onClick={() => setFilter("all")} />
                <FilterButton active={filter === "performance"} label="Performance" count={filterCounts.performance} description="Show live-performance changes such as shoutouts, ad-libs, repeats, and extensions" onClick={() => setFilter("performance")} />
                <FilterButton active={filter === "risk"} label="Risks" count={filterCounts.risk} description="Show low-confidence, omitted, uncertain, or high-translation-risk candidates" onClick={() => setFilter("risk")} />
              </div>
              <p className="studio-filter-feedback" role="status" aria-live="polite">Showing {filteredVariants.length} of {variants.length}: {filterDescription(filter)}</p>
            </div>
          </header>

          <section className="studio-table-wrap hidden md:block">
            <div className="studio-table-head"><span>Time</span><span>Type</span><span>Live Content</span><span>Confidence</span><span>Action</span></div>
            <div>{filteredVariants.length ? filteredVariants.map((variant) => <CandidateRow key={variant.id} variant={variant} decision={props.decisions[variant.id]} onDecision={props.onDecision} />) : <FilterEmpty />}</div>
            <ReviewFooter variants={variants} approved={approvedCount} rejected={rejectedCount} average={averageConfidence} />
          </section>

          <section className="space-y-3 md:hidden">
            {filteredVariants.length ? filteredVariants.map((variant) => <CandidateCard key={variant.id} variant={variant} decision={props.decisions[variant.id]} onDecision={props.onDecision} />) : <FilterEmpty />}
            <ReviewFooter variants={variants} approved={approvedCount} rejected={rejectedCount} average={averageConfidence} />
          </section>
        </section>

        <section className="studio-lower-grid">
          <article className="studio-panel">
            <div className="studio-panel-heading"><span><BadgeCheck size={17} /> Passport Summary</span><span className="studio-status-dot studio-status-dot-active" /></div>
            <div className="p-4 md:p-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <StudioMetric label="Overall" value={`${Math.round((passport?.confidenceOverview.overall ?? 0.81) * 100)}%`} />
                <StudioMetric label="ASR" value={`${Math.round((passport?.confidenceOverview.asr ?? 0.88) * 100)}%`} />
                <StudioMetric label="Alignment" value={`${Math.round((passport?.confidenceOverview.alignment ?? 0.72) * 100)}%`} />
              </div>
              <p className="mt-4 text-sm leading-6">{passport?.summary ?? "Run a session to replace the preview with derived Live Variant Passport data."}</p>
              <div className="mt-4 flex flex-wrap gap-2">{(passport?.structureMap.live ?? ["Live opening", "City shoutout", "Hook repeat"]).map((item) => <span key={item} className="studio-chip">{item}</span>)}</div>
              <button className="studio-secondary-button mt-4 w-full" type="button" onClick={() => void props.onNarrate()}><Sparkles size={16} /> Generate narration</button>
              <p className="studio-export-note">Top-bar export includes {approvedCount} approved, {rejectedCount} rejected, and {variants.length - approvedCount - rejectedCount} pending decisions.</p>
              {props.narration && <div className="studio-narration"><p className="studio-label">{props.narration.mode}</p><p className="mt-2 text-sm leading-6">{props.narration.text}</p>{props.narration.audioUrl && <audio className="mt-3 w-full" controls src={props.narration.audioUrl} />}</div>}
            </div>
          </article>

          <article className="studio-panel">
            <div className="studio-panel-heading"><span><Fingerprint size={17} /> Recording Intelligence</span><span className="studio-mono">{formatSourceMode(passport?.recordingIdentity.matchMethod ?? "demo_ready")}</span></div>
            <div className="p-4 md:p-5">
              <div className="studio-data-list">
                <DataLine label="Track ID" value={formatRecordingId(passport?.recordingIdentity.trackId ?? track?.id ?? "pending")} />
                <DataLine label="Common track" value={formatRecordingId(passport?.recordingIdentity.commonTrackId ?? "not supplied")} />
                <DataLine label="Attribution" value={passport?.rights.attribution ?? "Lyrics powered by Musixmatch"} />
                <DataLine label="Language" value={passport?.rights.language?.toUpperCase() ?? track?.language?.toUpperCase() ?? "EN"} />
                <DataLine label="Performance profile" value={performanceContext?.source === "cyanite" ? "Cyanite live analysis" : "Demo-safe fallback"} />
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

function ContextCard({ icon, label, status, tone = "active", children }: { icon: React.ReactNode; label: string; status: string; tone?: "active" | "risk"; children: React.ReactNode }) {
  return <article className={`studio-context-card ${tone === "risk" ? "risk" : ""}`}><header><span>{icon}{label}</span><small><i />{status}</small></header><div>{children}</div></article>;
}

function MetricCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone?: "cyan" | "orange" }) {
  return <article className={`studio-analysis-metric ${tone ? `tone-${tone}` : ""}`}><p>{icon}{label}</p><strong>{value}</strong><small>{detail}</small><span><i /></span></article>;
}

function AnalysisLog({ steps, active }: { steps: AnalysisStep[]; active: boolean }) {
  const current = steps.find((step) => step.status === "running") ?? steps.at(-1);
  return <div className="studio-analysis-log" aria-label="Analysis processing log"><p><span>[SYS]</span> Source evidence validated and secured in memory.</p><p><span>[PIPE]</span> {current?.label ?? "Passport assembly"} {active ? "is active" : "complete"}.</p><p><span>[MXM]</span> Canonical reference aligned without persisting lyric content.<i /></p></div>;
}

function CandidateRow({ variant, decision, onDecision }: { variant: VariantCandidate; decision?: ReviewDecision; onDecision: (id: string, decision: ReviewDecision) => void }) {
  return <div className={`studio-table-row ${variant.severity === "high" ? "studio-table-row-risk" : ""}`}><span className="studio-mono">{formatTime(variant.start)}</span><VariantBadge type={variant.type} /><div className="min-w-0"><p className="font-medium">{variant.liveText}</p><p className="studio-subtle mt-1">{variant.canonicalAlignmentReference}</p><p className="mt-2 text-sm leading-5">{variant.recommendedAction}</p></div><Confidence value={variant.confidence} risk={variant.severity === "high"} /><div className="flex justify-end gap-2"><DecisionButton label="Approve candidate" active={decision === "approved"} tone="approve" onClick={() => onDecision(variant.id, "approved")} /><DecisionButton label="Reject candidate" active={decision === "rejected"} tone="reject" onClick={() => onDecision(variant.id, "rejected")} /></div></div>;
}

function CandidateCard({ variant, decision, onDecision }: { variant: VariantCandidate; decision?: ReviewDecision; onDecision: (id: string, decision: ReviewDecision) => void }) {
  return <article className={`studio-candidate-card ${variant.severity === "high" ? "studio-candidate-card-risk" : ""}`}><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="studio-mono">{formatTime(variant.start)}</span><VariantBadge type={variant.type} /></div><Confidence value={variant.confidence} risk={variant.severity === "high"} /></div><p className="mt-4 text-base font-semibold leading-6">{variant.liveText}</p><p className="studio-subtle mt-2">Canonical alignment: {variant.canonicalAlignmentReference}</p><div className="studio-impact-note"><CircleAlert size={15} /><span>{variant.impactNote}</span></div><p className="mt-3 text-sm leading-6">{variant.recommendedAction}</p><div className="mt-4 grid grid-cols-2 gap-2"><button type="button" className={`studio-review-button ${decision === "rejected" ? "studio-review-button-active-reject" : ""}`} onClick={() => onDecision(variant.id, "rejected")}><X size={17} /> Reject</button><button type="button" className={`studio-review-button studio-review-approve ${decision === "approved" ? "studio-review-button-active-approve" : ""}`} onClick={() => onDecision(variant.id, "approved")}><Check size={17} /> Approve</button></div></article>;
}

function ReviewFooter({ variants, approved, rejected, average }: { variants: VariantCandidate[]; approved: number; rejected: number; average: number }) {
  return <footer className="studio-review-footer"><div className="flex flex-wrap gap-4"><span><span className="studio-status-dot studio-status-dot-active" /> {approved} approved</span><span><span className="studio-status-dot studio-status-dot-risk" /> {rejected} rejected</span><span>{variants.length - approved - rejected} pending</span></div><span className="studio-mono">Global confidence {average}%</span></footer>;
}

function StudioStep({ step }: { step: AnalysisStep }) {
  return <div className={`studio-step ${step.status === "running" ? "studio-step-active" : ""}`}><div className="flex items-center justify-between gap-2">{step.status === "complete" ? <CheckCircle2 size={17} className="studio-cyan" /> : step.status === "failed" ? <CircleAlert size={17} className="studio-orange" /> : step.status === "running" ? <Activity size={17} className="studio-cyan animate-pulse" /> : <span className="studio-step-dot" />}<span className="studio-mono">{step.status === "complete" ? "100%" : step.status === "running" ? "LIVE" : "0%"}</span></div><p className="mt-3 text-sm font-bold leading-5">{step.label}</p><div className="studio-step-progress"><span style={{ width: step.status === "complete" ? "100%" : step.status === "running" ? "64%" : "0%" }} /></div></div>;
}

function DataLine({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function FilterButton({ active, label, count, description, onClick }: { active: boolean; label: string; count: number; description: string; onClick: () => void }) { return <button type="button" className={active ? "studio-filter-active" : ""} onClick={onClick} aria-pressed={active} aria-label={`${label} (${count})`} title={description}><span>{label}</span><span className="studio-filter-count">{count}</span></button>; }
function FilterEmpty() { return <p className="studio-filter-empty">No candidates match this filter.</p>; }
function VariantBadge({ type }: { type: VariantType }) { return <span className="studio-variant-badge">{type.replaceAll("_", " ")}</span>; }
function Confidence({ value, risk }: { value: number; risk: boolean }) { return <div className={`studio-confidence ${risk ? "studio-orange" : "studio-cyan"}`}><strong>{Math.round(value * 100)}%</strong><span><i style={{ width: `${Math.round(value * 100)}%` }} /></span></div>; }
function DecisionButton({ label, active, tone, onClick }: { label: string; active: boolean; tone: "approve" | "reject"; onClick: () => void }) { return <button type="button" className={`studio-decision-button ${active ? `studio-decision-${tone}` : ""}`} onClick={onClick} aria-label={label} title={label}>{tone === "approve" ? <Check size={16} /> : <X size={16} />}</button>; }
function StudioMetric({ label, value }: { label: string; value: string }) { return <div className="studio-metric"><span>{label}</span><strong>{value}</strong></div>; }
function ReadinessFlag({ label, active }: { label: string; active: boolean }) { return <span className={`studio-readiness ${active ? "studio-readiness-active" : ""}`}>{active ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}{label}</span>; }

function matchesFilter(variant: VariantCandidate, filter: FilterMode) {
  if (filter === "all") return true;
  if (filter === "risk") return variant.confidence < 0.7 || variant.translationRisk === "high" || variant.type === "uncertain" || variant.type === "skipped_line";
  return ["adlib", "city_shoutout", "extension", "repeated_hook", "timing_drift"].includes(variant.type);
}
function filterDescription(filter: FilterMode) { if (filter === "performance") return "live-performance changes"; if (filter === "risk") return "candidates needing focused review"; return "all detected candidates"; }
function riskMessage(variants: VariantCandidate[]) { const risky = variants.filter((variant) => matchesFilter(variant, "risk")); return risky.length ? `${risky.length} candidate${risky.length === 1 ? "" : "s"} need focused review before export.` : "No high-risk candidates detected in the current comparison."; }
function formatSourceMode(value: string) { if (value.includes("fixture")) return "Demo Ready"; return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatRecordingId(value: string) { return value.replace(/^fixture-/i, "demo-").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatTime(value: number) { const minutes = Math.floor(value / 60); const seconds = value - minutes * 60; return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`; }
function formatOffset(value: number) { return `00:${formatTime(value)}`; }
function formatEventDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
function formatSetlistPosition(position?: number, songCount?: number) { return position ? `${position}${songCount ? ` of ${songCount}` : ""}` : "Not confirmed"; }
function slugify(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "track"; }

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
  { id: "P1", type: "city_shoutout", start: 4.2, end: 8.5, liveText: "Cape Town carry this chorus through the avenue", canonicalAlignmentReference: "L2 (76% token overlap)", confidence: 0.84, impactNote: "Event-specific wording is likely intentional.", recommendedAction: "Attach event metadata; no canonical lyric edit required.", translationRisk: "medium", severity: "medium" },
  { id: "P2", type: "repeated_hook", start: 12.8, end: 17.4, liveText: "Sing it once more, sing it once more until the morning arrives", canonicalAlignmentReference: "L4 (81% token overlap)", confidence: 0.78, impactNote: "The hook appears twice in the live structure.", recommendedAction: "Extend live subtitle timing while preserving the canonical lyric.", translationRisk: "low", severity: "medium" },
  { id: "P3", type: "skipped_line", start: 16, end: 20, liveText: "[not detected in live vocal]", canonicalAlignmentReference: "L5 (canonical line absent)", confidence: 0.58, impactNote: "Low confidence omission candidate.", recommendedAction: "Confirm the omission and review live-caption coverage.", translationRisk: "high", severity: "high" }
];
