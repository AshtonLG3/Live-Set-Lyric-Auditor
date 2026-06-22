import type { SourceProvider } from "./types";

const PROVIDER_HOSTS: Array<{ provider: SourceProvider; hosts: string[] }> = [
  { provider: "youtube", hosts: ["youtube.com", "youtu.be"] },
  { provider: "vimeo", hosts: ["vimeo.com"] },
  { provider: "twitch", hosts: ["twitch.tv"] },
  { provider: "soundcloud", hosts: ["soundcloud.com"] }
];

// Shared by client and server. Identify which supported provider a live link points at,
// enforcing https, no embedded credentials, and EXACT host-or-subdomain matching. Lookalikes
// ("youtube.com.attacker.example") and internal addresses ("169.254.169.254") return null, so
// they are never offered for extraction in the UI nor fetched by the server.
export function detectLiveLinkProvider(value: string | URL): SourceProvider | null {
  try {
    const url = typeof value === "string" ? new URL(value) : value;
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    for (const { provider, hosts } of PROVIDER_HOSTS) {
      if (hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
        return provider;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export const SUPPORTED_LIVE_LINK_PROVIDERS = PROVIDER_HOSTS.map((entry) => entry.provider);
