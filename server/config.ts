import { APP_NAME, APP_VERSION } from "../shared/version";
import type { HealthResponse, IntegrationStatus, RuntimeMode } from "../shared/types";

const configured = (name: string) => Boolean(process.env[name]?.trim());
const configuredAny = (...names: string[]) => names.some(configured);

export const env = {
  host: process.env.HOST?.trim() || "0.0.0.0",
  port: Number(process.env.PORT ?? 4242),
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
  elevenlabsKey: process.env.ELEVENLABS_API_KEY,
  elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb",
  replicateToken: process.env.REPLICATE_API_TOKEN,
  replicateWhisperVersion: process.env.REPLICATE_WHISPER_VERSION
    ?? "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c",
  replicateWhisperFallbackVersion: process.env.REPLICATE_WHISPER_FALLBACK_VERSION
    ?? "openai/whisper:91ee9c0c3df30478510ff8c8a3a545add1ad0259ad3a9f78fba57fbc05ee64f7",
  pythonCommand: process.env.PYTHON_COMMAND?.trim() || "python",
  ffmpegLocation: process.env.FFMPEG_LOCATION?.trim(),
  youtubeExtractTimeoutMs: Math.max(30_000, Number(process.env.YOUTUBE_EXTRACT_TIMEOUT_MS ?? 120_000)),
  cyanitePollIntervalMs: Math.max(1_000, Number(process.env.CYANITE_POLL_INTERVAL_MS ?? 2_500)),
  cyanitePollTimeoutMs: Math.max(30_000, Number(process.env.CYANITE_POLL_TIMEOUT_MS ?? 180_000)),
  asrApiUrl: process.env.ASR_API_URL,
  asrApiKey: process.env.ASR_API_KEY
};

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
      name: "LALAL.AI",
      configured: configured("LALAL_LICENSE_KEY"),
      mode: configured("LALAL_LICENSE_KEY") ? "live" : "fixture",
      detail: configured("LALAL_LICENSE_KEY")
        ? "Activation key configured; upload, vocal splitting, and result polling enabled."
        : "Real uploads use original audio; seeded demos use fixture isolation."
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
        ? "Replicate Whisper transcription configured with a pinned fallback model."
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
