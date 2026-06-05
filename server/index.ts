import express from "express";
import multer from "multer";
import path from "node:path";
import { env, getHealth } from "./config";
import { searchEvents } from "./adapters/jambase";
import { searchTracks } from "./adapters/musixmatch";
import { createNarration, runAnalysis } from "./services/analysis";
import { createJob, jobs } from "./store";
import type { EventCandidate, TrackCandidate } from "../shared/types";

const isProduction = process.env.NODE_ENV === "production";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024
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

app.post("/api/analyze", upload.single("clip"), async (req, res, next) => {
  try {
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
      eventDate: req.body.eventDate
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
  res.status(500).json({ error: message });
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
