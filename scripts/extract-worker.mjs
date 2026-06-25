// Live-link extraction worker — run this on a machine with a residential IP (your laptop,
// a home box, a Pi) so the hosted app can extract YouTube/Vimeo/Twitch clips from an IP those
// hosts trust. The hosted app POSTs {url, start, end} here; this runs yt-dlp and returns the mp3.
//
// Requires: Node 20+, Python with yt-dlp (`py -m yt_dlp` on Windows or `python3 -m yt_dlp`), and ffmpeg on PATH.
//
// Run it:
//   $env:EXTRACT_WORKER_TOKEN = "pick-a-long-random-secret"      # PowerShell
//   $env:YT_COOKIES_FROM_BROWSER = "firefox"                     # optional, helps YouTube bot/login checks
//   node scripts/extract-worker.mjs
// Then expose it with a stable tunnel:
//   ngrok http --domain=uptown-slush-ice.ngrok-free.dev 8745
// Finally, in Replit Secrets set:
//   EXTRACT_WORKER_URL  = https://uptown-slush-ice.ngrok-free.dev
//   EXTRACT_WORKER_TOKEN = <the same secret as above>
// Stop the tunnel + this script when judging ends.

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 8745);
const TOKEN = (process.env.EXTRACT_WORKER_TOKEN ?? "").trim();
const DEFAULT_PYTHON = process.platform === "win32" ? "py" : "python3";
const PYTHON = (process.env.PYTHON_COMMAND ?? DEFAULT_PYTHON).trim();
const YT_COOKIES_FILE = (process.env.YT_COOKIES_FILE ?? "").trim();
const YT_COOKIES_FROM_BROWSER = (process.env.YT_COOKIES_FROM_BROWSER ?? "").trim();
const MAX_RANGE_SECONDS = 60;

// Only these hosts may be fetched — a yt-dlp run on an arbitrary URL would be an SSRF hole.
const ALLOWED_HOSTS = [/(^|\.)youtube\.com$/, /^youtu\.be$/, /(^|\.)vimeo\.com$/, /(^|\.)twitch\.tv$/];

function isAllowed(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return ALLOWED_HOSTS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

function cookieArgs() {
  if (YT_COOKIES_FILE) return ["--cookies", YT_COOKIES_FILE];
  if (YT_COOKIES_FROM_BROWSER) return ["--cookies-from-browser", YT_COOKIES_FROM_BROWSER];
  return [];
}

function runYtDlp(url, start, end, outputPath) {
  const args = [
    "-m", "yt_dlp",
    // Do not let a user's global yt-dlp config force a video-only or unavailable format.
    "--ignore-config",
    "--no-playlist", "--no-warnings",
    ...cookieArgs(),
    // Force an audio-capable format. Some YouTube videos do not satisfy yt-dlp's default
    // format choice after cookies/client changes, which shows up as "Requested format is not available".
    "-f", "bestaudio[acodec!=none]/best[acodec!=none]/best",
    "--download-sections", `*${start}-${end}`, "--force-keyframes-at-cuts",
    "-x", "--audio-format", "mp3", "--audio-quality", "5",
    "-o", outputPath, url
  ];
  return new Promise((resolve, reject) => {
    execFile(PYTHON, args, { timeout: 90_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, _stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).slice(0, 400)));
      else resolve();
    });
  });
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/extract")) {
    res.writeHead(404).end("not found");
    return;
  }
  if (!TOKEN || req.headers["x-worker-token"] !== TOKEN) {
    res.writeHead(401).end("unauthorized");
    return;
  }
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 8192) req.destroy();
  });
  req.on("end", async () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400).end("invalid json");
      return;
    }
    const { url } = payload;
    const start = Math.max(0, Number(payload.start) || 0);
    const end = Number(payload.end);
    if (!isAllowed(url)) {
      res.writeHead(400).end("unsupported url");
      return;
    }
    if (!Number.isFinite(end) || end <= start || end - start > MAX_RANGE_SECONDS) {
      res.writeHead(400).end("invalid range");
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), "lsla-worker-"));
    const outputPath = join(directory, "excerpt.mp3");
    try {
      await runYtDlp(url, start, end, outputPath);
      const buffer = await readFile(outputPath);
      if (buffer.length === 0) throw new Error("empty excerpt");
      res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": buffer.length }).end(buffer);
      console.log(`ok  ${url}  ${start}-${end}s  ->  ${buffer.length} bytes`);
    } catch (error) {
      const detail = String(error?.message ?? error).slice(0, 300);
      console.error(`err ${url}  ${start}-${end}s  ->  ${detail}`);
      res.writeHead(502).end(detail);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

if (!TOKEN) {
  console.error("Refusing to start without EXTRACT_WORKER_TOKEN set (it is the only thing stopping the public internet from using your machine to run yt-dlp).");
  process.exit(1);
}

const cookieSource = YT_COOKIES_FILE ? `cookies file ${YT_COOKIES_FILE}` : (YT_COOKIES_FROM_BROWSER ? `browser cookies ${YT_COOKIES_FROM_BROWSER}` : "no cookies");
server.listen(PORT, () => console.log(`Live-link extraction worker listening on http://localhost:${PORT} (${cookieSource})`));
