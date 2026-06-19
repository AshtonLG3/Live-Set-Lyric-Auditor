import type { CanonicalSource, TrackCandidate, TranscriptSegment } from "../../shared/types";
import { fixtureCanonicalLines, fixtureTracks, type CanonicalLine } from "../data/fixtures";
import { env } from "../config";

export type CanonicalReference = {
  lines: CanonicalLine[];
  source: CanonicalSource;
  sourceCoverage: number;
  restricted: boolean;
  language?: string;
  copyright?: string;
  trackingUrl?: string;
};

type RawTrack = {
  track_id?: number;
  commontrack_id?: number;
  track_name?: string;
  artist_name?: string;
  album_name?: string;
  track_length?: number;
  commontrack_isrcs?: unknown;
  has_lyrics?: number;
  has_subtitles?: number;
  has_richsync?: number;
  instrumental?: number;
  explicit?: number;
  track_rating?: number;
  lyrics_language?: string;
  album_release_type?: string;
  primary_genres?: {
    music_genre_list?: Array<{
      music_genre?: { music_genre_name_extended?: string; music_genre_name?: string };
    }>;
  };
};

type MusixmatchTrackSearchItem = { track?: RawTrack };
type MusixmatchFingerprintItem = { similarity?: number; track?: RawTrack };

export async function searchTracks(query: string): Promise<TrackCandidate[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!env.musixmatchKey) {
    return fixtureTracks.filter((track) =>
      `${track.title} ${track.artist} ${track.album ?? ""}`.toLowerCase().includes(normalizedQuery)
    );
  }

  return searchMusixmatch(new URLSearchParams({ q: query, f_has_lyrics: "1" }));
}

export async function identifyTrackFromLyrics(segments: TranscriptSegment[]): Promise<TrackCandidate | undefined> {
  if (!env.musixmatchKey) {
    return undefined;
  }

  const text = buildFingerprintText(segments);
  if (wordCount(text) >= 10) {
    const fingerprinted = await prioritizeCanonicalRecordings(text, await fingerprintLyrics(text));
    const best = confidentFingerprintMatch(fingerprinted);
    if (best) {
      return best;
    }
  }

  const phrases = buildIdentificationPhrases(segments);
  const resultSets = await Promise.all(phrases.map((phrase) =>
    searchMusixmatch(new URLSearchParams({ q_lyrics: phrase, f_has_lyrics: "1" }))
  ));
  const populatedSets = resultSets.filter((tracks) => tracks.length > 0);
  const scores = new Map<string, { track: TrackCandidate; occurrences: number; score: number }>();

  for (const tracks of populatedSets) {
    tracks.forEach((track, index) => {
      const current = scores.get(track.id) ?? { track, occurrences: 0, score: 0 };
      current.occurrences += 1;
      current.score += Math.max(1, 6 - index);
      scores.set(track.id, current);
    });
  }

  const ranked = [...scores.values()].sort((left, right) =>
    right.occurrences - left.occurrences || right.score - left.score || (right.track.rating ?? 0) - (left.track.rating ?? 0)
  );
  const best = ranked[0];
  if (!best) {
    return undefined;
  }
  if (populatedSets.length > 1 && best.occurrences < 2) {
    return undefined;
  }
  return best.track;
}

export async function searchTracksByLyrics(segments: TranscriptSegment[]): Promise<TrackCandidate[]> {
  const phrase = buildFingerprintText(segments);

  if (!phrase) {
    return [];
  }
  if (!env.musixmatchKey) {
    return fixtureTracks;
  }

  if (wordCount(phrase) >= 10) {
    const fingerprinted = await prioritizeCanonicalRecordings(phrase, await fingerprintLyrics(phrase));
    if (fingerprinted.length > 0) {
      return fingerprinted;
    }
  }

  return searchMusixmatch(new URLSearchParams({ q_lyrics: phrase.split(/\s+/).slice(0, 18).join(" "), f_has_lyrics: "1" }));
}

export async function getCanonicalReference(track: TrackCandidate): Promise<CanonicalReference> {
  if (track.source === "manual") {
    return {
      lines: [],
      source: "metadata-only",
      sourceCoverage: 0.2,
      restricted: true,
      language: track.language,
      copyright: "Manual track correction; no Musixmatch lyric reference is attached."
    };
  }
  if (!env.musixmatchKey || track.source === "fixture") {
    return {
      lines: fixtureCanonicalLines,
      source: "fixture",
      sourceCoverage: 0.9,
      restricted: false,
      language: track.language ?? "en",
      copyright: "Fixture lyrics created for the Musicathon demo."
    };
  }

  try {
    const [richSyncLines, subtitleLines, lyrics] = await Promise.all([
      fetchRichSyncLines(track.id),
      fetchSubtitleLines(track.id),
      fetchLyrics(track.id)
    ]);

    if (lyrics.restricted && richSyncLines.length === 0 && subtitleLines.length === 0) {
      return {
        lines: [],
        source: "metadata-only",
        sourceCoverage: 0.22,
        restricted: true,
        language: lyrics.language ?? track.language,
        copyright: lyrics.copyright,
        trackingUrl: lyrics.trackingUrl
      };
    }

    const source: CanonicalSource = richSyncLines.length > 0
      ? "richsync"
      : subtitleLines.length > 0
        ? "subtitles"
        : lyrics.lines.length > 0
          ? "lyrics"
          : "metadata-only";
    const lines = richSyncLines.length > 0 ? richSyncLines : subtitleLines.length > 0 ? subtitleLines : lyrics.lines;

    return {
      lines,
      source,
      sourceCoverage: source === "richsync" ? 0.99 : source === "subtitles" ? 0.92 : source === "lyrics" ? 0.74 : 0.22,
      restricted: lyrics.restricted,
      language: lyrics.language ?? track.language,
      copyright: lyrics.copyright,
      trackingUrl: lyrics.trackingUrl
    };
  } catch {
    return {
      lines: [],
      source: "metadata-only",
      sourceCoverage: 0.22,
      restricted: true,
      language: track.language,
      copyright: "Live Musixmatch lyric reference unavailable; no demo lyrics were substituted."
    };
  }
}

async function searchMusixmatch(query: URLSearchParams): Promise<TrackCandidate[]> {
  query.set("apikey", env.musixmatchKey ?? "");
  if (!query.has("page_size")) query.set("page_size", "6");
  query.set("format", "json");

  try {
    const response = await fetch(`${env.musixmatchBaseUrl}/track.search?${query.toString()}`);
    if (!response.ok) {
      throw new Error(`Musixmatch search failed with ${response.status}`);
    }
    const json = await response.json();
    const items: MusixmatchTrackSearchItem[] = json?.message?.body?.track_list ?? [];
    return items
      .map((item) => mapTrack(item.track))
      .filter((track): track is TrackCandidate => track !== null);
  } catch {
    return [];
  }
}

async function fingerprintLyrics(text: string): Promise<TrackCandidate[]> {
  const query = new URLSearchParams({
    apikey: env.musixmatchKey ?? "",
    size: "20",
    limit: "6",
    format: "json"
  });

  try {
    const response = await fetch(`${env.musixmatchBaseUrl}/track.lyrics.fingerprint.post?${query.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { text } })
    });
    if (!response.ok) {
      return [];
    }
    const json = await response.json();
    const items: MusixmatchFingerprintItem[] = json?.track_list ?? json?.message?.body?.track_list ?? [];
    const tracks: TrackCandidate[] = [];
    for (const item of items) {
      const track = mapTrack(item.track);
      if (track) {
        tracks.push({ ...track, lyricSimilarity: item.similarity });
      }
    }
    return tracks.sort((left, right) =>
      (right.lyricSimilarity ?? 0) - (left.lyricSimilarity ?? 0)
      || (right.rating ?? 0) - (left.rating ?? 0)
    );
  } catch {
    return [];
  }
}

async function prioritizeCanonicalRecordings(text: string, fingerprinted: TrackCandidate[]): Promise<TrackCandidate[]> {
  const fingerprintLeader = fingerprinted[0];
  if (!fingerprintLeader) {
    return [];
  }

  const catalog = await searchMusixmatch(new URLSearchParams({
    q_track: fingerprintLeader.title,
    q_lyrics: text.split(/\s+/).slice(0, 30).join(" "),
    f_has_lyrics: "1",
    g_commontrack: "1",
    s_track_rating: "desc",
    page_size: "10"
  }));
  if (catalog.length === 0) {
    return fingerprinted;
  }

  const similarity = fingerprintLeader.lyricSimilarity;
  const rankedCatalog = catalog.map((track) => ({ ...track, lyricSimilarity: similarity }));
  const catalogIds = new Set(rankedCatalog.map((track) => track.id));
  return [...rankedCatalog, ...fingerprinted.filter((track) => !catalogIds.has(track.id))];
}

function confidentFingerprintMatch(tracks: TrackCandidate[]): TrackCandidate | undefined {
  const best = tracks[0];
  if (!best || (best.lyricSimilarity ?? 0) < 80) {
    return undefined;
  }
  const runnerUp = tracks[1];
  if (runnerUp && (best.lyricSimilarity ?? 0) < 95 && (best.lyricSimilarity ?? 0) - (runnerUp.lyricSimilarity ?? 0) < 8) {
    return undefined;
  }
  return best;
}

function buildFingerprintText(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .slice(0, 120)
    .join(" ");
}

function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function buildIdentificationPhrases(segments: TranscriptSegment[]): string[] {
  const strongSegments = [...segments]
    .filter((segment) => segment.text.trim().split(/\s+/).length >= 4)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3)
    .map((segment) => segment.text.trim().split(/\s+/).slice(0, 14).join(" "));
  const combined = segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .slice(0, 18)
    .join(" ");
  return [...new Set([combined, ...strongSegments].filter(Boolean))].slice(0, 3);
}

function mapTrack(track?: RawTrack): TrackCandidate | null {
  if (!track?.track_id || !track.track_name || !track.artist_name) {
    return null;
  }
  const genre = track.primary_genres?.music_genre_list?.[0]?.music_genre;
  return {
    id: String(track.track_id),
    commonTrackId: track.commontrack_id ? String(track.commontrack_id) : undefined,
    title: track.track_name,
    artist: track.artist_name,
    album: track.album_name,
    isrc: firstString(track.commontrack_isrcs),
    durationSeconds: track.track_length,
    hasLyrics: Boolean(track.has_lyrics),
    hasSubtitles: Boolean(track.has_subtitles),
    hasRichSync: Boolean(track.has_richsync),
    instrumental: Boolean(track.instrumental),
    explicit: Boolean(track.explicit),
    language: track.lyrics_language,
    genre: genre?.music_genre_name_extended ?? genre?.music_genre_name,
    releaseType: track.album_release_type,
    rating: track.track_rating,
    source: "musixmatch"
  };
}

async function fetchRichSyncLines(trackId: string): Promise<CanonicalLine[]> {
  const response = await fetchMethod("track.richsync.get", trackId);
  if (!response.ok) return [];
  const json = await response.json();
  const raw = json?.message?.body?.richsync?.richsync_body as string | undefined;
  if (!raw) return [];

  try {
    const entries = JSON.parse(raw) as Array<{
      ts?: number;
      te?: number;
      l?: Array<{ c?: string; o?: number }>;
      x?: string;
    }>;
    return entries
      .map((entry, index): CanonicalLine | null => {
        const text = entry.l?.map((word) => word.c ?? "").join("").trim() ?? entry.x?.trim();
        if (!text) return null;
        const start = Number(entry.ts ?? index * 4);
        return {
          id: `L${index + 1}`,
          start,
          end: Number(entry.te ?? start + 4),
          text
        };
      })
      .filter((line): line is CanonicalLine => line !== null);
  } catch {
    return [];
  }
}

async function fetchSubtitleLines(trackId: string): Promise<CanonicalLine[]> {
  const response = await fetchMethod("track.subtitle.get", trackId, { subtitle_format: "LRC" });
  if (!response.ok) return [];
  const json = await response.json();
  const body = json?.message?.body?.subtitle?.subtitle_body as string | undefined;
  return parseLrcBody(body);
}

// LRC subtitle bodies carry real per-line timestamps (`[mm:ss.xx]text`). Preserve
// them so downstream timing-drift detection runs against the actual performance
// clock instead of the fabricated index*4 spacing used for plain lyrics.
export function parseLrcBody(body?: string): CanonicalLine[] {
  if (!body) return [];
  const parsed: Array<{ start: number; text: string }> = [];
  for (const raw of body.split(/\r?\n/)) {
    const match = /^\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/.exec(raw.trim());
    if (!match) continue;
    const [, minutes, seconds, fraction, rest] = match;
    const text = rest.replace(/^(?:\[[^\]]*\]\s*)+/, "").trim();
    if (!text || text.includes("*******")) continue;
    const start = Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0);
    parsed.push({ start, text });
  }
  return parsed.slice(0, 100).map((line, index, all) => ({
    id: `L${index + 1}`,
    start: roundSeconds(line.start),
    end: roundSeconds(index + 1 < all.length ? all[index + 1].start : line.start + 4),
    text: line.text
  }));
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

async function fetchLyrics(trackId: string): Promise<{
  lines: CanonicalLine[];
  restricted: boolean;
  language?: string;
  copyright?: string;
  trackingUrl?: string;
}> {
  const response = await fetchMethod("track.lyrics.get", trackId);
  if (!response.ok) return { lines: [], restricted: false };
  const json = await response.json();
  const lyrics = json?.message?.body?.lyrics;
  return {
    lines: splitCanonicalBody(lyrics?.lyrics_body),
    restricted: Boolean(lyrics?.restricted),
    language: lyrics?.lyrics_language,
    copyright: lyrics?.lyrics_copyright,
    trackingUrl: lyrics?.pixel_tracking_url ?? lyrics?.script_tracking_url
  };
}

function fetchMethod(method: string, trackId: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({
    apikey: env.musixmatchKey ?? "",
    track_id: trackId,
    format: "json",
    ...extra
  });
  return fetch(`${env.musixmatchBaseUrl}/${method}?${params.toString()}`);
}

function splitCanonicalBody(body?: string): CanonicalLine[] {
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[\d:.]+\]/, "").trim())
    .filter((line) => line && !line.includes("*******"))
    .slice(0, 100)
    .map((text, index) => ({ id: `L${index + 1}`, start: index * 4, end: index * 4 + 4, text }));
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  for (const item of value.flat(3)) {
    if (typeof item === "string" && item.trim()) return item;
  }
  return undefined;
}
