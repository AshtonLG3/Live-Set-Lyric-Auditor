import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ClipSource } from "../../shared/types";
import { env } from "../config";
import { assertYouTubeTooling } from "../services/media";
import { isYouTubeUrl } from "../source-validation";

const execFileAsync = promisify(execFile);

export async function extractYouTubeExcerpt(source: ClipSource): Promise<Express.Multer.File> {
  if (source.kind !== "live_link" || source.provider !== "youtube" || !source.url || !isYouTubeUrl(source.url)) {
    throw new Error("A valid YouTube source is required for provider extraction.");
  }

  const start = Math.max(0, Number(source.startSeconds ?? 0));
  const end = Number(source.endSeconds ?? 0);
  if (!Number.isFinite(end) || end <= start) {
    throw new Error("The YouTube excerpt end must be after its start.");
  }

  const directory = await mkdtemp(join(tmpdir(), "lsla-youtube-"));
  const outputPath = join(directory, "excerpt.mp3");
  try {
    await assertYouTubeTooling();
    await execFileAsync(env.pythonCommand, buildYouTubeExtractArgs(source.url, start, end, outputPath), {
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
      originalname: `youtube-${Math.round(start)}-${Math.round(end)}.mp3`,
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
    const detail = error instanceof Error ? error.message : "unknown extraction error";
    throw new Error(`Could not retrieve the selected YouTube range: ${detail}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function buildYouTubeExtractArgs(url: string, start: number, end: number, outputPath: string): string[] {
  const args = [
    "-m",
    "yt_dlp",
    "--no-playlist",
    "--no-warnings",
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
  args.push(
    "-o",
    outputPath,
    url
  );
  return args;
}
