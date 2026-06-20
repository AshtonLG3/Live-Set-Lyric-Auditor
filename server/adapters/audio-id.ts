import { createHmac } from "node:crypto";
import type { TrackCandidate } from "../../shared/types";
import { env, isAudioIdConfigured } from "../config";
import { searchTracks } from "./musixmatch";

type AudioIdProvider = "acrcloud" | "custom";

type AudioIdentityMetadata = {
  provider: AudioIdProvider;
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  durationSeconds?: number;
  confidence?: number;
  providerTrackId?: string;
};

export type AudioIdentityMatch = {
  track: TrackCandidate;
  provider: AudioIdProvider;
  confidence: number;
  detail: string;
};

export async function identifyTrackFromAudio(file?: Express.Multer.File): Promise<AudioIdentityMatch | undefined> {
  if (!file || !isAudioIdConfigured()) {
    return undefined;
  }

  const metadata = env.audioIdProvider === "acrcloud"
    ? await identifyWithAcrCloud(file)
    : await identifyWithCustomEndpoint(file);
  if (!metadata) {
    return undefined;
  }

  const track = await resolveAudioIdentityTrack(metadata);
  if (!track) {
    return undefined;
  }

  return {
    track,
    provider: metadata.provider,
    confidence: metadata.confidence ?? 0.76,
    detail: `${providerLabel(metadata.provider)} audio fingerprint${metadata.confidence !== undefined ? ` ${Math.round(metadata.confidence * 100)}%` : ""}`
  };
}

async function identifyWithCustomEndpoint(file: Express.Multer.File): Promise<AudioIdentityMetadata | undefined> {
  if (!env.audioIdApiUrl) {
    return undefined;
  }

  const form = new FormData();
  appendFile(form, env.audioIdFileField, file);

  const response = await fetchWithTimeout(env.audioIdApiUrl, {
    method: "POST",
    headers: env.audioIdApiKey ? { Authorization: `Bearer ${env.audioIdApiKey}` } : undefined,
    body: form
  });
  if (!response.ok) {
    return undefined;
  }

  return parseAudioIdentity(await response.json(), "custom");
}

async function identifyWithAcrCloud(file: Express.Multer.File): Promise<AudioIdentityMetadata | undefined> {
  if (!env.acrCloudHost || !env.acrCloudAccessKey || !env.acrCloudAccessSecret) {
    return undefined;
  }

  const dataType = "audio";
  const signatureVersion = "1";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const path = "/v1/identify";
  const signature = createHmac("sha1", env.acrCloudAccessSecret)
    .update(["POST", path, env.acrCloudAccessKey, dataType, signatureVersion, timestamp].join("\n"))
    .digest("base64");
  const form = new FormData();
  form.set("access_key", env.acrCloudAccessKey);
  form.set("data_type", dataType);
  form.set("signature_version", signatureVersion);
  form.set("signature", signature);
  form.set("timestamp", timestamp);
  form.set("sample_bytes", String(file.buffer.length));
  appendFile(form, "sample", file);

  const response = await fetchWithTimeout(`${normalizeAcrHost(env.acrCloudHost)}${path}`, {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    return undefined;
  }

  return parseAudioIdentity(await response.json(), "acrcloud");
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.audioIdTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return new Response(null, { status: 599 });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveAudioIdentityTrack(metadata: AudioIdentityMetadata): Promise<TrackCandidate | undefined> {
  const direct = directTrackCandidate(metadata);
  if (!env.musixmatchKey) {
    return direct;
  }

  const candidates = await searchTracks(`${metadata.title} ${metadata.artist}`);
  const best = chooseCatalogCandidate(metadata, candidates);
  if (!best) {
    return direct;
  }
  return {
    ...best,
    isrc: best.isrc ?? metadata.isrc,
    durationSeconds: best.durationSeconds ?? metadata.durationSeconds
  };
}

function directTrackCandidate(metadata: AudioIdentityMetadata): TrackCandidate {
  return {
    id: metadata.providerTrackId ?? `audio-id-${slugify(`${metadata.artist}-${metadata.title}`)}`,
    title: metadata.title,
    artist: metadata.artist,
    album: metadata.album,
    isrc: metadata.isrc,
    durationSeconds: metadata.durationSeconds,
    hasLyrics: false,
    hasSubtitles: false,
    source: "manual"
  };
}

function chooseCatalogCandidate(metadata: AudioIdentityMetadata, candidates: TrackCandidate[]): TrackCandidate | undefined {
  const targetTitle = normalizeText(metadata.title);
  const targetArtist = normalizeText(metadata.artist);
  const targetIsrc = metadata.isrc?.trim().toUpperCase();

  return candidates
    .map((candidate, index) => ({
      candidate,
      score: audioCandidateScore(candidate, targetTitle, targetArtist, targetIsrc) - index * 0.2
    }))
    .filter((item) => item.score >= 50)
    .sort((left, right) => right.score - left.score)[0]?.candidate;
}

function audioCandidateScore(candidate: TrackCandidate, targetTitle: string, targetArtist: string, targetIsrc?: string): number {
  const title = normalizeText(candidate.title);
  const artist = normalizeText(candidate.artist);
  let score = 0;
  if (targetIsrc && candidate.isrc?.toUpperCase() === targetIsrc) score += 130;
  if (title === targetTitle) score += 80;
  else if (baseTitle(title) === baseTitle(targetTitle)) score += 64;
  else if (title.includes(targetTitle) || targetTitle.includes(title)) score += 35;
  if (artist === targetArtist) score += 58;
  else if (primaryArtist(artist) === primaryArtist(targetArtist)) score += 42;
  else if (artist.includes(targetArtist) || targetArtist.includes(artist)) score += 22;
  score += (candidate.rating ?? 0) / 20;
  if (candidate.hasRichSync) score += 6;
  if (candidate.hasSubtitles) score += 4;
  if (candidate.hasLyrics) score += 3;
  return score;
}

function parseAudioIdentity(payload: unknown, provider: AudioIdProvider): AudioIdentityMetadata | undefined {
  const source = provider === "acrcloud"
    ? firstArrayItem(asRecord(payload)?.metadata?.music)
    : asRecord(payload)?.track ?? asRecord(payload)?.result ?? payload;
  const sourceRecord = asRecord(source);
  if (!sourceRecord) {
    return undefined;
  }

  const title = firstString(sourceRecord.title, sourceRecord.track_name, sourceRecord.name);
  const artist = firstString(
    sourceRecord.artist,
    sourceRecord.artist_name,
    firstArrayItem(sourceRecord.artists)?.name,
    firstArrayItem(sourceRecord.artist_list)?.name
  );
  if (!title || !artist) {
    return undefined;
  }

  const album = firstString(sourceRecord.album, asRecord(sourceRecord.album)?.name, sourceRecord.album_name);
  const isrc = firstString(sourceRecord.isrc, asRecord(sourceRecord.external_ids)?.isrc, sourceRecord.commontrack_isrc);
  return {
    provider,
    title,
    artist,
    album,
    isrc,
    durationSeconds: millisecondsToSeconds(firstNumber(sourceRecord.duration_ms, sourceRecord.durationMs)) ?? firstNumber(sourceRecord.duration_seconds, sourceRecord.durationSeconds),
    confidence: normalizeConfidence(firstNumber(sourceRecord.confidence, sourceRecord.score, sourceRecord.similarity)),
    providerTrackId: firstString(sourceRecord.track_id, sourceRecord.id)
  };
}

function appendFile(form: FormData, field: string, file: Express.Multer.File) {
  const bytes = new Uint8Array(file.buffer);
  form.append(field, new Blob([bytes], { type: file.mimetype || "application/octet-stream" }), file.originalname || "clip");
}

function normalizeAcrHost(host: string): string {
  const cleaned = host.trim().replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
  return `https://${cleaned}`;
}

function providerLabel(provider: AudioIdProvider): string {
  return provider === "acrcloud" ? "ACRCloud" : "Configured";
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" ? value as Record<string, any> : undefined;
}

function firstArrayItem(value: unknown): Record<string, any> | undefined {
  return Array.isArray(value) ? asRecord(value[0]) : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function normalizeConfidence(value?: number): number | undefined {
  if (value === undefined) return undefined;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

function millisecondsToSeconds(value?: number): number | undefined {
  return value === undefined ? undefined : Math.round(value / 100) / 10;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function primaryArtist(value: string): string {
  return value.split(/\s+(?:feat|ft|featuring|with)\.?\s+/i)[0] ?? value;
}

function baseTitle(value: string): string {
  return value
    .replace(/\((?:live|extended|remix|acoustic|edit|version|from|feat|with|deluxe|mix|remaster|radio|single)\b[^)]*\)/g, "")
    .replace(/\s*-\s*(?:live|extended|remix|acoustic|edit|remaster|radio edit|single version)\b.*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "track";
}
