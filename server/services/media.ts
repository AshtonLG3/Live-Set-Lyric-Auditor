import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import type { ClipSource } from "../../shared/types";
import { env } from "../config";

const execFileAsync = promisify(execFile);

export class MediaProbeError extends Error {
  constructor(message: string, readonly kind: "unavailable" | "invalid") {
    super(message);
  }
}

export async function probeMediaDuration(file: Express.Multer.File): Promise<number> {
  const directory = await mkdtemp(join(tmpdir(), "lsla-probe-"));
  const extension = extname(file.originalname).replace(/[^.a-z0-9]/gi, "") || ".media";
  const inputPath = join(directory, `clip${extension}`);
  try {
    await writeFile(inputPath, file.buffer);
    const { stdout } = await execFileAsync(resolveFfmpegTool("ffprobe"), buildFfprobeArgs(inputPath), {
      timeout: 30_000,
      maxBuffer: 256 * 1024,
      windowsHide: true
    });
    const duration = Number(String(stdout).trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new MediaProbeError("Could not read the clip duration. Use a playable audio or video file.", "invalid");
    }
    return duration;
  } catch (error) {
    if (error instanceof MediaProbeError) throw error;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      throw new MediaProbeError("Server media validation needs ffprobe. Install ffmpeg or configure FFMPEG_LOCATION.", "unavailable");
    }
    throw new MediaProbeError("Could not read the clip duration. Use a playable audio or video file.", "invalid");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function transcodeMediaToMp3(file: Express.Multer.File, label = "clip"): Promise<Express.Multer.File> {
  const directory = await mkdtemp(join(tmpdir(), `lsla-${label}-`));
  const extension = extname(file.originalname).replace(/[^.a-z0-9]/gi, "") || ".media";
  const inputPath = join(directory, `source${extension}`);
  const outputPath = join(directory, "profile.mp3");
  try {
    await writeFile(inputPath, file.buffer);
    await execFileAsync(resolveFfmpegTool("ffmpeg"), buildTranscodeToMp3Args(inputPath, outputPath), {
      timeout: 45_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    });
    const buffer = await readFile(outputPath);
    if (buffer.length === 0) {
      throw new MediaProbeError("Cyanite profiling could not create an MP3 excerpt from this clip.", "invalid");
    }
    return {
      ...file,
      originalname: file.originalname.replace(/\.[^.]+$/, "") + ".mp3",
      mimetype: "audio/mpeg",
      size: buffer.length,
      buffer
    };
  } catch (error) {
    if (error instanceof MediaProbeError) throw error;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      throw new MediaProbeError("Cyanite profiling needs ffmpeg to convert this clip to MP3.", "unavailable");
    }
    throw new MediaProbeError("Cyanite profiling could not convert this clip to MP3.", "invalid");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function trimMediaExcerptToMp3(file: Express.Multer.File, startSeconds: number, endSeconds: number): Promise<Express.Multer.File> {
  const start = Math.max(0, startSeconds);
  const duration = Math.max(0, endSeconds - start);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new MediaProbeError("The selected clip end must be after its start.", "invalid");
  }

  const directory = await mkdtemp(join(tmpdir(), "lsla-trim-"));
  const extension = extname(file.originalname).replace(/[^.a-z0-9]/gi, "") || ".media";
  const inputPath = join(directory, `source${extension}`);
  const outputPath = join(directory, "excerpt.mp3");
  try {
    await writeFile(inputPath, file.buffer);
    await execFileAsync(resolveFfmpegTool("ffmpeg"), buildTrimToMp3Args(inputPath, outputPath, start, duration), {
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    });
    const buffer = await readFile(outputPath);
    if (buffer.length === 0) {
      throw new MediaProbeError("Clip trimming returned an empty excerpt.", "invalid");
    }
    return {
      ...file,
      originalname: file.originalname.replace(/\.[^.]+$/, "") + `-${Math.round(start)}-${Math.round(endSeconds)}.mp3`,
      mimetype: "audio/mpeg",
      size: buffer.length,
      buffer
    };
  } catch (error) {
    if (error instanceof MediaProbeError) throw error;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      throw new MediaProbeError("Server clip trimming needs ffmpeg. Install ffmpeg or configure FFMPEG_LOCATION.", "unavailable");
    }
    throw new MediaProbeError("Could not trim the selected clip excerpt.", "invalid");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function assertYouTubeTooling(): Promise<void> {
  try {
    await execFileAsync(env.pythonCommand, ["-m", "yt_dlp", "--version"], {
      timeout: 15_000,
      maxBuffer: 256 * 1024,
      windowsHide: true
    });
    await Promise.all((["ffmpeg", "ffprobe"] as const).map((tool) => execFileAsync(resolveFfmpegTool(tool), ["-version"], {
      timeout: 15_000,
      maxBuffer: 256 * 1024,
      windowsHide: true
    })));
  } catch {
    throw new Error("YouTube range extraction needs yt-dlp, ffmpeg, and ffprobe. Install them or attach an authorized excerpt instead.");
  }
}

export function resolveAnalysisDuration(input: {
  fileDuration?: number;
  source?: ClipSource;
  requestedDuration?: number;
}): number | undefined {
  if (input.source?.startSeconds !== undefined && input.source.endSeconds !== undefined) {
    return input.source.endSeconds - input.source.startSeconds;
  }
  if (input.fileDuration && Number.isFinite(input.fileDuration)) return input.fileDuration;
  return input.requestedDuration && Number.isFinite(input.requestedDuration) ? input.requestedDuration : undefined;
}

export function buildFfprobeArgs(inputPath: string): string[] {
  return [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    inputPath
  ];
}

export function buildTranscodeToMp3Args(inputPath: string, outputPath: string): string[] {
  return [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-acodec",
    "libmp3lame",
    "-q:a",
    "5",
    outputPath
  ];
}

export function buildTrimToMp3Args(inputPath: string, outputPath: string, startSeconds: number, durationSeconds: number): string[] {
  return [
    "-y",
    "-ss",
    formatFfmpegSeconds(startSeconds),
    "-i",
    inputPath,
    "-t",
    formatFfmpegSeconds(durationSeconds),
    "-vn",
    "-acodec",
    "libmp3lame",
    "-q:a",
    "5",
    outputPath
  ];
}

export function resolveFfmpegTool(tool: "ffmpeg" | "ffprobe"): string {
  const location = env.ffmpegLocation;
  if (!location) return tool;
  const name = basename(location).toLowerCase();
  if (name.startsWith("ffmpeg") || name.startsWith("ffprobe")) {
    const extension = extname(location);
    return join(dirname(location), `${tool}${extension}`);
  }
  return join(location, process.platform === "win32" ? `${tool}.exe` : tool);
}

function formatFfmpegSeconds(value: number): string {
  return Math.max(0, value).toFixed(3).replace(/\.?0+$/, "");
}
