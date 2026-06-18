import {
  AudioLines,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  WandSparkles
} from "lucide-react";
import type { EventCandidate, HealthResponse, IntegrationName, TrackCandidate } from "../../shared/types";
import { formatEventDate } from "../../shared/format";
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

const coverImage = "/hero-concert-v2.png";

export function SessionWorkspace(props: Props) {
  return (
    <main id="dashboard-overview" className="studio-session">
      <section className="studio-session-hero">
        <img src={coverImage} alt="Concert stage with audience lighting" />
        <div className="studio-session-hero-shade" />
        <div className="studio-session-hero-content">
          <p className="studio-kicker"><span /> Live Variant Passport</p>
          <h1>Start a Live Variant Passport</h1>
          <p>Upload a clip, paste a live-performance link, or recall a lyric fragment.</p>
          <div className="studio-session-hero-meta">
            <span><ShieldCheck size={15} /> Musixmatch identity and rights</span>
            <span><Radio size={15} /> Live-performance evidence</span>
          </div>
        </div>
      </section>

      <section className="studio-partner-strip" aria-label="Integration readiness">
        {(props.health?.integrations ?? []).map((integration) => {
          const status = getPartnerStatus(integration.name, props.busy, Boolean(props.selectedTrack), Boolean(props.selectedEvent));
          return (
            <article key={integration.name} title={integration.detail}>
              <div><span className={`studio-partner-dot ${integration.configured ? "live" : "demo"}`} /><strong>{integration.name}</strong></div>
              <p>{status}</p>
            </article>
          );
        })}
      </section>

      <section className="studio-intake-grid">
        <RackPanel id="clip-intake" title="Clip Intake" icon={<AudioLines size={18} />} status={props.busy ? "Processing" : "Ready"}>
          <div className="studio-clip-intake">
            <ClipIntake
              busy={props.busy}
              youtubeExtractionEnabled={Boolean(props.health?.capabilities?.youtubeExtraction.enabled)}
              onAnalyze={(input) => props.onAnalyze(input)}
              onTrackMatched={props.onTrackMatched}
            />
          </div>
          <button className="studio-demo-button" disabled={props.busy} onClick={() => void props.onAnalyze(undefined, true)} title="Run the complete contest flow with seeded demo data">
            <WandSparkles size={17} /> Run judge-ready demo
          </button>
          {props.error && <p className="studio-inline-error"><CircleAlert size={15} /> {props.error}</p>}
        </RackPanel>

        <div id="anchors" className="studio-anchor-stack">
          <RackPanel id="track-anchor" title="Track Anchor" icon={<Search size={18} />} status={props.selectedTrack ? "Anchored" : "Search"}>
            <p className="studio-panel-intro">Selected Musixmatch track, artist, and recording version.</p>
            <div className="studio-search-row">
              <input className="field" value={props.trackQuery} onChange={(event) => props.onTrackQueryChange(event.target.value)} aria-label="Track search" />
              <button className="studio-square-button" onClick={() => void props.onTrackSearch()} aria-label="Search tracks" title="Search Musixmatch tracks"><Search size={18} /></button>
            </div>
            <div className="studio-choice-list">
              {props.tracks.map((track) => (
                <button key={track.id} className={`studio-choice-row ${props.selectedTrack?.id === track.id ? "active" : ""}`} onClick={() => props.onTrackSelect(track)}>
                  <span className="studio-choice-indicator">{props.selectedTrack?.id === track.id ? <CheckCircle2 size={16} /> : null}</span>
                  <span className="min-w-0">
                    <strong>{track.title}</strong>
                    <small>{track.artist} · {track.album ?? "Version pending"}</small>
                    <em>{track.hasRichSync ? "Word-synced lyrics" : track.hasSubtitles ? "Line-synced lyrics" : "Lyrics available"}</em>
                  </span>
                </button>
              ))}
            </div>
          </RackPanel>

          <RackPanel id="event-anchor" title="Event Anchor" icon={<CalendarDays size={18} />} status={props.selectedEvent ? "Event Found" : "Optional"}>
            <p className="studio-panel-intro">City, date, venue, and JamBase concert evidence.</p>
            <div className="studio-event-fields">
              <input className="field" value={props.eventCity} onChange={(event) => props.onEventCityChange(event.target.value)} aria-label="Event city" />
              <input className="field" type="date" value={props.eventDate} onChange={(event) => props.onEventDateChange(event.target.value)} aria-label="Event date" />
            </div>
            <button className="studio-ghost-button" onClick={() => void props.onEventSearch()}><CalendarDays size={16} /> Find JamBase event</button>
            <div className="studio-choice-list">
              {props.events.map((event) => (
                <button key={event.id} className={`studio-choice-row ${props.selectedEvent?.id === event.id ? "active" : ""}`} onClick={() => props.onEventSelect(event)}>
                  <span className="studio-choice-indicator">{props.selectedEvent?.id === event.id ? <CheckCircle2 size={16} /> : null}</span>
                  <span className="min-w-0">
                    <strong>{event.title}</strong>
                    <small>{event.venue} · {event.city}</small>
                    <em>{formatEventDate(event.date)}</em>
                  </span>
                </button>
              ))}
            </div>
          </RackPanel>
        </div>
      </section>

      <section className="studio-ready-band">
        <div><Sparkles size={19} /><span><strong>Ready to compare the live vocal</strong><small>The clip will be matched to the selected song and event before variant detection.</small></span></div>
        <span className="studio-ready-signal"><i /> Intake configured</span>
      </section>
    </main>
  );
}

function RackPanel({ id, title, icon, status, children }: { id: string; title: string; icon: React.ReactNode; status: string; children: React.ReactNode }) {
  return (
    <section id={id} className="studio-rack-panel">
      <header><span>{icon}{title}</span><small><i /> {status}</small></header>
      <div className="studio-rack-body">{children}</div>
    </section>
  );
}

function getPartnerStatus(name: IntegrationName, busy: boolean, hasTrack: boolean, hasEvent: boolean) {
  if (name === "Musixmatch") return hasTrack ? "Track Ready" : "Catalog Ready";
  if (name === "JamBase") return hasEvent ? "Event Found" : "Search Ready";
  if (name === "ASR") return busy ? "Processing" : "Transcript Ready";
  if (name === "LALAL.AI") return busy ? "Isolating Vocal" : "Vocal Ready";
  if (name === "Cyanite") return busy ? "Profiling Live Energy" : "Context Ready";
  return "Narration Ready";
}
