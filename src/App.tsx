import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  CalendarDays,
  Download,
  ExternalLink,
  FileText,
  LayoutDashboard,
  Moon,
  Plus,
  Search,
  Sun,
} from "lucide-react";
import { createNarration, getAnalysis, getHealth, getTrackLink, reanchorAnalysis, retranscribeAnalysis, searchEvents, searchTracks, startAnalysis, subscribeToJob } from "./api";
import type { AnalysisJob, EventCandidate, HealthResponse, LineComparison, NarrationResponse, TrackCandidate, VariantCandidate } from "../shared/types";
import { APP_NAME, APP_VERSION } from "../shared/version";
import { AnalysisStudio, type ReviewDecision, type ReviewDecisions } from "./components/AnalysisStudio";
import { SessionWorkspace } from "./components/SessionWorkspace";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { IntakeAnalysisInput } from "./components/ClipIntake";

type Theme = "light" | "dark";
type Workspace = "session" | "studio";

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("lal-theme") as Theme) || "dark");
  const [workspace, setWorkspace] = useState<Workspace>("session");
  const [activeSection, setActiveSection] = useState("clip-intake");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [trackQuery, setTrackQuery] = useState("");
  const [tracks, setTracks] = useState<TrackCandidate[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<TrackCandidate | undefined>();
  const [eventCity, setEventCity] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [events, setEvents] = useState<EventCandidate[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventCandidate | null | undefined>();
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [narration, setNarration] = useState<NarrationResponse | null>(null);
  const [reviewDecisions, setReviewDecisions] = useState<ReviewDecisions>({});
  const [manualVariants, setManualVariants] = useState<VariantCandidate[]>([]);
  const [editedTexts, setEditedTexts] = useState<Record<string, string>>({});
  const [trackHistory, setTrackHistory] = useState<TrackCandidate[]>([]);
  const runtimeStatus = getRuntimeStatus(health?.runtimeMode);

  const rememberTrack = useCallback((track?: TrackCandidate) => {
    if (!track) return;
    setTrackHistory((current) => [
      track,
      ...current.filter((item) => item.id !== track.id)
    ].slice(0, 6));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("lal-theme", theme);
  }, [theme]);

  useEffect(() => {
    void getHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  const trackSearchTimer = useRef(0);
  useEffect(() => {
    window.clearTimeout(trackSearchTimer.current);
    if (!trackQuery.trim()) return;
    trackSearchTimer.current = window.setTimeout(() => {
      void searchTracks(trackQuery).then((items) => {
        setTracks(items);
        setSelectedTrack(items[0]);
      });
    }, 350);
    return () => window.clearTimeout(trackSearchTimer.current);
  }, [trackQuery]);

  useEffect(() => {
    if (!selectedTrack) {
      setEvents([]);
      setSelectedEvent(null);
      return;
    }
    const hasEventHint = Boolean(eventCity.trim() || eventDate.trim());
    void searchEvents({ artist: selectedTrack.artist, city: eventCity, date: eventDate })
      .then((items) => {
        setEvents(items);
        setSelectedEvent(hasEventHint ? items[0] ?? null : null);
      })
      .catch(() => {
        setEvents([]);
        setSelectedEvent(null);
      });
  }, [selectedTrack, eventCity, eventDate]);

  const handleJobUpdate = useCallback((updated: AnalysisJob) => {
    setJob(updated);
    if (updated.passport) {
      setSelectedTrack(updated.passport.track);
      setSelectedEvent(updated.passport.event ?? null);
      rememberTrack(updated.passport.track);
    }
    if (updated.status === "complete" || updated.status === "failed") {
      setBusy(false);
      if (updated.status === "failed") {
        setError(updated.error ?? "Analysis stopped before completion.");
      }
    }
  }, [rememberTrack]);

  const handleJobError = useCallback((err: Error) => {
    setBusy(false);
    setError(err.message);
  }, []);

  useEffect(() => {
    const jobId = job?.id;
    if (!jobId || job.status === "complete" || job.status === "failed") return;

    const cleanup = subscribeToJob(jobId, handleJobUpdate, handleJobError);
    return cleanup;
  }, [job?.id, job?.status, handleJobUpdate, handleJobError]);

  async function handleTrackSearch() {
    setError("");
    const items = await searchTracks(trackQuery);
    setTracks(items);
    setSelectedTrack(items[0]);
  }

  async function handleEventSearch() {
    if (!selectedTrack) return;
    setError("");
    const hasEventHint = Boolean(eventCity.trim() || eventDate.trim());
    const items = await searchEvents({ artist: selectedTrack.artist, city: eventCity, date: eventDate });
    setEvents(items);
    setSelectedEvent(hasEventHint ? items[0] ?? null : null);
  }

  async function handleAnalyze(input: IntakeAnalysisInput) {
    setBusy(true);
    setError("");
    setNarration(null);
    setReviewDecisions({});
    setManualVariants([]);
    setWorkspace("studio");
    setActiveSection("analysis-timeline");
    try {
      const { jobId } = await startAnalysis({
        file: input.file,
        durationSeconds: input.durationSeconds,
        autoMatch: input.autoMatch,
        source: input.source,
        recallSegments: input.recallSegments,
        track: input.autoMatch === false ? selectedTrack : undefined,
        event: input.autoMatch === false ? selectedEvent ?? null : null,
        trackQuery,
        eventCity,
        eventDate
      });
      const started = await getAnalysis(jobId);
      setJob(started);
      if (started.passport) {
        setSelectedTrack(started.passport.track);
        setSelectedEvent(started.passport.event ?? null);
        rememberTrack(started.passport.track);
      }
    } catch (analysisError) {
      setBusy(false);
      setError(analysisError instanceof Error ? analysisError.message : "Could not start analysis.");
    }
  }

  async function handleNarration() {
    if (!job?.id || !job.passport) return;
    setError("");
    setNarration(await createNarration(job.id, manualVariants, editedTexts, reviewDecisions));
  }

  async function handleCorrectTrack(track: TrackCandidate) {
    if (!job?.id) return;
    setError("");
    try {
      const updated = await reanchorAnalysis(job.id, track, {
        event: selectedEvent ?? null,
        eventCity,
        eventDate
      });
      setJob(updated);
      if (updated.passport) {
        setSelectedTrack(updated.passport.track);
        setSelectedEvent(updated.passport.event ?? null);
        rememberTrack(updated.passport.track);
      } else {
        setSelectedTrack(track);
      }
    } catch (correctionError) {
      setError(correctionError instanceof Error ? correctionError.message : "Could not correct the track anchor.");
    }
  }

  async function handleRetranscribe() {
    if (!job?.id) return;
    const recoveryRun = job.status === "failed" && !job.passport;
    const target = getRetranscriptionTarget(job);
    const confirmed = window.confirm(
      recoveryRun
        ? `Retry ${target.label} on the saved source media? This can recover failed speech-to-text runs and may consume provider credits.`
        : `Run ${target.label} on the saved source media? This replaces the current ASR transcript, refreshes the passport comparison, and may consume provider credits.`
    );
    if (!confirmed) return;
    setBusy(true);
    setError("");
    setNarration(null);
    setReviewDecisions({});
    setManualVariants([]);
    setEditedTexts({});
    try {
      const updated = await retranscribeAnalysis(job.id);
      setJob(updated);
      if (updated.passport) {
        setSelectedTrack(updated.passport.track);
        setSelectedEvent(updated.passport.event ?? null);
        rememberTrack(updated.passport.track);
      }
    } catch (retranscribeError) {
      setError(retranscribeError instanceof Error ? retranscribeError.message : `Could not run ${target.label}.`);
    } finally {
      setBusy(false);
    }
  }

  function handleRecallTrack(track: TrackCandidate) {
    setTrackQuery(`${track.title} ${track.artist}`);
    setTracks((current) => [track, ...current.filter((item) => item.id !== track.id)]);
    setSelectedTrack(track);
  }

  function decideVariant(id: string, decision: ReviewDecision) {
    setReviewDecisions((current) => {
      const next = { ...current };
      if (next[id] === decision) delete next[id];
      else next[id] = decision;
      return next;
    });
  }

  function addManualVariant(variant: VariantCandidate) {
    setManualVariants((current) => [...current, variant]);
    setReviewDecisions((current) => ({ ...current, [variant.id]: "approved" }));
  }

  function joinComparisonLines(current: LineComparison, next: LineComparison) {
    const currentText = editedTexts[current.id] ?? current.liveText;
    const nextText = editedTexts[next.id] ?? next.liveText;
    setEditedTexts((prev) => ({
      ...prev,
      [current.id]: `${currentText.trim()} ${lowercaseFirstLetter(nextText.trim())}`.replace(/\s+/g, " ").trim(),
      [next.id]: "[joined with previous line]"
    }));
  }

  function splitComparisonLine(comparison: LineComparison) {
    const currentText = editedTexts[comparison.id] ?? comparison.liveText;
    const marked = window.prompt("Insert / where this ASR line should split.", currentText);
    if (!marked || !marked.includes("/")) return;
    const [first, ...rest] = marked.split("/");
    const second = rest.join("/").trim();
    if (!first.trim() || !second) return;
    const splitAt = comparison.start + Math.max(0.1, (comparison.end - comparison.start) / 2);
    setEditedTexts((prev) => ({ ...prev, [comparison.id]: uppercaseFirstLetter(first.trim()) }));
    addManualVariant({
      id: `manual-split-${Date.now()}`,
      type: "adlib",
      start: splitAt,
      end: comparison.end,
      liveText: uppercaseFirstLetter(second),
      canonicalAlignmentReference: `Split from ${comparison.id}`,
      canonicalExcerpt: comparison.canonicalText,
      confidence: 0.75,
      impactNote: "Reviewer split this ASR line from the Passport Review.",
      recommendedAction: "Review the split line timing and approve or reject it before export.",
      translationRisk: "medium",
      severity: "medium",
      evidenceSource: "manual_entry",
      evidenceTier: "needs_review",
      reviewerNote: "Split from Passport Review."
    });
  }

  function updateTrackUrl(trackId: string, url: string) {
    const patch = (track: TrackCandidate) => track.id === trackId ? { ...track, url } : track;
    setTracks((current) => current.map(patch));
    setTrackHistory((current) => current.map(patch));
    setSelectedTrack((current) => current ? patch(current) : current);
    setJob((current) => {
      if (!current?.passport || current.passport.track.id !== trackId) return current;
      return {
        ...current,
        passport: {
          ...current.passport,
          track: patch(current.passport.track)
        }
      };
    });
  }

  async function handleVisitTrack(track: TrackCandidate) {
    setError("");
    let url = track.url;
    if (!isHttpUrl(url) && track.source === "musixmatch") {
      try {
        url = await getTrackLink(track.id);
        if (url) updateTrackUrl(track.id, url);
      } catch {
        url = undefined;
      }
    }
    if (!isHttpUrl(url)) {
      setError("Musixmatch did not return a track page for this matched track yet.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function startNewSession() {
    setWorkspace("session");
    setActiveSection("clip-intake");
    setJob(null);
    setNarration(null);
    setReviewDecisions({});
    setManualVariants([]);
    setEditedTexts({});
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function navigate(workspaceTarget: Workspace, anchor?: string) {
    if (workspaceTarget === "studio" && !job) return;
    setWorkspace(workspaceTarget);
    setActiveSection(anchor ?? (workspaceTarget === "session" ? "clip-intake" : "analysis-timeline"));
    if (anchor) window.setTimeout(() => {
      const target = document.getElementById(anchor);
      if (target && typeof target.scrollIntoView === "function") target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function exportPassport() {
    if (!job?.passport) return;
    const variants = [...job.passport.variants, ...manualVariants];
    const review = variants.map((variant) => ({
      variantId: variant.id,
      decision: reviewDecisions[variant.id] ?? "pending"
    }));
    const editedComparisons = job.passport.lineComparisons.map((lc) => {
      const edited = editedTexts[lc.id];
      return edited && edited !== lc.liveText ? { ...lc, liveText: edited } : lc;
    });
    const editedTranscript = job.passport.clip.transcript.map((seg) => {
      const match = editedComparisons.find((lc) => lc.canonicalId && Math.abs(lc.start - seg.start) < 0.5);
      return match && editedTexts[match.id] ? { ...seg, text: editedTexts[match.id] } : seg;
    });
    const reviewedPassport = {
      ...job.passport,
      variants,
      lineComparisons: editedComparisons,
      clip: { ...job.passport.clip, transcript: editedTranscript },
      review: {
        exportedAt: new Date().toISOString(),
        status: review.every((item) => item.decision !== "pending") ? "complete" : "in_progress",
        decisions: review,
        manualChanges: {
          addedMoments: manualVariants.map((variant) => ({
            variantId: variant.id,
            start: variant.start,
            end: variant.end,
            liveText: variant.liveText,
            reference: variant.canonicalExcerpt,
            reviewerNote: variant.reviewerNote
          })),
          editedLines: editedComparisons
            .filter((comparison) => editedTexts[comparison.id] && editedTexts[comparison.id] !== job.passport!.lineComparisons.find((line) => line.id === comparison.id)?.liveText)
            .map((comparison) => ({
              comparisonId: comparison.id,
              start: comparison.start,
              liveText: comparison.liveText
            }))
        }
      }
    };
    const blob = new Blob([JSON.stringify(reviewedPassport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `live-variant-passport-${job.passport.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="studio-app min-h-screen">
      <header className="studio-app-topbar">
        <button type="button" className="studio-app-brand" onClick={() => navigate("session")}>
          <span className="studio-app-brand-mark"><AudioLines size={19} /></span>
          <span><strong>{APP_NAME}</strong><small>v{APP_VERSION}</small></span>
        </button>

        <nav className="studio-app-topnav" aria-label="Primary navigation">
          <TopNavButton label="Dashboard" active={workspace === "session"} onClick={() => navigate("session")} />
          <TopNavButton label="Analysis" active={workspace === "studio"} disabled={!job} onClick={() => navigate("studio")} />
        </nav>

        <div className="studio-app-actions">
          <button type="button" className="studio-new-session-button" onClick={startNewSession}><Plus size={16} /> <span>New Session</span></button>
          <button type="button" className="studio-export-button" onClick={exportPassport} disabled={!job?.passport} title={job?.passport ? "Export the Passport with current review decisions" : "Run an analysis before exporting"}><Download size={17} /> <span>Export Passport</span></button>
          <span className="app-runtime-status hidden 2xl:inline-flex" title={runtimeStatus.detail} aria-label={`Runtime status: ${runtimeStatus.label}. ${runtimeStatus.detail}`}>
            <span className={`app-runtime-dot app-runtime-dot-${health?.runtimeMode ?? "fixture"}`} />{runtimeStatus.label}
          </span>
          <button type="button" className="studio-header-icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <div className="studio-app-frame">
        <aside className="studio-app-sidebar">
          <div className="studio-engine-lockup">
            <span><AudioLines size={23} /></span>
            <div><strong>Studio Engine</strong><small>v{APP_VERSION}-QA</small></div>
          </div>
          <nav aria-label={`${workspace === "session" ? "Dashboard" : "Analysis"} sections`}>
            <p className="studio-sidebar-context-label">{workspace === "session" ? "Dashboard" : "Analysis"}</p>
            {workspace === "session" ? (
              <>
                <SideNavButton label="Clip Intake" icon={<AudioLines size={19} />} active={activeSection === "clip-intake"} onClick={() => navigate("session", "clip-intake")} />
                <SideNavButton label="Track Anchor" icon={<Search size={19} />} active={activeSection === "track-anchor"} onClick={() => navigate("session", "track-anchor")} />
                <SideNavButton label="Event Anchor" icon={<CalendarDays size={19} />} active={activeSection === "event-anchor"} onClick={() => navigate("session", "event-anchor")} />
              </>
            ) : (
              <>
                <SideNavButton label="Timeline" icon={<Activity size={19} />} active={activeSection === "analysis-timeline"} onClick={() => navigate("studio", "analysis-timeline")} />
                <SideNavButton label="Diff View" icon={<FileText size={19} />} active={activeSection === "diff-view"} onClick={() => navigate("studio", "diff-view")} />
              </>
            )}
          </nav>
          <TrackHistoryPanel
            tracks={trackHistory}
            currentTrackId={job?.passport?.track.id ?? selectedTrack?.id}
            onVisitTrack={handleVisitTrack}
          />
        </aside>

        <div className="studio-app-content">
          <ErrorBoundary>
          {workspace === "session" ? (
            <SessionWorkspace
              health={health}
              tracks={tracks}
              selectedTrack={selectedTrack}
              trackQuery={trackQuery}
              events={events}
              selectedEvent={selectedEvent}
              eventCity={eventCity}
              eventDate={eventDate}
              busy={busy}
              error={error}
              onAnalyze={handleAnalyze}
              onTrackMatched={handleRecallTrack}
              onTrackQueryChange={setTrackQuery}
              onTrackSearch={handleTrackSearch}
              onTrackSelect={setSelectedTrack}
              onEventCityChange={setEventCity}
              onEventDateChange={setEventDate}
              onEventSearch={handleEventSearch}
              onEventSelect={setSelectedEvent}
            />
          ) : (
            <AnalysisStudio
              job={job}
              health={health}
              selectedTrack={selectedTrack}
              selectedEvent={selectedEvent}
              narration={narration}
              error={error}
              decisions={reviewDecisions}
              manualVariants={manualVariants}
              onDecision={decideVariant}
              onAddManualVariant={addManualVariant}
              onNarrate={handleNarration}
              editedTexts={editedTexts}
              onEditLiveText={(id, text) => setEditedTexts((prev) => ({ ...prev, [id]: text }))}
              onJoinLines={joinComparisonLines}
              onSplitLine={splitComparisonLine}
              onCorrectTrack={handleCorrectTrack}
              onRetranscribe={handleRetranscribe}
              onVisitTrack={handleVisitTrack}
            />
          )}
          </ErrorBoundary>
        </div>
      </div>

      <nav className="studio-global-mobile-nav lg:hidden" aria-label="Mobile navigation">
        <button type="button" className={workspace === "session" ? "active" : ""} onClick={() => navigate("session")}><LayoutDashboard size={19} /><span>Dashboard</span></button>
        <button type="button" className={workspace === "studio" ? "active" : ""} disabled={!job} onClick={() => navigate("studio")}><Activity size={19} /><span>Analysis</span></button>
      </nav>
    </div>
  );
}

function TrackHistoryPanel({
  tracks,
  currentTrackId,
  onVisitTrack
}: {
  tracks: TrackCandidate[];
  currentTrackId?: string;
  onVisitTrack: (track: TrackCandidate) => Promise<void> | void;
}) {
  if (tracks.length === 0) return null;
  return (
    <section className="studio-track-history" aria-label="Matched track history">
      <p className="studio-sidebar-context-label">Matched Tracks</p>
      <div>
        {tracks.map((track) => {
          const hasLink = isHttpUrl(track.url) || track.source === "musixmatch";
          return (
            <article key={track.id} className={track.id === currentTrackId ? "active" : ""}>
              <div>
                <strong>{track.title}</strong>
                <small>{track.artist}</small>
              </div>
              <button
                type="button"
                disabled={!hasLink}
                onClick={() => void onVisitTrack(track)}
                title={hasLink ? "Open the Musixmatch track page" : "No Musixmatch track page available"}
                aria-label={`Visit matched track ${track.title}`}
              >
                <ExternalLink size={13} />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TopNavButton({ label, active, disabled, onClick }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={active ? "active" : ""} disabled={disabled} onClick={onClick}>{label}</button>;
}

function SideNavButton({ label, icon, active, disabled, onClick }: { label: string; icon: React.ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={active ? "active" : ""} aria-current={active ? "location" : undefined} disabled={disabled} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function isHttpUrl(value?: string): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}

function lowercaseFirstLetter(value: string): string {
  return value.replace(/[A-Za-z]/, (letter) => letter.toLowerCase());
}

function uppercaseFirstLetter(value: string): string {
  return value.replace(/[A-Za-z]/, (letter) => letter.toUpperCase());
}

function getRetranscriptionTarget(job: AnalysisJob): { label: string } {
  return shouldRetryWithWhisper(job) ? { label: "Whisper fallback" } : { label: "ElevenLabs Scribe" };
}

function shouldRetryWithWhisper(job: AnalysisJob): boolean {
  const error = job.error ?? "";
  if (job.status === "failed" && !job.passport && mentionsScribe(error) && !mentionsWhisper(error)) {
    return true;
  }
  if (job.status === "failed" && !job.passport && mentionsWhisper(error) && !mentionsScribe(error)) {
    return false;
  }

  const engine = job.passport?.clip.asrEngine ?? job.recovery?.asrEngine;
  const source = job.passport?.clip.asrSource ?? job.recovery?.asrSource;
  return isScribeEngine(engine) || Boolean(job.passport && source === "external" && !engine);
}

function isScribeEngine(engine?: string): boolean {
  return Boolean(engine && /^(elevenlabs\/|elevenlabs scribe$)/i.test(engine.trim()));
}

function mentionsScribe(value: string): boolean {
  return /elevenlabs|scribe/i.test(value);
}

function mentionsWhisper(value: string): boolean {
  return /whisper|replicate/i.test(value);
}

function getRuntimeStatus(mode: HealthResponse["runtimeMode"] | undefined) {
  if (mode === "live") return { label: "API mode", detail: "All partner credentials are present. Each analysis step reports whether its live request completed or fell back." };
  if (mode === "mixed") return { label: "Mixed sources", detail: "Configured partners are requested live; unavailable optional context is left empty or clearly labeled." };
  return { label: "Setup needed", detail: "Add partner keys for live processing, then upload, record, or recall real media to run analysis." };
}
