import type { ClipSource } from "../shared/types";

export function isAllowedLiveSource(source?: ClipSource): boolean {
  if (source?.kind !== "live_link" || !source.url) return false;
  try {
    const url = new URL(source.url);
    if (!isHttpUrl(url) || url.username || url.password) return false;
    return source.provider === "youtube" ? isYouTubeUrl(url) : true;
  } catch {
    return false;
  }
}

export function isYouTubeUrl(value: string | URL): boolean {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return hostname === "youtu.be" || hostname === "youtube.com" || hostname.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:";
}
