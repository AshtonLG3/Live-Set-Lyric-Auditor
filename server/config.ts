import { APP_NAME, APP_VERSION } from "../shared/version";
import type { HealthResponse, IntegrationStatus, RuntimeMode } from "../shared/types";

const configured = (name: string) => Boolean(process.env[name]?.trim());
const configuredAny = (...names: string[]) => names.some(configured);
const defaultDevAllowedHosts = [".replit.dev", ".picard.replit.dev"];
const youtubeExtractionFlag = parseBoolean(process.env.YOUTUBE_EXTRACTION_ENABLED);
const youtubeCookiesConfigured = configuredAny("YOUTUBE_COOKIES_FILE", "YOUTUBE_COOKIES_PATH", "YOUTUBE_COOKIES_BASE64", "YOUTUBE_COOKIES");
const audioIdProvider = normalizeAudioIdProvider(process.env.AUDIO_ID_PROVIDER);
const customAudioIdConfigured = configuredAny("AUDIO_ID_API_URL", "MUSIXMATCH_AUDIO_ID_API_URL");
const acrCloudConfigured = configuredAny("ACRCLOUD_HOST")
  && configuredAny("ACRCLOUD_ACCESS_KEY")
  && configuredAny("ACRCLOUD_ACCESS_SECRET");

export const env = {
  host: process.env.HOST?.trim() || "0.0.0.0",
  port: Number(process.env.PORT ?? 4242),
  devAllowedHosts: parseList(process.env.DEV_ALLOWED_HOSTS, defaultDevAllowedHosts),
  musixmatchKey: process.env.MUSIXMATCH_API_KEY,
  musixmatchBaseUrl: process.env.MUSIXMATCH_API_BASE_URL ?? "https://api.musixmatch.com/ws/1.1",
  jambaseKey: process.env.JAMBASE_API_KEY,
  jambaseBaseUrl: process.env.JAMBASE_API_BASE_URL ?? "https://api.data.jambase.com/v3",
  cyaniteToken: process.env.CYANITE_API_TOKEN ?? process.env.CYANITE_API_KEY,
  cyaniteBaseUrl: process.env.CYANITE_API_BASE_URL ?? "https://api.cyanite.ai/graphql",
  cyaniteWebhookUrl: process.env.CYANITE_WEBHOOK_URL,
  lalalKey: process.env.LALAL_LICENSE_KEY,
  lalalBaseUrl: process.env.LALAL_API_BASE_URL ?? "https://www.lalal.ai/api/v1",
  lalalPollIntervalMs: Math.max(2_000, Number(process.env.LALAL_POLL_INTERVAL_MS ?? 3_000)),
  lalalPollTimeoutMs: Math.max(10_000, Number(process.env.LALAL_POLL_TIMEOUT_MS ?? 180_000)),
  lalalSplitter: process.env.LALAL_SPLITTER?.trim(),
  lalalDereverbEnabled: parseBoolean(process.env.LALAL_DEREVERB_ENABLED) ?? true,
  lalalLeadBackEnabled: parseBoolean(process.env.LALAL_LEAD_BACK_ENABLED) ?? true,
  lalalExtractionLevel: process.env.LALAL_EXTRACTION_LEVEL?.trim() || "clear_cut",
  lalalEncoderFormat: process.env.LALAL_ENCODER_FORMAT?.trim() || "mp3",
  elevenlabsKey: process.env.ELEVENLABS_API_KEY,
  elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb",
  replicateToken: process.env.REPLICATE_API_TOKEN,
  replicateWhisperVersion: process.env.REPLICATE_WHISPER_VERSION
    ?? "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
  replicateWhisperFallbackVersion: process.env.REPLICATE_WHISPER_FALLBACK_VERSION
    ?? "openai/whisper",
  asrCompareAllModels: parseBoolean(process.env.ASR_COMPARE_ALL_MODELS) ?? false,
  replicateDemucsRef: process.env.REPLICATE_DEMUCS_REF?.trim()
    || "cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953",
  replicateDemucsModel: process.env.REPLICATE_DEMUCS_MODEL?.trim() || undefined,
  replicateDemucsStem: process.env.REPLICATE_DEMUCS_STEM?.trim() || "vocals",
  pythonCommand: process.env.PYTHON_COMMAND?.trim() || "python",
  ffmpegLocation: process.env.FFMPEG_LOCATION?.trim(),
  youtubeExtractTimeoutMs: Math.min(60_000, Math.max(15_000, Number(process.env.YOUTUBE_EXTRACT_TIMEOUT_MS ?? 45_000))),
  youtubeCookiesFile: process.env.YOUTUBE_COOKIES_FILE?.trim() || process.env.YOUTUBE_COOKIES_PATH?.trim(),
  youtubeCookiesBase64: process.env.YOUTUBE_COOKIES_BASE64?.trim(),
  youtubeCookies: process.env.YOUTUBE_COOKIES?.trim(),
  youtubeExtractionEnabled: youtubeExtractionFlag ?? youtubeCookiesConfigured,
  audioIdProvider: audioIdProvider
    ?? (acrCloudConfigured ? "acrcloud" : customAudioIdConfigured ? "custom" : undefined),
  audioIdApiUrl: process.env.AUDIO_ID_API_URL?.trim() || process.env.MUSIXMATCH_AUDIO_ID_API_URL?.trim(),
  audioIdApiKey: process.env.AUDIO_ID_API_KEY?.trim() || process.env.MUSIXMATCH_AUDIO_ID_API_KEY?.trim(),
  audioIdFileField: process.env.AUDIO_ID_FILE_FIELD?.trim() || "clip",
  audioIdTimeoutMs: Math.min(30_000, Math.max(3_000, Number(process.env.AUDIO_ID_TIMEOUT_MS ?? 12_000))),
  acrCloudHost: process.env.ACRCLOUD_HOST?.trim(),
  acrCloudAccessKey: process.env.ACRCLOUD_ACCESS_KEY?.trim(),
  acrCloudAccessSecret: process.env.ACRCLOUD_ACCESS_SECRET?.trim(),
  cyanitePollIntervalMs: Math.max(1_000, Number(process.env.CYANITE_POLL_INTERVAL_MS ?? 2_500)),
  cyanitePollTimeoutMs: Math.max(30_000, Number(process.env.CYANITE_POLL_TIMEOUT_MS ?? 180_000)),
  asrApiUrl: process.env.ASR_API_URL,
  asrApiKey: process.env.ASR_API_KEY
};

export function isAudioIdConfigured(): boolean {
  if (env.audioIdProvider === "acrcloud") {
    return Boolean(env.acrCloudHost && env.acrCloudAccessKey && env.acrCloudAccessSecret);
  }
  if (env.audioIdProvider === "custom") {
    return Boolean(env.audioIdApiUrl);
  }
  return false;
}

export function getIntegrationStatus(): IntegrationStatus[] {
  return [
    {
      name: "Musixmatch",
      configured: configured("MUSIXMATCH_API_KEY"),
      mode: configured("MUSIXMATCH_API_KEY") ? "live" : "fixture",
      detail: configured("MUSIXMATCH_API_KEY")
        ? "Search, metadata, lyrics, and subtitles adapters enabled."
        : "Using seeded track and canonical reference fixtures."
    },
    {
      name: "Audio ID",
      configured: isAudioIdConfigured(),
      mode: isAudioIdConfigured() ? "live" : "fixture",
      detail: isAudioIdConfigured()
        ? `${env.audioIdProvider === "acrcloud" ? "ACRCloud" : "Configured"} audio fingerprinting runs before ASR lyric rescue in Auto Match.`
        : "Audio fingerprint grace route disabled; Auto Match falls back to ASR lyric rescue."
    },
    {
      name: "LALAL.AI",
      configured: configured("LALAL_LICENSE_KEY"),
      mode: configured("LALAL_LICENSE_KEY") ? "live" : "fixture",
      detail: configured("LALAL_LICENSE_KEY")
        ? "Fast vocal-split rescue runs only when original-audio ASR/alignment is weak."
        : "LALAL split rescue disabled; slow Demucs remains the last-resort fallback."
    },
    {
      name: "Demucs",
      configured: configured("REPLICATE_API_TOKEN"),
      mode: configured("REPLICATE_API_TOKEN") ? "live" : "fixture",
      detail: configured("REPLICATE_API_TOKEN")
        ? "Replicate Demucs stays available as the slow quality fallback after original ASR and LALAL rescue."
        : "Uploads fall back to original audio; seeded demos use fixture isolation."
    },
    {
      name: "JamBase",
      configured: configured("JAMBASE_API_KEY"),
      mode: configured("JAMBASE_API_KEY") ? "live" : "fixture",
      detail: configured("JAMBASE_API_KEY")
        ? "Event search, catalog identifiers, and live-context evidence enabled."
        : "Using seeded concert and setlist context."
    },
    {
      name: "Cyanite",
      configured: configuredAny("CYANITE_API_TOKEN", "CYANITE_API_KEY"),
      mode: configuredAny("CYANITE_API_TOKEN", "CYANITE_API_KEY") ? "live" : "fixture",
      detail: configuredAny("CYANITE_API_TOKEN", "CYANITE_API_KEY")
        ? configured("CYANITE_WEBHOOK_URL")
          ? "Credential present; analysis requests are enabled and Cyanite completion events route to the configured webhook."
          : "Credential present; analysis requests are enabled and fallbacks are labeled per job."
        : "Using a seeded live-performance profile."
    },
    {
      name: "ElevenLabs",
      configured: configured("ELEVENLABS_API_KEY"),
      mode: configured("ELEVENLABS_API_KEY") ? "live" : "fixture",
      detail: configured("ELEVENLABS_API_KEY")
        ? "Narration endpoint will generate MP3 summaries."
        : "Narration returns a judge-ready script without audio."
    },
    {
      name: "ASR",
      configured: configuredAny("REPLICATE_API_TOKEN", "ASR_API_URL"),
      mode: configuredAny("REPLICATE_API_TOKEN", "ASR_API_URL") ? "live" : "fixture",
      detail: configured("REPLICATE_API_TOKEN")
        ? env.asrCompareAllModels
          ? "Replicate Whisper compares every configured candidate for quality review mode."
          : "Replicate fast Whisper runs first; openai/whisper fallback runs only if fast ASR fails."
        : configured("ASR_API_URL")
          ? "External Whisper-style ASR endpoint configured."
        : "Using seeded transcript for demo resilience."
    }
  ];
}

export function getRuntimeMode(): RuntimeMode {
  const modes = getIntegrationStatus().map((status) => status.mode);
  if (modes.every((mode) => mode === "live")) {
    return "live";
  }
  if (modes.every((mode) => mode === "fixture")) {
    return "fixture";
  }
  return "mixed";
}

export function getHealth(): HealthResponse {
  return {
    appName: APP_NAME,
    version: APP_VERSION,
    runtimeMode: getRuntimeMode(),
    integrations: getIntegrationStatus()
  };
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  const parsed = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed?.length ? parsed : fallback;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (/^(1|true|yes|on)$/i.test(value.trim())) return true;
  if (/^(0|false|no|off)$/i.test(value.trim())) return false;
  return undefined;
}

function normalizeAudioIdProvider(value: string | undefined): "acrcloud" | "custom" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "acrcloud" || normalized === "acr") return "acrcloud";
  if (normalized === "custom" || normalized === "musixmatch") return "custom";
  return undefined;
}
