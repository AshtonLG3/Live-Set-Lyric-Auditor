import { useMemo, useState } from "react";
import {
  Activity,
  AudioLines,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleAlert,
  Download,
  FileCheck2,
  Fingerprint,
  LayoutDashboard,
  Link2,
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
  onNarrate: () => Promise<void> | void;
  onExport: (decisions: ReviewDecisions) => void;
  onNewSession: () => void;
};

export function AnalysisStudio(props: Props) {
  const [filter, setFilter] = useState<FilterMode>("all");
  const [decisions, setDecisions] = useState<ReviewDecisions>({});
  const passport = props.job?.passport;
  const track = passport?.track ?? props.selectedTrack;
  const event = passport?.event ?? props.selectedEvent ?? null;
  const variants = passport?.variants ?? previewVariants;
  const steps = props.job?.progress ?? defaultSteps;
  const completeSteps = steps.filter((step) => step.status === "complete").length;
  const progress = Math.round((completeSteps / Math.max(1, steps.length)) * 100);
  const filteredVariants = useMemo(() => variants.filter((variant) => matchesFilter(variant, filter)), [filter, variants]);
  const filterCounts = useMemo(() => ({
    all: variants.length,
    performance: variants.filter((variant) => matchesFilter(variant, "performance")).length,
    risk: variants.filter((variant) => matchesFilter(variant, "risk")).length
  }), [variants]);
  const approvedCount = Object.values(decisions).filter((decision) => decision === "approved").length;
  const rejectedCount = Object.values(decisions).filter((decision) => decision === "rejected").length;
  const averageConfidence = variants.length
    ? Math.round((variants.reduce((total, variant) => total + variant.confidence, 0) / variants.length) * 100)
    : 0;
  const status = props.job?.status ?? "queued";
  const active = status === "running" || status === "queued";

  function decide(id: string, decision: ReviewDecision) {
    setDecisions((current) => {
      const next = { ...current };
      if (next[id] === decision) delete next[id];
      else next[id] = decision;
      return next;
    });
  }

  function jumpTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="studio-shell min-h-[calc(100vh-65px)] pb-24 md:pb-0">
      <section className="studio-wavebar" aria-label="Live analysis waveform">
        <div className="studio-wave-meta">
          <span className="studio-label">Live Engine Input</span>
          <div className="mt-2 flex items-center gap-3">
            <span className={`studio-transport ${active ? "studio-transport-active" : ""}`}><AudioLines size={20} /></span>
            <div>
              <p className="studio-time">{formatOffset(passport?.variants[0]?.start ?? progress / 4)}</p>
              <p className="studio-subtle">{active ? "Analyzing source" : "Review session"} · {progress}%</p>
            </div>
          </div>
        </div>
        <div className="studio-waveform">
          <WaveformCanvas progress={Math.max(8, progress)} active={active} />
          <span className="studio-wave-badge">{active ? "ANALYZING" : "REVIEW"}</span>
        </div>
        <div className="studio-sync">
          <span className="studio-label">Capture Status</span>
          <span className="studio-sync-badge"><span className={`studio-status-dot ${active ? "studio-status-dot-active" : ""}`} /> {active ? "ACTIVE SYNC" : "PASSPORT READY"}</span>
        </div>
      </section>

      <div className="studio-body">
        <aside id="studio-context" className="studio-sidebar">
          <StudioSectionLabel icon={<Fingerprint size={15} />} label="Track Anchor" />
          <div className="studio-anchor-card studio-anchor-card-active">
            <div className="flex items-start justify-between gap-3">
              <span className="studio-mono">ID: {track?.id ?? "PENDING"}</span>
              <CheckCircle2 size={17} className="studio-cyan" />
            </div>
            <p className="mt-3 text-base font-bold">{track?.title ?? "Recording match pending"}</p>
            <p className="studio-subtle mt-1">{track?.artist ?? "Musixmatch catalog"}{track?.album ? ` · ${track.album}` : ""}</p>
          </div>

          <div className="mt-6">
            <StudioSectionLabel icon={<CalendarDays size={15} />} label="Event Anchor" />
            {event ? (
              <div className="studio-event-line">
                <span className="studio-event-dot studio-event-dot-active" />
                <p className="studio-mono">{formatEventDate(event.date)}</p>
                <p className="mt-1 font-bold">{event.venue}</p>
                <p className="studio-subtle mt-1">{event.city}</p>
              </div>
            ) : (
              <p className="studio-empty">No event anchor selected.</p>
            )}
          </div>

          <div className="mt-6">
            <StudioSectionLabel icon={<Link2 size={15} />} label="Source Evidence" />
            <div className="studio-data-list">
              <DataLine label="Input" value={passport?.clip.source.kind.replaceAll("_", " ") ?? "fixture preview"} />
              <DataLine label="Mode" value={passport?.clip.source.processingMode.replaceAll("_", " ") ?? props.health?.runtimeMode ?? "fixture"} />
              <DataLine label="Duration" value={`${passport?.clip.durationSeconds ?? 24}s`} />
            </div>
            {passport?.clip.source.url && <a className="studio-source-link" href={passport.clip.source.url} target="_blank" rel="noreferrer">Open original source</a>}
          </div>

          <div className="mt-6">
            <StudioSectionLabel icon={<ShieldCheck size={15} />} label="Musixmatch Truth Layer" />
            <div className="studio-data-list">
              <DataLine label="Version" value={`${Math.round((passport?.recordingIdentity.versionConfidence ?? 0.91) * 100)}%`} />
              <DataLine label="Sync fit" value={`${Math.round((passport?.recordingIdentity.syncFitScore ?? 0.84) * 100)}%`} />
              <DataLine label="Reference" value={passport?.recordingIdentity.canonicalSource ?? "fixture"} />
              <DataLine label="Rights" value={passport?.rights.status.replaceAll("_", " ") ?? "fixture"} />
            </div>
          </div>

          <div className="studio-risk-card">
            <CircleAlert size={17} />
            <div>
              <p className="studio-label studio-orange">Review Signal</p>
              <p className="mt-2 text-sm leading-6">{riskMessage(variants)}</p>
            </div>
          </div>
        </aside>

        <section id="studio-analysis" className="studio-main">
          <header className="studio-main-header">
            <div>
              <p className="studio-label studio-cyan">Live Variant Passport</p>
              <h1 className="mt-1 text-2xl font-bold md:text-3xl">Variant Candidates</h1>
              <p className="studio-subtle mt-1">Live vocal evidence aligned to the Musixmatch canonical reference</p>
            </div>
            <div className="studio-filter-control">
              <div className="studio-filter-group" aria-label="Variant filters">
                <FilterButton active={filter === "all"} label="All" count={filterCounts.all} description="Show every detected candidate" onClick={() => setFilter("all")} />
                <FilterButton active={filter === "performance"} label="Performance" count={filterCounts.performance} description="Show live-performance changes such as shoutouts, ad-libs, repeats, and extensions" onClick={() => setFilter("performance")} />
                <FilterButton active={filter === "risk"} label="Risks" count={filterCounts.risk} description="Show low-confidence, omitted, uncertain, or high-translation-risk candidates" onClick={() => setFilter("risk")} />
              </div>
              <p className="studio-filter-feedback" role="status" aria-live="polite">
                Showing {filteredVariants.length} of {variants.length}: {filterDescription(filter)}
              </p>
            </div>
          </header>

          <section className="studio-timeline" aria-label="Analysis timeline">
            {steps.map((step) => <StudioStep key={step.id} step={step} />)}
          </section>

          {props.error && <p className="studio-error">{props.error}</p>}

          <section className="studio-table-wrap hidden md:block">
            <div className="studio-table-head">
              <span>Time</span><span>Type</span><span>Live Content</span><span>Confidence</span><span>Action</span>
            </div>
            <div>
              {filteredVariants.length ? filteredVariants.map((variant) => (
                <CandidateRow key={variant.id} variant={variant} decision={decisions[variant.id]} onDecision={decide} />
              )) : <FilterEmpty />}
            </div>
            <ReviewFooter variants={variants} approved={approvedCount} rejected={rejectedCount} average={averageConfidence} />
          </section>

          <section className="space-y-3 md:hidden">
            {filteredVariants.length ? filteredVariants.map((variant) => (
              <CandidateCard key={variant.id} variant={variant} decision={decisions[variant.id]} onDecision={decide} />
            )) : <FilterEmpty />}
            <ReviewFooter variants={variants} approved={approvedCount} rejected={rejectedCount} average={averageConfidence} />
          </section>

          <section id="studio-passport" className="studio-lower-grid">
            <article className="studio-panel">
              <div className="studio-panel-heading"><span><BadgeCheck size={17} /> Passport Preview</span><span className="studio-status-dot studio-status-dot-active" /></div>
              <div className="p-4 md:p-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <StudioMetric label="Overall" value={`${Math.round((passport?.confidenceOverview.overall ?? 0.81) * 100)}%`} />
                  <StudioMetric label="ASR" value={`${Math.round((passport?.confidenceOverview.asr ?? 0.88) * 100)}%`} />
                  <StudioMetric label="Alignment" value={`${Math.round((passport?.confidenceOverview.alignment ?? 0.72) * 100)}%`} />
                </div>
                <p className="mt-4 text-sm leading-6">{passport?.summary ?? "Run a session to replace the fixture preview with derived Live Variant Passport data."}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(passport?.structureMap.live ?? ["Live opening", "City shoutout", "Hook repeat"]).map((item) => <span key={item} className="studio-chip">{item}</span>)}
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button className="studio-secondary-button" type="button" onClick={() => void props.onNarrate()}><Sparkles size={16} /> Generate narration</button>
                  <button className="studio-primary-button" type="button" onClick={() => props.onExport(decisions)} disabled={!passport} title="Export the Passport with current approve, reject, and pending review states"><Download size={16} /> Export Passport</button>
                </div>
                <p className="studio-export-note">Export includes the current review state: {approvedCount} approved, {rejectedCount} rejected, {variants.length - approvedCount - rejectedCount} pending.</p>
                {props.narration && (
                  <div className="studio-narration">
                    <p className="studio-label">{props.narration.mode}</p>
                    <p className="mt-2 text-sm leading-6">{props.narration.text}</p>
                    {props.narration.audioUrl && <audio className="mt-3 w-full" controls src={props.narration.audioUrl} />}
                  </div>
                )}
              </div>
            </article>

            <article className="studio-panel">
              <div className="studio-panel-heading"><span><Fingerprint size={17} /> Recording Intelligence</span><span className="studio-mono">{passport?.recordingIdentity.matchMethod.replaceAll("_", " ") ?? "fixture rescue"}</span></div>
              <div className="p-4 md:p-5">
                <div className="studio-data-list">
                  <DataLine label="Track ID" value={passport?.recordingIdentity.trackId ?? track?.id ?? "pending"} />
                  <DataLine label="Common track" value={passport?.recordingIdentity.commonTrackId ?? "not supplied"} />
                  <DataLine label="Attribution" value={passport?.rights.attribution ?? "Lyrics powered by Musixmatch"} />
                  <DataLine label="Language" value={passport?.rights.language?.toUpperCase() ?? track?.language?.toUpperCase() ?? "EN"} />
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
      </div>

      <nav className="studio-mobile-nav md:hidden" aria-label="Studio navigation">
        <button type="button" onClick={props.onNewSession}><LayoutDashboard size={19} /><span>Session</span></button>
        <button type="button" className="studio-mobile-nav-active" onClick={() => jumpTo("studio-analysis")}><Activity size={19} /><span>Analysis</span></button>
        <button type="button" onClick={() => jumpTo("studio-context")}><Search size={19} /><span>Track</span></button>
        <button type="button" onClick={() => jumpTo("studio-passport")}><FileCheck2 size={19} /><span>Passport</span></button>
      </nav>
    </main>
  );
}

function CandidateRow({ variant, decision, onDecision }: { variant: VariantCandidate; decision?: ReviewDecision; onDecision: (id: string, decision: ReviewDecision) => void }) {
  return (
    <div className={`studio-table-row ${variant.severity === "high" ? "studio-table-row-risk" : ""}`}>
      <span className="studio-mono">{formatTime(variant.start)}</span>
      <VariantBadge type={variant.type} />
      <div className="min-w-0">
        <p className="font-medium">{variant.liveText}</p>
        <p className="studio-subtle mt-1">{variant.canonicalAlignmentReference}</p>
        <p className="mt-2 text-sm leading-5">{variant.recommendedAction}</p>
      </div>
      <Confidence value={variant.confidence} risk={variant.severity === "high"} />
      <div className="flex justify-end gap-2">
        <DecisionButton label="Approve candidate" active={decision === "approved"} tone="approve" onClick={() => onDecision(variant.id, "approved")} />
        <DecisionButton label="Reject candidate" active={decision === "rejected"} tone="reject" onClick={() => onDecision(variant.id, "rejected")} />
      </div>
    </div>
  );
}

function CandidateCard({ variant, decision, onDecision }: { variant: VariantCandidate; decision?: ReviewDecision; onDecision: (id: string, decision: ReviewDecision) => void }) {
  return (
    <article className={`studio-candidate-card ${variant.severity === "high" ? "studio-candidate-card-risk" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><span className="studio-mono">{formatTime(variant.start)}</span><VariantBadge type={variant.type} /></div>
        <Confidence value={variant.confidence} risk={variant.severity === "high"} />
      </div>
      <p className="mt-4 text-base font-semibold leading-6">{variant.liveText}</p>
      <p className="studio-subtle mt-2">Canonical alignment: {variant.canonicalAlignmentReference}</p>
      <div className="studio-impact-note"><CircleAlert size={15} /><span>{variant.impactNote}</span></div>
      <p className="mt-3 text-sm leading-6">{variant.recommendedAction}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" className={`studio-review-button ${decision === "rejected" ? "studio-review-button-active-reject" : ""}`} onClick={() => onDecision(variant.id, "rejected")}><X size={17} /> Reject</button>
        <button type="button" className={`studio-review-button studio-review-approve ${decision === "approved" ? "studio-review-button-active-approve" : ""}`} onClick={() => onDecision(variant.id, "approved")}><Check size={17} /> Approve</button>
      </div>
    </article>
  );
}

function ReviewFooter({ variants, approved, rejected, average }: { variants: VariantCandidate[]; approved: number; rejected: number; average: number }) {
  return (
    <footer className="studio-review-footer">
      <div className="flex flex-wrap gap-4">
        <span><span className="studio-status-dot studio-status-dot-active" /> {approved} approved</span>
        <span><span className="studio-status-dot studio-status-dot-risk" /> {rejected} rejected</span>
        <span>{variants.length - approved - rejected} pending</span>
      </div>
      <span className="studio-mono">Global confidence {average}%</span>
    </footer>
  );
}

function StudioStep({ step }: { step: AnalysisStep }) {
  return (
    <div className={`studio-step ${step.status === "running" ? "studio-step-active" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        {step.status === "complete" ? <CheckCircle2 size={17} className="studio-cyan" /> : step.status === "failed" ? <CircleAlert size={17} className="studio-orange" /> : step.status === "running" ? <Activity size={17} className="studio-cyan animate-pulse" /> : <span className="studio-step-dot" />}
        <span className="studio-mono">{step.status === "complete" ? "100%" : step.status === "running" ? "LIVE" : "0%"}</span>
      </div>
      <p className="mt-3 text-sm font-bold leading-5">{step.label}</p>
      <div className="studio-step-progress"><span style={{ width: step.status === "complete" ? "100%" : step.status === "running" ? "64%" : "0%" }} /></div>
    </div>
  );
}

function StudioSectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <h2 className="studio-section-label">{icon}{label}</h2>;
}

function DataLine({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function FilterButton({ active, label, count, description, onClick }: { active: boolean; label: string; count: number; description: string; onClick: () => void }) {
  return <button type="button" className={active ? "studio-filter-active" : ""} onClick={onClick} aria-pressed={active} aria-label={`${label} (${count})`} title={description}><span>{label}</span><span className="studio-filter-count">{count}</span></button>;
}

function FilterEmpty() {
  return <p className="studio-filter-empty">No candidates match this filter.</p>;
}

function VariantBadge({ type }: { type: VariantType }) {
  return <span className="studio-variant-badge">{type.replaceAll("_", " ")}</span>;
}

function Confidence({ value, risk }: { value: number; risk: boolean }) {
  return (
    <div className={`studio-confidence ${risk ? "studio-orange" : "studio-cyan"}`}>
      <strong>{Math.round(value * 100)}%</strong>
      <span><i style={{ width: `${Math.round(value * 100)}%` }} /></span>
    </div>
  );
}

function DecisionButton({ label, active, tone, onClick }: { label: string; active: boolean; tone: "approve" | "reject"; onClick: () => void }) {
  return (
    <button type="button" className={`studio-decision-button ${active ? `studio-decision-${tone}` : ""}`} onClick={onClick} aria-label={label} title={label}>
      {tone === "approve" ? <Check size={16} /> : <X size={16} />}
    </button>
  );
}

function StudioMetric({ label, value }: { label: string; value: string }) {
  return <div className="studio-metric"><span>{label}</span><strong>{value}</strong></div>;
}

function ReadinessFlag({ label, active }: { label: string; active: boolean }) {
  return <span className={`studio-readiness ${active ? "studio-readiness-active" : ""}`}>{active ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}{label}</span>;
}

function matchesFilter(variant: VariantCandidate, filter: FilterMode) {
  if (filter === "all") return true;
  if (filter === "risk") return variant.confidence < 0.7 || variant.translationRisk === "high" || variant.type === "uncertain" || variant.type === "skipped_line";
  return ["adlib", "city_shoutout", "extension", "repeated_hook", "timing_drift"].includes(variant.type);
}

function filterDescription(filter: FilterMode) {
  if (filter === "performance") return "live-performance changes";
  if (filter === "risk") return "candidates needing focused review";
  return "all detected candidates";
}

function riskMessage(variants: VariantCandidate[]) {
  const risky = variants.filter((variant) => matchesFilter(variant, "risk"));
  return risky.length ? `${risky.length} candidate${risky.length === 1 ? "" : "s"} need focused review before export.` : "No high-risk candidates detected in the current comparison.";
}

function formatTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

function formatOffset(value: number) {
  return `00:${formatTime(value)}`;
}

function formatEventDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const defaultSteps: AnalysisStep[] = [
  { id: "ingest", label: "Validate source", status: "complete" },
  { id: "isolate", label: "Isolate live vocal", status: "complete" },
  { id: "transcribe", label: "Transcribe vocal", status: "running" },
  { id: "anchor", label: "Match recording", status: "queued" },
  { id: "compare", label: "Compare timing", status: "queued" },
  { id: "passport", label: "Generate Passport", status: "queued" }
];

const previewVariants: VariantCandidate[] = [
  {
    id: "P1",
    type: "city_shoutout",
    start: 4.2,
    end: 8.5,
    liveText: "Cape Town carry this chorus through the avenue",
    canonicalAlignmentReference: "L2 (76% token overlap)",
    confidence: 0.84,
    impactNote: "Event-specific wording is likely intentional.",
    recommendedAction: "Attach event metadata; no canonical lyric edit required.",
    translationRisk: "medium",
    severity: "medium"
  },
  {
    id: "P2",
    type: "repeated_hook",
    start: 12.8,
    end: 17.4,
    liveText: "Sing it once more, sing it once more until the morning arrives",
    canonicalAlignmentReference: "L4 (81% token overlap)",
    confidence: 0.78,
    impactNote: "The hook appears twice in the live structure.",
    recommendedAction: "Extend live subtitle timing while preserving the canonical lyric.",
    translationRisk: "low",
    severity: "medium"
  },
  {
    id: "P3",
    type: "skipped_line",
    start: 16,
    end: 20,
    liveText: "[not detected in live vocal]",
    canonicalAlignmentReference: "L5 (canonical line absent)",
    confidence: 0.58,
    impactNote: "Low confidence omission candidate.",
    recommendedAction: "Confirm the omission and review live-caption coverage.",
    translationRisk: "high",
    severity: "high"
  }
];
