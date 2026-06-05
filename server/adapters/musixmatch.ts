import type { TrackCandidate } from "../../shared/types";
import { fixtureCanonicalLines, fixtureTracks, type CanonicalLine } from "../data/fixtures";
import { env } from "../config";

export type CanonicalReference = {
  lines: CanonicalLine[];
  source: "musixmatch" | "fixture";
  sourceCoverage: number;
};

type MusixmatchTrackSearchItem = {
  track?: {
    track_id?: number;
    track_name?: string;
    artist_name?: string;
    album_name?: string;
    commontrack_isrcs?: string[][];
    has_lyrics?: number;
    has_subtitles?: number;
    track_rating?: number;
  };
};

export async function searchTracks(query: string): Promise<TrackCandidate[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!env.musixmatchKey) {
    return fixtureTracks.filter((track) =>
      `${track.title} ${track.artist} ${track.album ?? ""}`.toLowerCase().includes(normalizedQuery)
    );
  }

  const params = new URLSearchParams({
    apikey: env.musixmatchKey,
    q: query,
    f_has_lyrics: "1",
    page_size: "6",
    format: "json"
  });

  try {
    const response = await fetch(`${env.musixmatchBaseUrl}/track.search?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Musixmatch search failed with ${response.status}`);
    }
    const json = await response.json();
    const items: MusixmatchTrackSearchItem[] = json?.message?.body?.track_list ?? [];
    return items
      .map((item): TrackCandidate | null => {
        const track = item.track;
        if (!track?.track_id || !track.track_name || !track.artist_name) {
          return null;
        }
        return {
          id: String(track.track_id),
          title: track.track_name,
          artist: track.artist_name,
          album: track.album_name,
          isrc: track.commontrack_isrcs?.[0]?.[0],
          hasLyrics: Boolean(track.has_lyrics),
          hasSubtitles: Boolean(track.has_subtitles),
          rating: track.track_rating,
          source: "musixmatch"
        };
      })
      .filter((track): track is TrackCandidate => track !== null);
  } catch {
    return fixtureTracks;
  }
}

export async function getCanonicalReference(track: TrackCandidate): Promise<CanonicalReference> {
  if (!env.musixmatchKey || track.source === "fixture") {
    return {
      lines: fixtureCanonicalLines,
      source: "fixture",
      sourceCoverage: 0.72
    };
  }

  try {
    const [subtitleLines, lyricLines] = await Promise.all([
      fetchSubtitleLines(track.id),
      fetchLyricLines(track.id)
    ]);
    const lines = subtitleLines.length > 0 ? subtitleLines : lyricLines;
    if (lines.length === 0) {
      return { lines: fixtureCanonicalLines, source: "fixture", sourceCoverage: 0.35 };
    }
    return {
      lines,
      source: "musixmatch",
      sourceCoverage: subtitleLines.length > 0 ? 0.95 : 0.76
    };
  } catch {
    return { lines: fixtureCanonicalLines, source: "fixture", sourceCoverage: 0.35 };
  }
}

async function fetchLyricLines(trackId: string): Promise<CanonicalLine[]> {
  const params = new URLSearchParams({
    apikey: env.musixmatchKey ?? "",
    track_id: trackId,
    format: "json"
  });
  const response = await fetch(`${env.musixmatchBaseUrl}/track.lyrics.get?${params.toString()}`);
  if (!response.ok) {
    return [];
  }
  const json = await response.json();
  const body = json?.message?.body?.lyrics?.lyrics_body as string | undefined;
  return splitCanonicalBody(body);
}

async function fetchSubtitleLines(trackId: string): Promise<CanonicalLine[]> {
  const params = new URLSearchParams({
    apikey: env.musixmatchKey ?? "",
    track_id: trackId,
    subtitle_format: "LRC",
    format: "json"
  });
  const response = await fetch(`${env.musixmatchBaseUrl}/track.subtitle.get?${params.toString()}`);
  if (!response.ok) {
    return [];
  }
  const json = await response.json();
  const body = json?.message?.body?.subtitle?.subtitle_body as string | undefined;
  return splitCanonicalBody(body);
}

function splitCanonicalBody(body?: string): CanonicalLine[] {
  if (!body) {
    return [];
  }
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[\d:.]+\]/, "").trim())
    .filter((line) => line && !line.includes("*******"))
    .slice(0, 80)
    .map((text, index) => ({
      id: `L${index + 1}`,
      start: index * 4,
      end: index * 4 + 4,
      text
    }));
}
