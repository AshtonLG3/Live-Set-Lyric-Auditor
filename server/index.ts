import express from "express";
import multer from "multer";
import path from "node:path";
import rateLimit from "express-rate-limit";
import { env, getHealth } from "./config";
import { searchEvents } from "./adapters/jambase";
import { searchTracks } from "./adapters/musixmatch";
import { createNarration, reanchorAnalysis, runAnalysis, runRecallRescue } from "./services/analysis";
import { createJob, jobMedia, jobs } from "./store";
import { addJobSubscriber } from "./sse";
import type { ClipSource, EventCandidate, TrackCandidate, TranscriptSegment } from "../shared/types";
import { MAX_CLIP_BYTES, MAX_CLIP_SECONDS } from "../shared/version";
import { MediaProbeError, probeMediaDuration, resolveAnalysisDuration } from "./services/media";
import { isAllowedLiveSource } from "./source-validation";

const isProduction = process.env.NODE_ENV === "production";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_CLIP_BYTES
  }
});

const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Try again in a minute." }
});

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json(getHealth());
});

app.get("/api/music/search", async (req, res, next) => {
  try {
    const query = String(req.query.q ?? "").trim();
    if (!query) {
      res.json({ tracks: [] });
      return;
    }
    res.json({ tracks: await searchTracks(query) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/events/search", async (req, res, next) => {
  try {
    res.json({
      events: await searchEvents({
        artist: String(req.query.artist ?? ""),
        city: String(req.query.city ?? ""),
        date: String(req.query.date ?? "")
      })
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recall", mutationLimiter, upload.single("fragment"), async (req, res, next) => {
  try {
    const phrase = String(req.body.phrase ?? "").trim();
    if (!req.file && !phrase) {
      res.status(400).json({ error: "Record a fragment or enter the words you remember." });
      return;
    }
    if (req.file && !isSupportedClip(req.file)) {
      res.status(415).json({ error: "Unsupported recording type." });
      return;
    }
    res.json(await runRecallRescue(req.file, phrase));
  } catch (error) {
    next(error);
  }
});

app.post("/api/analyze", mutationLimiter, upload.single("clip"), async (req, res, next) => {
  try {
    const useFixture = req.body.useFixture === "true";
    const source = parseJsonField<ClipSource>(req.body.source);
    const recallSegments = parseTranscriptSegments(req.body.recallSegments);
    const hasRecallTranscript = source?.kind === "recall_recording" && recallSegments.length > 0;
    const canUseProviderExtraction = source?.kind === "live_link"
      && source.provider === "youtube"
      && source.processingMode === "provider_excerpt"
      && env.youtubeExtractionEnabled;
    const requestedDuration = Number(req.body.durationSeconds || 0);
    const rangedDuration = source?.startSeconds !== undefined && source.endSeconds !== undefined
      ? source.endSeconds - source.startSeconds
      : 0;
    if (source?.kind === "live_link" && source.processingMode === "provider_excerpt" && !canUseProviderExtraction) {
      res.status(400).json({ error: "YouTube extraction is unavailable on this server. Attach an authorized excerpt instead." });
      return;
    }
    if (!req.file && !useFixture && !canUseProviderExtraction && !hasRecallTranscript) {
      res.status(400).json({
        error: source?.kind === "live_link"
          ? "Attach an authorized audio or video excerpt before starting analysis."
          : "Import an audio or video clip before starting analysis."
      });
      return;
    }
    if (source?.kind === "live_link" && !isAllowedLiveSource(source)) {
      res.status(400).json({ error: source.provider === "youtube" ? "Enter a valid YouTube performance URL." : "Enter a valid HTTP or HTTPS live-performance link." });
      return;
    }
    if (source?.kind === "live_link" && rangedDuration <= 0) {
      res.status(400).json({ error: "The clip end must be after its start." });
      return;
    }
    if (req.file && !isSupportedClip(req.file)) {
      res.status(415).json({ error: "Unsupported clip type. Use MP3, WAV, M4A, AAC, OGG, MP4, MOV, or WebM." });
      return;
    }
    const fileDuration = req.file ? await probeMediaDuration(req.file) : undefined;
    const durationSeconds = resolveAnalysisDuration({ fileDuration, source, requestedDuration });
    if ((durationSeconds ?? 0) > MAX_CLIP_SECONDS) {
      res.status(400).json({ error: `Keep clips under ${MAX_CLIP_SECONDS} seconds.` });
      return;
    }

    const job = createJob();
    res.status(202).json({ jobId: job.id });

    const track = parseJsonField<TrackCandidate>(req.body.track);
    const event = parseJsonField<EventCandidate | null>(req.body.event);
    void runAnalysis(job.id, {
      file: req.file,
      track,
      event,
      trackQuery: req.body.trackQuery,
      eventCity: req.body.eventCity,
      eventDate: req.body.eventDate,
      durationSeconds: durationSeconds || undefined,
      autoMatch: req.body.autoMatch === "true",
      useFixture,
      source,
      recallSegments
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/analyze/:jobId", (req, res) => {
  const job = jobs.get(paramString(req.params.jobId));
  if (!job) {
    res.status(404).json({ error: "Analysis job not found." });
    return;
  }
  res.json(job);
});

app.get("/api/analyze/:jobId/events", (req, res) => {
  const job = jobs.get(paramString(req.params.jobId));
  if (!job) {
    res.status(404).json({ error: "Analysis job not found." });
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.write(`data: ${JSON.stringify(job)}\n\n`);
  if (job.status === "complete" || job.status === "failed") {
    res.end();
    return;
  }
  const cleanup = addJobSubscriber(paramString(req.params.jobId), (updated) => {
    res.write(`data: ${JSON.stringify(updated)}\n\n`);
    if (updated.status === "complete" || updated.status === "failed") {
      res.end();
    }
  });
  req.on("close", cleanup);
});

app.get("/api/analyze/:jobId/media", (req, res) => {
  const media = jobMedia.get(paramString(req.params.jobId));
  if (!media) {
    res.status(404).json({ error: "Analysis media is not available." });
    return;
  }
  const range = req.headers.range;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", media.mimetype);
  res.setHeader("Content-Disposition", `inline; filename="${media.filename.replace(/[\r\n"]/g, "_")}"`);
  if (!range) {
    res.setHeader("Content-Length", media.buffer.length);
    res.end(media.buffer);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const start = match?.[1] ? Number(match[1]) : 0;
  const end = match?.[2] ? Math.min(Number(match[2]), media.buffer.length - 1) : media.buffer.length - 1;
  if (!match || start > end || start >= media.buffer.length) {
    res.status(416).setHeader("Content-Range", `bytes */${media.buffer.length}`).end();
    return;
  }
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${media.buffer.length}`);
  res.setHeader("Content-Length", end - start + 1);
  res.end(media.buffer.subarray(start, end + 1));
});

app.post("/api/analyze/:jobId/reanchor", mutationLimiter, async (req, res, next) => {
  try {
    const track = req.body.track as TrackCandidate | undefined;
    if (!track?.title?.trim() || !track.artist?.trim()) {
      res.status(400).json({ error: "Track title and artist are required." });
      return;
    }
    res.json(await reanchorAnalysis(paramString(req.params.jobId), track, {
      event: req.body.event as EventCandidate | null | undefined,
      eventCity: typeof req.body.eventCity === "string" ? req.body.eventCity : undefined,
      eventDate: typeof req.body.eventDate === "string" ? req.body.eventDate : undefined
    }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/narrate/:jobId", mutationLimiter, async (req, res, next) => {
  try {
    res.json(await createNarration(
      paramString(req.params.jobId),
      Array.isArray(req.body?.manualVariants) ? req.body.manualVariants : [],
      req.body?.editedTexts && typeof req.body.editedTexts === "object" ? req.body.editedTexts : {},
      req.body?.reviewDecisions && typeof req.body.reviewDecisions === "object" ? req.body.reviewDecisions : {}
    ));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "Clip is larger than 40 MB." });
    return;
  }
  if (error instanceof MediaProbeError) {
    res.status(error.kind === "unavailable" ? 503 : 400).json({ error: error.message });
    return;
  }
  console.error("Unhandled API error", error);
  res.status(500).json({ error: "Unexpected server error." });
});

const publicAssets = path.resolve(process.cwd(), "public");

if (isProduction) {
  const clientDist = path.resolve(process.cwd(), "dist/client");
  app.use(express.static(clientDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: {
      host: env.host,
      middlewareMode: true,
      allowedHosts: env.devAllowedHosts
    },
    appType: "spa"
  });
  app.use(express.static(publicAssets));
  app.use(vite.middlewares);
}

app.listen(env.port, env.host, () => {
  console.log(`Live-Set Lyric Auditor listening on http://${env.host}:${env.port}`);
});

function paramString(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function parseJsonField<T>(value: unknown): T | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function isSupportedClip(file: Express.Multer.File): boolean {
  if (file.mimetype.startsWith("audio/") || file.mimetype.startsWith("video/")) {
    return true;
  }
  return /\.(mp3|wav|m4a|aac|ogg|mp4|mov|webm)$/i.test(file.originalname);
}

function isTranscriptSegment(value: unknown): value is TranscriptSegment {
  return Boolean(value && typeof value === "object" && typeof (value as TranscriptSegment).text === "string");
}

function parseTranscriptSegments(value: unknown): TranscriptSegment[] {
  const parsed = parseJsonField<TranscriptSegment[] | TranscriptSegment>(value);
  const values = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return values.filter(isTranscriptSegment);
}
