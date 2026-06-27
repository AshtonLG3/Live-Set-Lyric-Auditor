import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ClipSource } from "../../shared/types";
import { env } from "../config";
import { assertYouTubeTooling } from "../services/media";
import { detectLiveLinkProvider } from "../source-validation";
import { fetchWithTimeout } from "./timeout";

const execFileAsync = promisify(execFile);

type YouTubeExtractOptions = {
  cookiesFile?: string;
};

export async function extractProviderExcerpt(source: ClipSource): Promise<Express.Multer.File> {
  const provider = source.kind === "live_link" && source.url ? detectLiveLinkProvider(source.url) : null;
  if (!source.url || !provider || (source.provider && source.provider !== provider)) {
    throw new Error("A supported, authorized live-link URL (YouTube, Vimeo, or Twitch) is required for provider extraction.");
  }

  const start = Math.max(0, Number(source.startSeconds ?? 0));
  const end = Number(source.endSeconds ?? 0);
  if (!Number.isFinite(end) || end <= start) {
    throw new Error("The YouTube excerpt end must be after its start.");
  }

  // When a residential-IP extraction worker is configured (e.g. for a hosted demo whose
  // datacenter IP YouTube blocks), delegate the actual yt-dlp run to it. Everything downstream
  // is identical — the worker just returns the mp3 from an IP YouTube trusts.
  if (env.extractWorkerUrl) {
    return extractViaWorker(env.extractWorkerUrl, source.url, provider, start, end);
  }

  const directory = await mkdtemp(join(tmpdir(), "lsla-youtube-"));
  const outputPath = join(directory, "excerpt.mp3");
  try {
    await assertYouTubeTooling();
    const cookiesFile = await prepareYouTubeCookiesFile(directory);
    await execFileAsync(env.pythonCommand, buildYouTubeExtractArgs(source.url, start, end, outputPath, { cookiesFile }), {
      timeout: env.youtubeExtractTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    });
    const buffer = await readFile(outputPath);
    if (buffer.length === 0) {
      throw new Error("YouTube extraction returned an empty excerpt.");
    }
    return {
      fieldname: "clip",
      originalname: `${provider}-${Math.round(start)}-${Math.round(end)}.mp3`,
      encoding: "7bit",
      mimetype: "audio/mpeg",
      size: buffer.length,
      buffer,
      stream: undefined as never,
      destination: "",
      filename: "",
      path: ""
    };
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(`Could not retrieve the selected ${provider} range: extraction timed out after ${Math.round(env.youtubeExtractTimeoutMs / 1000)} seconds. Attach an authorized excerpt instead.`);
    }
    throw new Error(`Could not retrieve the selected ${provider} range: ${describeYouTubeExtractionFailure(error, hasConfiguredYouTubeCookies())}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function extractViaWorker(workerUrl: string, url: string, provider: string, start: number, end: number): Promise<Express.Multer.File> {
  const response = await fetchWithTimeout(
    `${workerUrl.replace(/\/+$/, "")}/extract`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-token": env.extractWorkerToken ?? "" },
      body: JSON.stringify({ url, start, end, provider })
    },
    120_000,
    `Could not retrieve the selected ${provider} range: the extraction worker timed out. Attach an authorized excerpt instead.`
  );
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim().slice(0, 200);
    throw new Error(`Could not retrieve the selected ${provider} range: extraction worker returned ${response.status}${detail ? ` (${detail})` : ""}. Attach an authorized excerpt instead.`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("The extraction worker returned an empty excerpt.");
  }
  return {
    fieldname: "clip",
    originalname: `${provider}-${Math.round(start)}-${Math.round(end)}.mp3`,
    encoding: "7bit",
    mimetype: "audio/mpeg",
    size: buffer.length,
    buffer,
    stream: undefined as never,
    destination: "",
    filename: "",
    path: ""
  };
}

export function buildYouTubeExtractArgs(
  url: string,
  start: number,
  end: number,
  outputPath: string,
  options: YouTubeExtractOptions = {}
): string[] {
  const args = [
    "-m",
    "yt_dlp",
    "--ignore-config",
    "--no-playlist",
    "--no-warnings",
    "-f",
    "bestaudio[acodec!=none]/best[acodec!=none]/best",
    "--download-sections",
    `*${start}-${end}`,
    "--force-keyframes-at-cuts",
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "5"
  ];
  if (env.ffmpegLocation) {
    args.push("--ffmpeg-location", env.ffmpegLocation);
  }
  if (options.cookiesFile) {
    args.push("--cookies", options.cookiesFile);
  }
  args.push(
    "-o",
    outputPath,
    url
  );
  return args;
}

export function describeYouTubeExtractionFailure(error: unknown, cookiesConfigured = false): string {
  const output = getExtractorOutput(error);
  if (isYouTubeBotChallenge(output)) {
    return cookiesConfigured
      ? "YouTube rejected the configured cookies for this hosted server. Refresh YOUTUBE_COOKIES_BASE64 or YOUTUBE_COOKIES_FILE in Replit Secrets, then rerun the analysis, or attach an authorized excerpt."
      : "YouTube blocked this hosted server with a sign-in or bot challenge. Add an authorized Netscape cookies.txt as YOUTUBE_COOKIES_BASE64 or YOUTUBE_COOKIES_FILE in Replit Secrets, or attach an authorized excerpt.";
  }

  const detail = cleanExtractorDetail(output);
  return detail || "yt-dlp could not retrieve this range. Attach an authorized excerpt instead.";
}

async function prepareYouTubeCookiesFile(directory: string): Promise<string | undefined> {
  if (env.youtubeCookiesFile) {
    return env.youtubeCookiesFile;
  }

  const cookieText = getYouTubeCookiesText();
  if (!cookieText) {
    return undefined;
  }
  if (!looksLikeNetscapeCookies(cookieText)) {
    throw new Error("YOUTUBE_COOKIES_BASE64 or YOUTUBE_COOKIES must contain a Netscape-format cookies.txt file.");
  }

  const cookiePath = join(directory, "youtube-cookies.txt");
  await writeFile(cookiePath, ensureTrailingNewline(cookieText), { mode: 0o600 });
  return cookiePath;
}

function getYouTubeCookiesText(): string | undefined {
  if (env.youtubeCookiesBase64) {
    return Buffer.from(env.youtubeCookiesBase64.replace(/\s+/g, ""), "base64").toString("utf8");
  }
  return env.youtubeCookies;
}

function hasConfiguredYouTubeCookies(): boolean {
  return Boolean(env.youtubeCookiesFile || env.youtubeCookiesBase64 || env.youtubeCookies);
}

function looksLikeNetscapeCookies(value: string): boolean {
  return value.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return Boolean(trimmed && !trimmed.startsWith("#") && trimmed.split("\t").length >= 7);
  });
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function getExtractorOutput(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error ?? "");
  }
  const record = error as Record<string, unknown>;
  return [record.stderr, record.stdout, record.message]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function isYouTubeBotChallenge(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes("sign in to confirm you're not a bot")
    || (normalized.includes("confirm you") && normalized.includes("not a bot"))
    || normalized.includes("cookies-from-browser")
    || normalized.includes("pass cookies")
    || normalized.includes("http error 429");
}

function cleanExtractorDetail(output: string): string {
  const errorLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("ERROR:"));
  return (errorLine ?? output)
    .replace(/Command failed:[\s\S]*/i, "yt-dlp failed before returning an excerpt.")
    .replace(/https?:\/\/\S+/g, "the YouTube URL")
    .slice(0, 280)
    .trim();
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return record.killed === true || record.signal === "SIGTERM" || String(record.code ?? "").toUpperCase() === "ETIMEDOUT";
}
