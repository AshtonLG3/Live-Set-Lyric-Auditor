import type { EventCandidate, LiveContext, TrackCandidate } from "../../shared/types";
import { env } from "../config";
import { fixtureEvents } from "../data/fixtures";

type JamBaseEntity = {
  id?: string | number;
  identifier?: string | number;
  name?: string;
  title?: string;
};

type JamBaseEvent = {
  id?: string | number;
  identifier?: string | number;
  name?: string;
  title?: string;
  startDate?: string;
  url?: string;
  tour?: JamBaseEntity | string;
  festival?: JamBaseEntity | string;
  location?: {
    id?: string | number;
    identifier?: string | number;
    name?: string;
    address?: { addressLocality?: string };
  };
  venue?: JamBaseEntity & { city?: string };
  performer?: JamBaseEntity | JamBaseEntity[];
  performers?: JamBaseEntity[];
  lineup?: JamBaseEntity[];
  setlist?: unknown;
};

export async function searchEvents(input: {
  artist?: string;
  city?: string;
  date?: string;
}): Promise<EventCandidate[]> {
  if (!env.jambaseKey) {
    return [];
  }

  const params = new URLSearchParams();
  if (input.artist) params.set("artistName", input.artist);
  if (input.city) params.set("city", input.city);
  if (input.date) {
    params.set("dateFrom", input.date.slice(0, 10));
    params.set("dateTo", input.date.slice(0, 10));
  }

  try {
    const response = await fetch(`${env.jambaseBaseUrl}/events?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${env.jambaseKey}`,
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`JamBase search failed with ${response.status}`);
    }
    const json = await response.json() as { events?: JamBaseEvent[]; results?: JamBaseEvent[] };
    const events = json.events ?? json.results ?? [];
    const mapped = events.slice(0, 6).map((event, index) => mapEvent(event, input, index));
    return mapped;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown JamBase error";
    console.warn(`JamBase search unavailable; falling back to fixture events. ${detail}`);
    return filterFixtureEvents(input);
  }
}

export function buildLiveContext(event: EventCandidate | null, track: TrackCandidate): LiveContext | null {
  if (!event) return null;

  const songs = event.setlist?.songs ?? [];
  const position = songs.findIndex((song) => normalize(song) === normalize(track.title));
  const setlistPosition = position >= 0 ? position + 1 : undefined;
  const tourOrFestival = event.tourName ?? event.festivalName;
  const setlistSummary = setlistPosition
    ? `${track.title} appears at position ${setlistPosition} of ${songs.length} in the available setlist.`
    : event.setlist?.available
      ? "A JamBase setlist is available, but this track was not matched to a stable position."
      : "No setlist was available for this event; venue and lineup evidence remain attached.";
  const contextSummary = tourOrFestival ? `${tourOrFestival}. ${setlistSummary}` : setlistSummary;
  const evidenceSignals = [event.id, event.artistId, event.venueId, event.venue, event.date, event.url, setlistPosition].filter(Boolean).length;

  return {
    source: event.source,
    eventId: event.id,
    artistId: event.artistId,
    venueId: event.venueId,
    tourName: event.tourName,
    festivalName: event.festivalName,
    lineup: event.lineup ?? [event.artist],
    setlist: {
      available: Boolean(event.setlist?.available),
      position: setlistPosition,
      songCount: songs.length || undefined,
      previousSong: position > 0 ? songs[position - 1] : undefined,
      nextSong: position >= 0 && position < songs.length - 1 ? songs[position + 1] : undefined,
      sourceUrl: event.setlist?.sourceUrl ?? event.url
    },
    summary: contextSummary,
    confidence: round(Math.min(0.98, 0.48 + evidenceSignals * 0.07))
  };
}

function mapEvent(event: JamBaseEvent, input: { artist?: string; city?: string; date?: string }, index: number): EventCandidate {
  const performers = asEntities(event.performers ?? event.performer);
  const lineup = asEntities(event.lineup).length ? asEntities(event.lineup) : performers;
  const artistEntity = performers[0];
  const artist = entityName(artistEntity) ?? input.artist ?? "Unknown artist";
  const venue = entityName(event.venue) ?? event.location?.name ?? "Unknown venue";
  const city = event.venue?.city ?? event.location?.address?.addressLocality ?? input.city ?? "Unknown city";
  const setlist = mapSetlist(event.setlist, event.url);

  return {
    id: entityId(event) ?? `jambase-${index}`,
    title: event.name ?? event.title ?? `${artist} at ${venue}`,
    artist,
    artistId: entityId(artistEntity),
    venue,
    venueId: entityId(event.venue) ?? entityId(event.location),
    city,
    date: event.startDate ?? input.date ?? new Date().toISOString(),
    tourName: entityName(event.tour),
    festivalName: entityName(event.festival),
    lineup: lineup.map(entityName).filter((name): name is string => Boolean(name)),
    setlist,
    url: event.url,
    source: "jambase"
  };
}

function mapSetlist(value: unknown, sourceUrl?: string): EventCandidate["setlist"] {
  if (!value) return { available: false };
  const songs = extractSongs(value);
  return {
    available: true,
    songs: songs.length ? songs : undefined,
    sourceUrl
  };
}

function extractSongs(value: unknown): string[] {
  const collection = Array.isArray(value)
    ? value
    : isRecord(value)
      ? value.songs ?? value.tracks ?? value.items ?? value.setlistItems
      : undefined;
  if (!Array.isArray(collection)) return [];
  return collection
    .map((item) => typeof item === "string" ? item : isRecord(item) ? String(item.name ?? item.title ?? "") : "")
    .map((item) => item.trim())
    .filter(Boolean);
}

function asEntities(value: JamBaseEvent["performer"] | JamBaseEvent["lineup"]): JamBaseEntity[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function entityId(value: JamBaseEntity | JamBaseEvent["location"] | JamBaseEvent | undefined): string | undefined {
  const id = value?.identifier ?? value?.id;
  return id === undefined || id === null ? undefined : String(id);
}

function entityName(value: JamBaseEntity | string | undefined): string | undefined {
  if (typeof value === "string") return value;
  return value?.name ?? value?.title;
}

function filterFixtureEvents(input: { artist?: string; city?: string }): EventCandidate[] {
  const artist = input.artist?.toLowerCase();
  const city = input.city?.toLowerCase();
  return fixtureEvents.filter((event) => {
    const artistMatch = !artist || event.artist.toLowerCase().includes(artist);
    const cityMatch = !city || event.city.toLowerCase().includes(city);
    return artistMatch && cityMatch;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
