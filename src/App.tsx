import { useEffect, useState } from "react";
import {
  Activity,
  AudioLines,
  CalendarDays,
  CircleHelp,
  Download,
  FileText,
  LayoutDashboard,
  ListMusic,
  MessageSquareDiff,
  Moon,
  Plus,
  Settings,
  Sun,
  Upload
} from "lucide-react";
import { createNarration, getAnalysis, getHealth, searchEvents, searchTracks, startAnalysis } from "./api";
import type { AnalysisJob, EventCandidate, HealthResponse, NarrationResponse, TrackCandidate } from "../shared/types";
import { APP_NAME, APP_VERSION } from "../shared/version";
import { AnalysisStudio, type ReviewDecision, type ReviewDecisions } from "./components/AnalysisStudio";
import { SessionWorkspace } from "./components/SessionWorkspace";
import type { IntakeAnalysisInput } from "./components/ClipIntake";

type Theme = "light" | "dark";
type Workspace = "session" | "studio";

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("lal-theme") as Theme) || "dark");
  const [workspace, setWorkspace] = useState<Workspace>("session");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [trackQuery, setTrackQuery] = useState("Midnight Atlas");
  const [tracks, setTracks] = useState<TrackCandidate[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<TrackCandidate | undefined>();
  const [eventCity, setEventCity] = useState("Cape Town");
  const [eventDate, setEventDate] = useState("2026-06-18");
  const [events, setEvents] = useState<EventCandidate[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventCandidate | null | undefined>();
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [narration, setNarration] = useState<NarrationResponse | null>(null);
  const [reviewDecisions, setReviewDecisions] = useState<ReviewDecisions>({});
  const runtimeStatus = getRuntimeStatus(health?.runtimeMode);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("lal-theme", theme);
  }, [theme]);

  useEffect(() => {
    void getHealth().then(setHealth).catch(() => setHealth(null));
    void searchTracks(trackQuery).then((items) => {
      setTracks(items);
      setSelectedTrack(items[0]);
    });
  }, []);

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

  useEffect(() => {
    if (!job || job.status === "complete" || job.status === "failed") return;
    const interval = window.setInterval(async () => {
      const updated = await getAnalysis(job.id);
      setJob(updated);
      if (updated.status === "complete" || updated.status === "failed") {
        setBusy(false);
        window.clearInterval(interval);
      }
    }, 650);
    return () => window.clearInterval(interval);
  }, [job]);

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
    setWorkspace("studio");
    try {
      const { jobId } = await startAnalysis({
        file: useFixture ? undefined : input?.file,
        durationSeconds: useFixture ? undefined : input?.durationSeconds,
        autoMatch: useFixture ? true : input?.autoMatch,
        useFixture,
        source: useFixture ? { kind: "fixture", processingMode: "fixture" } : input?.source,
        track: input?.autoMatch === false ? selectedTrack : undefined,
        event: selectedEvent ?? null,
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
    setNarration(await createNarration(job.id));
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

  function startNewSession() {
    setWorkspace("session");
    setJob(null);
    setNarration(null);
    setReviewDecisions({});
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function navigate(workspaceTarget: Workspace, anchor?: string) {
    if (workspaceTarget === "studio" && !job) return;
    setWorkspace(workspaceTarget);
    if (anchor) window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    else window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function exportPassport() {
    if (!job?.passport) return;
    const review = job.passport.variants.map((variant) => ({
      variantId: variant.id,
      decision: reviewDecisions[variant.id] ?? "pending"
    }));
    const reviewedPassport = {
      ...job.passport,
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
          <TopNavButton label="Tracks" onClick={() => navigate("session", "track-anchor")} />
          <TopNavButton label="Reports" disabled={!job} onClick={() => navigate("studio", "studio-passport")} />
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
          <nav aria-label="Studio modules">
            <SideNavButton label="Overview" icon={<LayoutDashboard size={19} />} active={workspace === "session"} onClick={() => navigate("session")} />
            <SideNavButton label="Timeline" icon={<Activity size={19} />} active={workspace === "studio"} disabled={!job} onClick={() => navigate("studio", "analysis-timeline")} />
            <SideNavButton label="Variants" icon={<MessageSquareDiff size={19} />} disabled={!job} onClick={() => navigate("studio", "variant-candidates")} />
            <SideNavButton label="Event Anchor" icon={<CalendarDays size={19} />} onClick={() => navigate("session", "event-anchor")} />
            <SideNavButton label="Export" icon={<Upload size={19} />} disabled={!job?.passport} onClick={exportPassport} />
          </nav>
          <div className="studio-sidebar-footer">
            <button type="button" className="studio-sidebar-new" onClick={startNewSession}><Plus size={17} /> New Session</button>
            <span><CircleHelp size={16} /> Help</span>
            <span><Settings size={16} /> Settings</span>
          </div>
        </aside>

        <div className="studio-app-content">
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
              onDecision={decideVariant}
              onNarrate={handleNarration}
            />
          )}
        </div>
      </div>

      <nav className="studio-global-mobile-nav lg:hidden" aria-label="Mobile navigation">
        <button type="button" className={workspace === "session" ? "active" : ""} onClick={() => navigate("session")}><LayoutDashboard size={19} /><span>Dashboard</span></button>
        <button type="button" className={workspace === "studio" ? "active" : ""} disabled={!job} onClick={() => navigate("studio")}><Activity size={19} /><span>Analysis</span></button>
        <button type="button" onClick={() => navigate("session", "track-anchor")}><ListMusic size={19} /><span>Tracks</span></button>
        <button type="button" disabled={!job} onClick={() => navigate("studio", "studio-passport")}><FileText size={19} /><span>Reports</span></button>
      </nav>
    </div>
  );
}

function TopNavButton({ label, active, disabled, onClick }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={active ? "active" : ""} disabled={disabled} onClick={onClick}>{label}</button>;
}

function SideNavButton({ label, icon, active, disabled, onClick }: { label: string; icon: React.ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={active ? "active" : ""} disabled={disabled} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function getRuntimeStatus(mode: HealthResponse["runtimeMode"] | undefined) {
  if (mode === "live") return { label: "Live APIs", detail: "All configured integrations are using live API responses." };
  if (mode === "mixed") return { label: "Mixed sources", detail: "Available APIs are live; unavailable integrations use reliable demo data." };
  return { label: "Demo data", detail: "External API keys are unavailable, so seeded contest data keeps the full demo working." };
}
