import type { EventCandidate, LiveContext, TrackCandidate } from "../../shared/types";
import { env } from "../config";

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

type JamBaseEventsResponse = {
  events?: JamBaseEvent[];
  results?: JamBaseEvent[];
  pagination?: {
    nextPage?: string | null;
  };
};

const MAX_HINTED_EVENT_PAGES = 3;

export async function searchEvents(input: {
  artist?: string;
  city?: string;
  date?: string;
}): Promise<EventCandidate[]> {
  if (!env.jambaseKey) {
    return [];
  }

  const params = new URLSearchParams();
  if (!input.artist?.trim()) {
    return [];
  }
  params.set("artistName", input.artist);

  try {
    const events = await fetchEventPages(`${env.jambaseBaseUrl}/events?${params.toString()}`, hasEventHint(input));
    const mapped = events.map((event, index) => mapEvent(event, input, index));
    return filterByEventHints(mapped, input)
      .sort((a, b) => artistMatchRank(a, input.artist) - artistMatchRank(b, input.artist))
      .slice(0, 6);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown JamBase error";
    console.warn(`JamBase search unavailable. ${detail}`);
    return [];
  }
}

async function fetchEventPages(firstUrl: string, followPages: boolean): Promise<JamBaseEvent[]> {
  const events: JamBaseEvent[] = [];
  let nextUrl: string | null | undefined = firstUrl;
  let page = 0;

  while (nextUrl && page < (followPages ? MAX_HINTED_EVENT_PAGES : 1)) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${env.jambaseKey}`,
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`JamBase search failed with ${response.status}`);
    }
    const json = await response.json() as JamBaseEventsResponse;
    events.push(...(json.events ?? json.results ?? []));
    nextUrl = json.pagination?.nextPage;
    page += 1;
  }

  return events;
}

function hasEventHint(input: { city?: string; date?: string }): boolean {
  return Boolean(input.city?.trim() || input.date?.trim());
}

function filterByEventHints(events: EventCandidate[], input: { city?: string; date?: string }): EventCandidate[] {
  const city = normalize(input.city ?? "");
  const date = input.date?.trim().slice(0, 10);
  const month = date?.slice(0, 7);
  if (!city && !date) {
    return events;
  }
  return events.filter((event) => {
    const eventCity = normalize(event.city);
    const eventDate = event.date.slice(0, 10);
    const cityMatches = !city || eventCity.includes(city) || city.includes(eventCity);
    const dateMatches = !date || eventDate === date || (month ? eventDate.startsWith(month) : false);
    return cityMatches && dateMatches;
  });
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
  const artistEntity = findMatchingArtistEntity([...performers, ...lineup], input.artist) ?? performers[0] ?? lineup[0];
  const artist = entityName(artistEntity) ?? input.artist ?? "Unknown artist";
  const venue = entityName(event.venue) ?? event.location?.name ?? "Unknown venue";
  const city = event.venue?.city ?? event.location?.address?.addressLocality ?? "Unknown city";
  const setlist = mapSetlist(event.setlist, event.url);

  return {
    id: entityId(event) ?? `jambase-${index}`,
    title: event.name ?? event.title ?? `${artist} at ${venue}`,
    artist,
    artistId: entityId(artistEntity),
    venue,
    venueId: entityId(event.venue) ?? entityId(event.location),
    city,
    date: event.startDate ?? new Date().toISOString(),
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

function findMatchingArtistEntity(entities: JamBaseEntity[], artist?: string): JamBaseEntity | undefined {
  const target = normalize(artist ?? "");
  if (!target) return undefined;
  return entities.find((entity) => {
    const name = normalize(entityName(entity) ?? "");
    return name === target || name.includes(target) || target.includes(name);
  });
}

function artistMatchRank(event: EventCandidate, artist?: string): number {
  const target = normalize(artist ?? "");
  if (!target) return 1;
  const artistName = normalize(event.artist);
  if (artistName === target || artistName.includes(target) || target.includes(artistName)) return 0;
  return event.lineup?.some((item) => {
    const name = normalize(item);
    return name === target || name.includes(target) || target.includes(name);
  }) ? 1 : 2;
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
