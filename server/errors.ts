import express from "express";
import multer from "multer";
import { MAX_IMPORT_BYTES } from "../shared/version";
import { MediaProbeError } from "./services/media";

// An error whose message is intentional and safe to show the user. The analysis
// pipeline composes precise, actionable failure reasons (e.g. "Whisper fallback
// retry failed: ..."); without a marker like this the generic handler below would
// replace them with "Unexpected server error.", making real failures look silent.
export class PublicError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
    this.name = "PublicError";
  }
}

export function apiErrorHandler(
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction
): void {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: `Clip is larger than ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB.` });
    return;
  }
  if (error instanceof MediaProbeError) {
    res.status(error.kind === "unavailable" ? 503 : 400).json({ error: error.message });
    return;
  }
  if (error instanceof PublicError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  console.error("Unhandled API error", error);
  res.status(500).json({ error: "Unexpected server error." });
}
