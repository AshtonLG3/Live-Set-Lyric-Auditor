import {
  AudioLines,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Search,
  ShieldCheck,
  WandSparkles
} from "lucide-react";
import type { EventCandidate, HealthResponse, TrackCandidate } from "../../shared/types";
import { ClipIntake, type IntakeAnalysisInput } from "./ClipIntake";

type Props = {
  health: HealthResponse | null;
  tracks: TrackCandidate[];
  selectedTrack?: TrackCandidate;
  trackQuery: string;
  events: EventCandidate[];
  selectedEvent?: EventCandidate | null;
  eventCity: string;
  eventDate: string;
  busy: boolean;
  error: string;
  onAnalyze: (input?: IntakeAnalysisInput, useFixture?: boolean) => Promise<void> | void;
  onTrackMatched: (track: TrackCandidate) => void;
  onTrackQueryChange: (value: string) => void;
  onTrackSearch: () => Promise<void> | void;
  onTrackSelect: (track: TrackCandidate) => void;
  onEventCityChange: (value: string) => void;
  onEventDateChange: (value: string) => void;
  onEventSearch: () => Promise<void> | void;
  onEventSelect: (event: EventCandidate) => void;
};

const coverImage = "/cover.png";

export function SessionWorkspace(props: Props) {
  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
      <section className="relative overflow-hidden rounded-md border border-slate-200 bg-white shadow-panel dark:border-slate-800 dark:bg-slate-950">
        <img src={coverImage} alt="Concert stage with crowd and lighting" className="h-48 w-full object-cover sm:h-56" />
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0 flex items-end">
          <div className="max-w-3xl px-5 pb-5 text-white sm:px-7">
            <p className="mb-2 inline-flex items-center gap-2 rounded-md bg-black/35 px-3 py-1 text-xs font-semibold backdrop-blur">
              <ShieldCheck size={14} /> Musixmatch Pro identity, timing, and rights review
            </p>
            <h1 className="text-3xl font-bold sm:text-4xl">Start a Live Variant Passport</h1>
            <p className="mt-2 max-w-2xl text-base leading-6 text-slate-100">
              Upload a clip, range a live-performance link, or sing the lyric fragment you remember.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {(props.health?.integrations ?? []).map((integration) => (
          <div key={integration.name} className="rounded-md border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[15px] font-bold">{integration.name}</p>
              {integration.configured ? <CheckCircle2 className="text-lagoon" size={18} /> : <CircleAlert className="text-brass" size={18} />}
            </div>
            <p className="mt-1 text-[12px] font-semibold uppercase text-slate-600 dark:text-slate-400">{integration.mode}</p>
          </div>
        ))}
      </section>

      <section className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
        <Panel title="Clip Intake" icon={<AudioLines size={18} />}>
          <ClipIntake busy={props.busy} onAnalyze={(input) => props.onAnalyze(input)} onTrackMatched={props.onTrackMatched} />
          <button className="button-secondary mt-2 w-full" disabled={props.busy} onClick={() => void props.onAnalyze(undefined, true)}>
            <WandSparkles size={17} /> Seed demo
          </button>
          {props.error && <p className="mt-3 rounded-md bg-ember/10 px-3 py-2 text-sm font-semibold text-ember">{props.error}</p>}
        </Panel>

        <div className="min-w-0 space-y-5">
          <Panel title="Track Anchor" icon={<Search size={18} />}>
            <div className="flex gap-2">
              <input className="field w-full" value={props.trackQuery} onChange={(event) => props.onTrackQueryChange(event.target.value)} aria-label="Track search" />
              <button className="icon-button" onClick={() => void props.onTrackSearch()} aria-label="Search tracks" title="Search tracks">
                <Search size={18} />
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {props.tracks.map((track) => (
                <button key={track.id} className={`select-row ${props.selectedTrack?.id === track.id ? "select-row-active" : ""}`} onClick={() => props.onTrackSelect(track)}>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-bold">{track.title}</span>
                    <span className="block truncate text-[13px] text-slate-600 dark:text-slate-400">{track.artist} · {track.album ?? "Metadata pending"}</span>
                    <span className="mt-1 block text-[12px] text-slate-500 dark:text-slate-400">
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
              <input className="field w-full" value={props.eventCity} onChange={(event) => props.onEventCityChange(event.target.value)} aria-label="Event city" />
              <input className="field w-full" type="date" value={props.eventDate} onChange={(event) => props.onEventDateChange(event.target.value)} aria-label="Event date" />
            </div>
            <button className="button-secondary mt-2 w-full" onClick={() => void props.onEventSearch()}>
              <CalendarDays size={17} /> Refresh events
            </button>
            <div className="mt-3 space-y-2">
              {props.events.map((event) => (
                <button key={event.id} className={`select-row ${props.selectedEvent?.id === event.id ? "select-row-active" : ""}`} onClick={() => props.onEventSelect(event)}>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-bold">{event.title}</span>
                    <span className="block truncate text-[13px] text-slate-600 dark:text-slate-400">{event.venue} · {event.city}</span>
                  </span>
                  <span className="text-[12px] font-semibold uppercase text-slate-600 dark:text-slate-400">{event.source}</span>
                </button>
              ))}
            </div>
          </Panel>
        </div>
      </section>
    </main>
  );
}

function Panel(props: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-md border border-slate-200 bg-white p-4 shadow-panel dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200">{props.icon}</span>
        <h2 className="text-lg font-bold leading-6 sm:text-xl">{props.title}</h2>
      </div>
      {props.children}
    </section>
  );
}
