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
  lalalKey: process.env.LALAL_LICENSE_KEY,
  lalalBaseUrl: process.env.LALAL_API_BASE_URL ?? "https://www.lalal.ai/api/v1",
  elevenlabsKey: process.env.ELEVENLABS_API_KEY,
  elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb",
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
        ? "Vocal isolation adapter will attempt live splitting."
        : "Using fixture vocal isolation result."
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
        ? "Energy, mood, BPM, instrument, and arrangement profiling enabled."
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
      configured: configured("ASR_API_URL"),
      mode: configured("ASR_API_URL") ? "live" : "fixture",
      detail: configured("ASR_API_URL")
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
