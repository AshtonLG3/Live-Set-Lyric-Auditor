import type { ClipSource } from "../shared/types";
import { detectLiveLinkProvider } from "../shared/live-link";

export { detectLiveLinkProvider };

export function isAllowedLiveSource(source?: ClipSource): boolean {
  if (source?.kind !== "live_link" || !source.url) return false;
  const provider = detectLiveLinkProvider(source.url);
  if (!provider) return false;
  // A declared provider must match the URL's actual host, so a "youtube" source can never
  // smuggle in a non-YouTube (or internal) URL past this check.
  return source.provider === undefined || source.provider === provider;
}

export function isYouTubeUrl(value: string | URL): boolean {
  return detectLiveLinkProvider(value) === "youtube";
}
