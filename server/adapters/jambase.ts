import type { EventCandidate } from "../../shared/types";
import { env } from "../config";
import { fixtureEvents } from "../data/fixtures";

type JamBaseEvent = {
  id?: string;
  name?: string;
  title?: string;
  startDate?: string;
  url?: string;
  location?: {
    name?: string;
    address?: {
      addressLocality?: string;
    };
  };
  venue?: {
    name?: string;
    city?: string;
  };
  performers?: Array<{ name?: string }>;
};

export async function searchEvents(input: {
  artist?: string;
  city?: string;
  date?: string;
}): Promise<EventCandidate[]> {
  if (!env.jambaseKey) {
    return filterFixtureEvents(input);
  }

  const params = new URLSearchParams();
  params.set("apikey", env.jambaseKey);
  if (input.artist) params.set("artistName", input.artist);
  if (input.city) params.set("city", input.city);
  if (input.date) params.set("dateFrom", input.date.slice(0, 10));

  try {
    const response = await fetch(`${env.jambaseBaseUrl}/events?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`JamBase search failed with ${response.status}`);
    }
    const json = await response.json();
    const events: JamBaseEvent[] = json.events ?? json.results ?? [];
    const mapped = events.slice(0, 6).map((event, index): EventCandidate => {
      const artist = event.performers?.[0]?.name ?? input.artist ?? "Unknown artist";
      const venue = event.venue?.name ?? event.location?.name ?? "Unknown venue";
      const city = event.venue?.city ?? event.location?.address?.addressLocality ?? input.city ?? "Unknown city";
      return {
        id: event.id ?? `jambase-${index}`,
        title: event.name ?? event.title ?? `${artist} at ${venue}`,
        artist,
        venue,
        city,
        date: event.startDate ?? input.date ?? new Date().toISOString(),
        url: event.url,
        source: "jambase"
      };
    });
    return mapped.length > 0 ? mapped : filterFixtureEvents(input);
  } catch {
    return filterFixtureEvents(input);
  }
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

