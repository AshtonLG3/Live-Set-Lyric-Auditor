import { useEffect, useState } from "react";
import { Activity, AudioLines, Moon, Plus, Sun } from "lucide-react";
import { createNarration, getAnalysis, getHealth, searchEvents, searchTracks, startAnalysis } from "./api";
import type { AnalysisJob, EventCandidate, HealthResponse, NarrationResponse, TrackCandidate } from "../shared/types";
import { APP_NAME, APP_VERSION } from "../shared/version";
import { AnalysisStudio, type ReviewDecisions } from "./components/AnalysisStudio";
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

  function exportPassport(decisions: ReviewDecisions = {}) {
    if (!job?.passport) return;
    const reviewDecisions = job.passport.variants.map((variant) => ({
      variantId: variant.id,
      decision: decisions[variant.id] ?? "pending"
    }));
    const reviewedPassport = {
      ...job.passport,
      review: {
        exportedAt: new Date().toISOString(),
        status: reviewDecisions.every((item) => item.decision !== "pending") ? "complete" : "in_progress",
        decisions: reviewDecisions
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
    <div className="min-h-screen bg-paper font-sans text-slate-950 transition-colors dark:bg-ink dark:text-slate-50">
      <header className="app-topbar">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-ember text-white"><AudioLines size={21} /></div>
          <div className="min-w-0">
            <p className="truncate text-base font-bold">{APP_NAME}</p>
            <p className="text-[13px] font-medium text-slate-600 dark:text-slate-400">v{APP_VERSION} · {workspace === "studio" ? "Analysis Studio" : "New Session"}</p>
          </div>
        </div>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary workspace navigation">
          <button type="button" className={`app-nav-button ${workspace === "session" ? "app-nav-button-active" : ""}`} onClick={() => setWorkspace("session")}><Plus size={16} /> New Session</button>
          <button type="button" className={`app-nav-button ${workspace === "studio" ? "app-nav-button-active" : ""}`} onClick={() => setWorkspace("studio")}><Activity size={16} /> Analysis Studio</button>
        </nav>

        <div className="flex items-center gap-2">
          <span className="app-runtime-status hidden lg:inline-flex" title={runtimeStatus.detail} aria-label={`Runtime status: ${runtimeStatus.label}. ${runtimeStatus.detail}`}>
            <span className={`app-runtime-dot app-runtime-dot-${health?.runtimeMode ?? "fixture"}`} />
            {runtimeStatus.label}
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <Sun className="text-brass" size={18} /> : <Moon className="text-slate-700" size={18} />}
          </button>
        </div>
      </header>

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
          onNarrate={handleNarration}
          onExport={exportPassport}
          onNewSession={() => setWorkspace("session")}
        />
      )}
    </div>
  );
}

function getRuntimeStatus(mode: HealthResponse["runtimeMode"] | undefined) {
  if (mode === "live") return { label: "Live APIs", detail: "All configured integrations are using live API responses." };
  if (mode === "mixed") return { label: "Mixed sources", detail: "Available APIs are live; unavailable integrations use reliable demo data." };
  return { label: "Demo data", detail: "External API keys are unavailable, so seeded contest data keeps the full demo working." };
}
