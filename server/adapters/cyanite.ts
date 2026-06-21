import type { ClipSource, PerformanceContext } from "../../shared/types";
import { env } from "../config";
import { fixturePerformanceContext } from "../data/fixtures";
import { transcodeMediaToMp3 } from "../services/media";

type CyaniteAnalysisResult = {
  bpmRangeAdjusted?: number;
  energyLevel?: string;
  moodTags?: string[];
  advancedInstrumentTags?: string[];
  valence?: number;
  arousal?: number;
  transformerCaption?: string;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

export async function analyzePerformance(input: {
  file?: Express.Multer.File;
  source?: ClipSource;
}): Promise<PerformanceContext> {
  if (!env.cyaniteToken) return fixturePerformanceContext;

  try {
    const uploadFile = input.file
      ? isMp3(input.file)
        ? input.file
        : await transcodeMediaToMp3(input.file, "cyanite")
      : undefined;
    const trackId = uploadFile
      ? await uploadLibraryTrack(uploadFile)
      : input.source?.kind === "live_link"
        && input.source.provider === "youtube"
        && input.source.processingMode === "provider_excerpt"
        && env.youtubeExtractionEnabled
        ? await enqueueYoutubeTrack(input.source)
        : null;
    if (!trackId) return fixturePerformanceContext;

    const result = await pollAnalysis(trackId);
    return result ? mapPerformanceContext(result) : fixturePerformanceContext;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown Cyanite error";
    console.warn(`Cyanite analysis unavailable; using the labeled fallback profile. ${detail}`);
    return fixturePerformanceContext;
  }
}

async function enqueueYoutubeTrack(source: ClipSource): Promise<string | null> {
  const youtubeId = extractYoutubeId(source.url);
  if (!youtubeId) return null;

  const response = await graphql<{
    youTubeTrackEnqueue?: {
      __typename?: string;
      enqueuedLibraryTrack?: { id?: string };
    };
  }>(`
    mutation EnqueueYoutubeTrack($input: YouTubeTrackEnqueueInput!) {
      youTubeTrackEnqueue(input: $input) {
        __typename
        ... on YouTubeTrackEnqueueSuccess {
          enqueuedLibraryTrack { id }
        }
      }
    }
  `, {
    input: {
      youtubeId,
      title: `Live performance ${youtubeId}`
    }
  });

  return response.youTubeTrackEnqueue?.enqueuedLibraryTrack?.id ?? null;
}

async function uploadLibraryTrack(file: Express.Multer.File): Promise<string | null> {
  const uploadRequest = await graphql<{
    fileUploadRequest?: { id?: string; uploadUrl?: string };
  }>(`
    mutation RequestFileUpload {
      fileUploadRequest { id uploadUrl }
    }
  `, {});
  const upload = uploadRequest.fileUploadRequest;
  if (!upload?.id || !upload.uploadUrl) return null;

  const uploadResponse = await fetchWithTimeout(upload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.mimetype || "audio/mpeg" },
    body: new Uint8Array(file.buffer)
  }, "upload");
  if (!uploadResponse.ok) return null;

  const createResponse = await graphql<{
    libraryTrackCreate?: {
      __typename?: string;
      createdLibraryTrack?: { id?: string };
    };
  }>(`
    mutation CreateLibraryTrack($input: LibraryTrackCreateInput!) {
      libraryTrackCreate(input: $input) {
        __typename
        ... on LibraryTrackCreateSuccess {
          createdLibraryTrack { id }
        }
      }
    }
  `, {
    input: {
      uploadId: upload.id,
      title: file.originalname.replace(/\.[^.]+$/, "")
    }
  });

  return createResponse.libraryTrackCreate?.createdLibraryTrack?.id ?? null;
}

async function pollAnalysis(trackId: string): Promise<CyaniteAnalysisResult | null> {
  const deadline = Date.now() + env.cyanitePollTimeoutMs;
  while (Date.now() < deadline) {
    const response = await graphql<{
      libraryTrack?: {
        __typename?: string;
        audioAnalysisV7?: {
          __typename?: string;
          result?: CyaniteAnalysisResult;
        };
      };
    }>(`
      query PerformanceAnalysis($id: ID!) {
        libraryTrack(id: $id) {
          __typename
          ... on LibraryTrack {
            audioAnalysisV7 {
              __typename
              ... on AudioAnalysisV7Finished {
                result {
                  bpmRangeAdjusted
                  energyLevel
                  moodTags
                  advancedInstrumentTags
                  valence
                  arousal
                  transformerCaption
                }
              }
            }
          }
        }
      }
    `, { id: trackId });
    const analysis = response.libraryTrack?.audioAnalysisV7;
    if (analysis?.result) return analysis.result;
    if (analysis?.__typename?.toLowerCase().includes("failed")) return null;
    await delay(env.cyanitePollIntervalMs);
  }
  return null;
}

function mapPerformanceContext(result: CyaniteAnalysisResult): PerformanceContext {
  const energyLevel = energyScore(result.energyLevel);
  const emotions = (result.moodTags ?? []).slice(0, 3).map(humanize);
  const instruments = (result.advancedInstrumentTags ?? []).slice(0, 4).map(humanize);
  const caption = result.transformerCaption?.trim();
  const arrangement = classifyArrangement(energyLevel, instruments, caption);

  return {
    source: "cyanite",
    status: "complete",
    energyLevel,
    bpm: result.bpmRangeAdjusted ? Math.round(result.bpmRangeAdjusted) : undefined,
    dominantEmotions: emotions,
    instruments,
    valence: result.valence,
    arousal: result.arousal,
    arrangement,
    summary: caption || `${humanize(arrangement)} performance with ${emotions.join(", ") || "mixed"} emotional character.`,
    confidence: 0.9
  };
}

function classifyArrangement(energy: number, instruments: string[], caption?: string): PerformanceContext["arrangement"] {
  const signal = `${caption ?? ""} ${instruments.join(" ")}`.toLowerCase();
  if (/crowd|audience|chant|sing.?along/.test(signal)) return "crowd_forward";
  if (/acoustic|piano|solo|stripped/.test(signal) && energy < 0.72) return "stripped_back";
  if (energy >= 0.78) return "high_intensity";
  if (instruments.length >= 3) return "full_band";
  return "uncertain";
}

function energyScore(value?: string): number {
  const scores: Record<string, number> = {
    VERY_LOW: 0.16,
    LOW: 0.34,
    MEDIUM: 0.58,
    HIGH: 0.8,
    VERY_HIGH: 0.95
  };
  return scores[value ?? ""] ?? 0.5;
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetchWithTimeout(env.cyaniteBaseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.cyaniteToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  }, "GraphQL");
  if (!response.ok) throw new Error(`Cyanite request failed with ${response.status}`);
  const payload = await response.json() as GraphQLResponse<T>;
  if (payload.errors?.length || !payload.data) {
    throw new Error(payload.errors?.[0]?.message ?? "Cyanite returned no data");
  }
  return payload.data;
}

function extractYoutubeId(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
      return url.searchParams.get("v") ?? url.pathname.match(/\/(?:live|shorts|embed)\/([^/?]+)/)?.[1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function isMp3(file?: Express.Multer.File): file is Express.Multer.File {
  return Boolean(file && (file.mimetype === "audio/mpeg" || /\.mp3$/i.test(file.originalname)));
}

function humanize(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.cyaniteRequestTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Cyanite ${label} timed out after ${Math.round(env.cyaniteRequestTimeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
