import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  CalendarDays,
  Download,
  FileText,
  LayoutDashboard,
  Moon,
  Plus,
  Search,
  Sun,
} from "lucide-react";
import { createNarration, getAnalysis, getHealth, reanchorAnalysis, searchEvents, searchTracks, startAnalysis, subscribeToJob } from "./api";
import type { AnalysisJob, EventCandidate, HealthResponse, NarrationResponse, TrackCandidate, VariantCandidate } from "../shared/types";
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
  const runtimeStatus = getRuntimeStatus(health?.runtimeMode);

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
    if (!selectedTrack) return;
    void searchEvents({ artist: selectedTrack.artist, city: eventCity, date: eventDate })
      .then((items) => {
        setEvents(items);
        setSelectedEvent(items[0] ?? null);
      })
      .catch(() => {
        setEvents([]);
        setSelectedEvent(null);
      });
  }, [selectedTrack, eventCity, eventDate]);

  const handleJobUpdate = useCallback((updated: AnalysisJob) => {
    setJob(updated);
    if (updated.status === "complete" || updated.status === "failed") {
      setBusy(false);
      if (updated.status === "failed") {
        setError(updated.error ?? "Analysis stopped before completion.");
      }
    }
  }, []);

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
    const items = await searchEvents({ artist: selectedTrack.artist, city: eventCity, date: eventDate });
    setEvents(items);
    setSelectedEvent(items[0] ?? null);
  }

  async function handleAnalyze(input?: IntakeAnalysisInput, useFixture = false) {
    setBusy(true);
    setError("");
    setNarration(null);
    setReviewDecisions({});
    setManualVariants([]);
    setWorkspace("studio");
    setActiveSection("analysis-timeline");
    try {
      const { jobId } = await startAnalysis({
        file: useFixture ? undefined : input?.file,
        durationSeconds: useFixture ? undefined : input?.durationSeconds,
        autoMatch: useFixture ? true : input?.autoMatch,
        useFixture,
        source: useFixture ? { kind: "fixture", processingMode: "fixture" } : input?.source,
        recallSegments: input?.recallSegments,
        track: input?.autoMatch === false ? selectedTrack : undefined,
        event: input?.autoMatch === false ? selectedEvent ?? null : null,
        trackQuery,
        eventCity,
        eventDate
      });
      setJob(await getAnalysis(jobId));
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
      setSelectedTrack(track);
    } catch (correctionError) {
      setError(correctionError instanceof Error ? correctionError.message : "Could not correct the track anchor.");
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
        decisions: review
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
              onCorrectTrack={handleCorrectTrack}
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

function TopNavButton({ label, active, disabled, onClick }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={active ? "active" : ""} disabled={disabled} onClick={onClick}>{label}</button>;
}

function SideNavButton({ label, icon, active, disabled, onClick }: { label: string; icon: React.ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={active ? "active" : ""} aria-current={active ? "location" : undefined} disabled={disabled} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function getRuntimeStatus(mode: HealthResponse["runtimeMode"] | undefined) {
  if (mode === "live") return { label: "API mode", detail: "All partner credentials are present. Each analysis step reports whether its live request completed or fell back." };
  if (mode === "mixed") return { label: "Mixed sources", detail: "Configured partners are requested live; unavailable optional context is left empty or clearly labeled." };
  return { label: "Setup needed", detail: "Add partner keys for live processing. A tucked-away judge demo remains available under Judge / Deploy tools." };
}
