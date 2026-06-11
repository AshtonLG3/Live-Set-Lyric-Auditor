import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AudioLines,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  Fingerprint,
  Languages,
  Moon,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  WandSparkles
} from "lucide-react";
import { createNarration, getAnalysis, getHealth, searchEvents, searchTracks, startAnalysis } from "./api";
import type { AnalysisJob, AnalysisStep, EventCandidate, HealthResponse, NarrationResponse, TrackCandidate, VariantCandidate } from "../shared/types";
import { APP_NAME, APP_VERSION } from "../shared/version";
import { ClipIntake, type IntakeAnalysisInput } from "./components/ClipIntake";

const coverImage = "/cover.png";

type Theme = "light" | "dark";

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("lal-theme") as Theme) || "dark");
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

  const passport = job?.passport;
  const completeSteps = job?.progress.filter((step) => step.status === "complete").length ?? 0;
  const progressPercent = job ? Math.round((completeSteps / job.progress.length) * 100) : 0;

  const variantCounts = useMemo(() => {
    const counts = new Map<string, number>();
    passport?.variants.forEach((variant) => counts.set(variant.type, (counts.get(variant.type) ?? 0) + 1));
    return [...counts.entries()].slice(0, 4);
  }, [passport]);

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
    if (!job?.id || !passport) return;
    setError("");
    setNarration(await createNarration(job.id));
  }

  function handleRecallTrack(track: TrackCandidate) {
    setTrackQuery(`${track.title} ${track.artist}`);
    setTracks((current) => [track, ...current.filter((item) => item.id !== track.id)]);
    setSelectedTrack(track);
  }

  return (
    <div className="min-h-screen bg-paper text-slate-950 transition-colors dark:bg-ink dark:text-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white backdrop-blur dark:border-slate-800 dark:bg-ink">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-ember text-white shadow-panel">
              <AudioLines size={21} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold tracking-normal">{APP_NAME}</p>
              <p className="text-[13px] font-medium text-slate-600 dark:text-slate-400">v{APP_VERSION} · QA dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300 sm:inline-flex">
              {health?.runtimeMode ?? "fixture"} mode
            </span>
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? <Sun className="text-brass" size={18} /> : <Moon className="text-slate-700" size={18} />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        <section className="relative overflow-hidden rounded-md border border-slate-200 bg-white shadow-panel dark:border-slate-800 dark:bg-slate-950">
          <img
            src={coverImage}
            alt="Concert stage with crowd and lighting"
            className="h-48 w-full object-cover sm:h-56"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/86 via-black/54 to-black/12" />
          <div className="absolute inset-0 flex items-end">
            <div className="max-w-3xl px-5 pb-5 text-white sm:px-7">
              <p className="mb-2 inline-flex items-center gap-2 rounded-md bg-white/12 px-3 py-1 text-xs font-semibold backdrop-blur">
                <ShieldCheck size={14} /> Word-level, rights-aware Musixmatch Pro review
              </p>
              <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">Live Variant Passport</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-200">
                Upload a clip, range a live-performance link, or sing what you remember. Then compare canonical word timing to the vocal.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-3 md:grid-cols-5">
          {(health?.integrations ?? []).map((integration) => (
            <div
              key={integration.name}
              className="rounded-md border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[15px] font-bold">{integration.name}</p>
                {integration.configured ? (
                  <CheckCircle2 className="text-lagoon" size={18} />
                ) : (
                  <CircleAlert className="text-brass" size={18} />
                )}
              </div>
              <p className="mt-1 text-[12px] font-semibold uppercase text-slate-600 dark:text-slate-400">{integration.mode}</p>
            </div>
          ))}
        </section>

        <section className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[390px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            <Panel title="Clip Intake" icon={<AudioLines size={18} />}>
              <ClipIntake busy={busy} onAnalyze={(input) => handleAnalyze(input)} onTrackMatched={handleRecallTrack} />
              <button className="button-secondary mt-2 w-full" disabled={busy} onClick={() => void handleAnalyze(undefined, true)}>
                <WandSparkles size={17} /> Seed demo
              </button>
            </Panel>

            <Panel title="Track Anchor" icon={<Search size={18} />}>
              <div className="flex gap-2">
                <input
                  className="field"
                  value={trackQuery}
                  onChange={(event) => setTrackQuery(event.target.value)}
                  aria-label="Track search"
                />
                <button className="icon-button" onClick={() => void handleTrackSearch()} aria-label="Search tracks" title="Search tracks">
                  <Search size={18} />
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {tracks.map((track) => (
                  <button
                    key={track.id}
                    className={`select-row ${selectedTrack?.id === track.id ? "select-row-active" : ""}`}
                    onClick={() => setSelectedTrack(track)}
                  >
                    <span>
                      <span className="block text-[15px] font-bold">{track.title}</span>
                      <span className="text-[13px] text-slate-600 dark:text-slate-400">{track.artist} · {track.album ?? "Metadata pending"}</span>
                      <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
                        {track.hasRichSync ? "RichSync" : track.hasSubtitles ? "Line sync" : "Plain lyrics"}
                        {track.commonTrackId ? ` · common ${track.commonTrackId}` : ""}
                      </span>
                    </span>
                    <span className="text-[12px] font-semibold uppercase text-slate-600 dark:text-slate-400">{track.source}</span>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="Event Anchor" icon={<CalendarDays size={18} />}>
              <div className="grid grid-cols-2 gap-2">
                <input className="field" value={eventCity} onChange={(event) => setEventCity(event.target.value)} aria-label="Event city" />
                <input className="field" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} aria-label="Event date" />
              </div>
              <button className="button-secondary mt-2 w-full" onClick={() => void handleEventSearch()}>
                <CalendarDays size={17} /> Refresh events
              </button>
              <div className="mt-3 space-y-2">
                {events.map((event) => (
                  <button
                    key={event.id}
                    className={`select-row ${selectedEvent?.id === event.id ? "select-row-active" : ""}`}
                    onClick={() => setSelectedEvent(event)}
                  >
                    <span>
                      <span className="block text-[15px] font-bold">{event.title}</span>
                      <span className="text-[13px] text-slate-600 dark:text-slate-400">{event.venue} · {event.city}</span>
                    </span>
                    <span className="text-[12px] font-semibold uppercase text-slate-600 dark:text-slate-400">{event.source}</span>
                  </button>
                ))}
              </div>
            </Panel>
          </div>

          <div className="min-w-0 space-y-5">
            <Panel title="Analysis Timeline" icon={<Activity size={18} />}>
              <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div className="h-full rounded-full bg-lagoon transition-all" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                {(job?.progress ?? defaultSteps).map((step) => (
                  <div key={step.id} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                    <StatusIcon status={step.status} />
                    <p className="mt-2 text-[15px] font-bold leading-5">{step.label}</p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-600 dark:text-slate-400">{step.detail ?? step.status}</p>
                  </div>
                ))}
              </div>
              {error && <p className="mt-3 text-sm text-ember">{error}</p>}
            </Panel>

            {passport && (
              <Panel title="Musixmatch Pro Intelligence" icon={<Fingerprint size={18} />}>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Version confidence" value={`${Math.round(passport.recordingIdentity.versionConfidence * 100)}%`} />
                  <Metric label="Sync fit" value={`${Math.round(passport.recordingIdentity.syncFitScore * 100)}%`} />
                  <Metric label="Canonical source" value={passport.recordingIdentity.canonicalSource} />
                  <Metric label="Rights mode" value={passport.rights.status.replaceAll("_", " ")} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ReadinessFlag label="Lyrics" active={passport.track.hasLyrics} />
                  <ReadinessFlag label="Subtitles" active={passport.track.hasSubtitles} />
                  <ReadinessFlag label="Word sync" active={Boolean(passport.track.hasRichSync)} />
                  <ReadinessFlag label={passport.track.instrumental ? "Instrumental" : "Vocal track"} active={!passport.track.instrumental} />
                  <ReadinessFlag label={passport.track.explicit ? "Explicit" : "Clean"} active={!passport.track.explicit} />
                  {passport.track.language && <ReadinessFlag label={passport.track.language.toUpperCase()} active />}
                </div>
                <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 text-sm dark:border-slate-800 md:grid-cols-3">
                  <p><span className="block text-xs uppercase text-slate-500">Match method</span>{passport.recordingIdentity.matchMethod.replaceAll("_", " ")}</p>
                  <p><span className="block text-xs uppercase text-slate-500">Track identity</span>{passport.recordingIdentity.trackId}{passport.recordingIdentity.commonTrackId ? ` / ${passport.recordingIdentity.commonTrackId}` : ""}</p>
                  <p><span className="block text-xs uppercase text-slate-500">Attribution</span>{passport.rights.attribution}</p>
                </div>
              </Panel>
            )}

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
              <Panel title="Variant Candidates" icon={<ClipboardList size={18} />}>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-slate-200 text-[12px] font-bold uppercase text-slate-600 dark:border-slate-800 dark:text-slate-400">
                      <tr>
                        <th className="py-3 pr-4">Time</th>
                        <th className="py-3 pr-4">Type</th>
                        <th className="py-3 pr-4">Live text</th>
                        <th className="py-3 pr-4">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(passport?.variants ?? placeholderVariants).map((variant) => (
                        <VariantRow key={variant.id} variant={variant} muted={!passport} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="Passport Preview" icon={<BadgeCheck size={18} />}>
                {passport ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-[12px] font-bold uppercase text-slate-600 dark:text-slate-400">Track</p>
                      <h2 className="mt-1 text-xl font-semibold">{passport.track.title}</h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400">{passport.track.artist}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Metric label="Overall" value={`${Math.round(passport.confidenceOverview.overall * 100)}%`} />
                      <Metric label="ASR" value={`${Math.round(passport.confidenceOverview.asr * 100)}%`} />
                      <Metric label="Align" value={`${Math.round(passport.confidenceOverview.alignment * 100)}%`} />
                    </div>
                    <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
                      <p className="text-[12px] font-bold uppercase text-slate-600 dark:text-slate-400">Source</p>
                      <p className="mt-1 font-semibold">
                        {passport.clip.source.provider?.replaceAll("_", " ") ?? passport.clip.source.kind.replaceAll("_", " ")}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {passport.clip.source.processingMode.replaceAll("_", " ")}
                        {passport.clip.source.startSeconds !== undefined && passport.clip.source.endSeconds !== undefined
                          ? ` · ${passport.clip.source.startSeconds}s-${passport.clip.source.endSeconds}s`
                          : ""}
                      </p>
                      {passport.clip.source.url && (
                        <a className="mt-2 block truncate text-xs font-semibold text-lagoon hover:underline" href={passport.clip.source.url} target="_blank" rel="noreferrer">
                          {passport.clip.source.url}
                        </a>
                      )}
                    </div>
                    <p className="rounded-md bg-slate-50 p-3 text-sm leading-6 dark:bg-slate-900">{passport.summary}</p>
                    <div className="flex flex-wrap gap-2">
                      {variantCounts.map(([type, count]) => (
                        <span key={type} className="rounded-md bg-ember/10 px-2.5 py-1 text-xs font-semibold text-ember">
                          {type.replace("_", " ")} · {count}
                        </span>
                      ))}
                    </div>
                    <button className="button-secondary w-full" onClick={() => void handleNarration()}>
                      <Sparkles size={17} /> Generate narration
                    </button>
                    {narration && (
                      <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                        <p className="text-xs uppercase text-slate-500">{narration.mode}</p>
                        <p className="mt-1 text-sm leading-6">{narration.text}</p>
                        {narration.audioUrl && <audio className="mt-3 w-full" controls src={narration.audioUrl} />}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 text-sm text-slate-500 dark:text-slate-400">
                    <p>Seeded demo is ready with fixture track, event, ASR, and variant data.</p>
                    <div className="grid grid-cols-3 gap-2">
                      <Metric label="Clip" value="24s" />
                      <Metric label="Refs" value="6" />
                      <Metric label="APIs" value={health?.runtimeMode ?? "fixture"} />
                    </div>
                  </div>
                )}
              </Panel>
            </section>

            {passport && (
              <Panel title="Live Structure Map" icon={<Activity size={18} />}>
                <div className="grid gap-5 md:grid-cols-2">
                  <StructureLane label="Canonical" items={passport.structureMap.canonical} tone="canonical" />
                  <StructureLane label="Live performance" items={passport.structureMap.live} tone="live" />
                </div>
              </Panel>
            )}

            {passport && (
              <Panel title="Compliance Notes" icon={<ShieldCheck size={18} />}>
                <div className="grid gap-3 md:grid-cols-3">
                  {passport.complianceNotes.map((note) => (
                    <p key={note} className="rounded-md border border-slate-200 p-3 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:text-slate-300">
                      {note}
                    </p>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function Panel(props: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-md border border-slate-200 bg-white p-4 shadow-panel dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {props.icon}
        </span>
        <h2 className="text-lg font-bold leading-6 sm:text-xl">{props.title}</h2>
      </div>
      {props.children}
    </section>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "complete") return <CheckCircle2 className="text-lagoon" size={19} />;
  if (status === "failed") return <CircleAlert className="text-ember" size={19} />;
  if (status === "running") return <Activity className="animate-pulse text-brass" size={19} />;
  return <span className="block h-4 w-4 rounded-full border border-slate-300 dark:border-slate-700" />;
}

function VariantRow({ variant, muted }: { variant: VariantCandidate; muted?: boolean }) {
  return (
    <tr className={`border-b border-slate-100 dark:border-slate-900 ${muted ? "opacity-55" : ""}`}>
      <td className="py-3 pr-4 font-mono text-xs">{formatTime(variant.start)}-{formatTime(variant.end)}</td>
      <td className="py-3 pr-4">
        <span className="rounded-md bg-lagoon/10 px-2 py-1 text-xs font-semibold text-lagoon">
          {variant.type.replace("_", " ")}
        </span>
      </td>
      <td className="max-w-sm py-3 pr-4 text-slate-700 dark:text-slate-300">
        <span className="block">{variant.liveText}</span>
        <span className="mt-1 block text-[13px] leading-5 text-slate-600 dark:text-slate-400">{variant.recommendedAction}</span>
        <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase text-violetmark"><Languages size={12} /> {variant.translationRisk} translation risk</span>
      </td>
      <td className="py-3 pr-4 font-semibold">{Math.round(variant.confidence * 100)}%</td>
    </tr>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-[12px] font-semibold uppercase text-slate-600 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function ReadinessFlag({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${active ? "bg-lagoon/10 text-lagoon" : "bg-slate-100 text-slate-500 dark:bg-slate-900"}`}>
      {active ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />} {label}
    </span>
  );
}

function StructureLane({ label, items, tone }: { label: string; items: string[]; tone: "canonical" | "live" }) {
  return (
    <div>
      <p className="mb-2 text-[12px] font-bold uppercase text-slate-600 dark:text-slate-400">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => (
          <div key={`${item}-${index}`} className="flex items-center gap-2">
            <span className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${tone === "live" ? "bg-ember/10 text-ember" : "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
              {item}
            </span>
            {index < items.length - 1 && <span className="text-slate-300 dark:text-slate-700">→</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(value: number): string {
  return `${value.toFixed(1)}s`;
}

const defaultSteps: AnalysisStep[] = [
  { id: "ingest", label: "Validate source and clip", status: "queued" as const },
  { id: "isolate", label: "Isolate live vocal", status: "queued" as const },
  { id: "transcribe", label: "Transcribe vocal", status: "queued" as const },
  { id: "anchor", label: "Match recording and version", status: "queued" as const },
  { id: "compare", label: "Compare word timing and structure", status: "queued" as const },
  { id: "passport", label: "Generate Live Variant Passport", status: "queued" as const }
];

const placeholderVariants: VariantCandidate[] = [
  {
    id: "P1",
    type: "city_shoutout",
    start: 4.2,
    end: 8.5,
    liveText: "Cape Town carry this chorus through the avenue",
    canonicalAlignmentReference: "L2",
    confidence: 0.84,
    impactNote: "Fixture preview",
    recommendedAction: "Attach event-specific metadata; no canonical lyric edit required.",
    translationRisk: "medium",
    severity: "high"
  },
  {
    id: "P2",
    type: "repeated_hook",
    start: 12.8,
    end: 17.4,
    liveText: "Sing it once more sing it once more until the morning arrives",
    canonicalAlignmentReference: "L4",
    confidence: 0.78,
    impactNote: "Fixture preview",
    recommendedAction: "Extend live subtitle timing; canonical lyric can remain unchanged.",
    translationRisk: "low",
    severity: "medium"
  },
  {
    id: "P3",
    type: "skipped_line",
    start: 16,
    end: 20,
    liveText: "[not detected in live vocal]",
    canonicalAlignmentReference: "L5",
    confidence: 0.58,
    impactNote: "Fixture preview",
    recommendedAction: "Confirm omission and update live-caption coverage.",
    translationRisk: "high",
    severity: "medium"
  }
];
