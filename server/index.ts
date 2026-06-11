import express from "express";
import multer from "multer";
import path from "node:path";
import { env, getHealth } from "./config";
import { searchEvents } from "./adapters/jambase";
import { searchTracks } from "./adapters/musixmatch";
import { createNarration, runAnalysis, runRecallRescue } from "./services/analysis";
import { createJob, jobs } from "./store";
import type { ClipSource, EventCandidate, TrackCandidate } from "../shared/types";
import { MAX_CLIP_BYTES, MAX_CLIP_SECONDS } from "../shared/version";

const isProduction = process.env.NODE_ENV === "production";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_CLIP_BYTES
  }
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

app.post("/api/recall", upload.single("fragment"), async (req, res, next) => {
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

app.post("/api/analyze", upload.single("clip"), async (req, res, next) => {
  try {
    const useFixture = req.body.useFixture === "true";
    const source = parseJsonField<ClipSource>(req.body.source);
    const requestedDuration = Number(req.body.durationSeconds || 0);
    const rangedDuration = source?.startSeconds !== undefined && source.endSeconds !== undefined
      ? source.endSeconds - source.startSeconds
      : 0;
    const durationSeconds = requestedDuration || rangedDuration;
    if (!req.file && !useFixture && source?.kind !== "live_link") {
      res.status(400).json({ error: "Import an audio or video clip before starting analysis." });
      return;
    }
    if (source?.kind === "live_link" && !isSafeSourceUrl(source.url)) {
      res.status(400).json({ error: "Enter a valid HTTP or HTTPS live-performance link." });
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
    if (durationSeconds > MAX_CLIP_SECONDS) {
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
      source
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/analyze/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Analysis job not found." });
    return;
  }
  res.json(job);
});

app.post("/api/narrate/:jobId", async (req, res, next) => {
  try {
    res.json(await createNarration(req.params.jobId));
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected server error";
  const status = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? 413 : 500;
  res.status(status).json({ error: status === 413 ? "Clip is larger than 40 MB." : message });
});

if (isProduction) {
  const clientDist = path.resolve(process.cwd(), "dist/client");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

app.listen(env.port, () => {
  console.log(`Live-Set Lyric Auditor listening on http://localhost:${env.port}`);
});

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

function isSafeSourceUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
