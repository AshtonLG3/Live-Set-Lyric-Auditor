import type { SourceProvider } from "../shared/types";

export type ParsedLiveSource = {
  provider: SourceProvider;
  label: string;
  normalizedUrl: string;
  embedUrl?: string;
};

export function parseLiveSource(value: string, startSeconds = 0, endSeconds = 30): ParsedLiveSource | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const youtubeId = getYouTubeId(url, host);
    if (youtubeId) {
      const params = new URLSearchParams({
        start: String(Math.max(0, Math.floor(startSeconds))),
        end: String(Math.max(1, Math.floor(endSeconds))),
        playsinline: "1",
        rel: "0"
      });
      return {
        provider: "youtube",
        label: "YouTube",
        normalizedUrl: url.toString(),
        embedUrl: `https://www.youtube.com/embed/${youtubeId}?${params.toString()}`
      };
    }
    if (host === "vimeo.com" || host.endsWith(".vimeo.com")) {
      return { provider: "vimeo", label: "Vimeo", normalizedUrl: url.toString() };
    }
    if (host === "soundcloud.com" || host.endsWith(".soundcloud.com")) {
      return { provider: "soundcloud", label: "SoundCloud", normalizedUrl: url.toString() };
    }
    if (/\.(mp3|wav|m4a|aac|ogg|mp4|mov|webm)(?:$|\?)/i.test(url.toString())) {
      return { provider: "direct_media", label: "Direct media", normalizedUrl: url.toString() };
    }
    return { provider: "other", label: host, normalizedUrl: url.toString() };
  } catch {
    return null;
  }
}

export function formatSourceTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

function getYouTubeId(url: URL, host: string): string | null {
  if (host === "youtu.be") return cleanYouTubeId(url.pathname.split("/").filter(Boolean)[0]);
  if (host !== "youtube.com" && !host.endsWith(".youtube.com")) return null;
  if (url.pathname === "/watch") return cleanYouTubeId(url.searchParams.get("v"));
  const parts = url.pathname.split("/").filter(Boolean);
  if (["embed", "shorts", "live"].includes(parts[0] ?? "")) return cleanYouTubeId(parts[1]);
  return null;
}

function cleanYouTubeId(value?: string | null): string | null {
  return value && /^[A-Za-z0-9_-]{6,15}$/.test(value) ? value : null;
}
