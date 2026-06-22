import Replicate from "replicate";
import type { TranscriptSegment } from "../../shared/types";
import { env } from "../config";
import { fixtureRecallTranscript, fixtureTranscript } from "../data/fixtures";
import { assessVocalTranscript } from "../services/vocal-quality";
import { fetchWithTimeout } from "./timeout";

export type TranscriptionResult = {
  source: "replicate" | "external" | "fixture";
  engine?: string;
  segments: TranscriptSegment[];
};

export type TranscriptionOptions = {
  slowFallback?: boolean;
  slowOnly?: boolean;
  timeoutMs?: number;
};

type ExternalSegment = {
  id?: string;
  start?: number;
  end?: number;
  text?: string;
  confidence?: number;
  avg_logprob?: number;
};

type ReplicateAudioInput = string | Blob | Buffer;

type ReplicateCandidate = {
  version: string;
  index: number;
  segments: TranscriptSegment[];
  score: number;
  status: ReturnType<typeof assessVocalTranscript>["status"];
};

const replicateVersionCooldowns = new Map<string, number>();
const ESTIMATED_SEGMENT_CONFIDENCE = 0.62;

export async function transcribeLiveVocal(
  file?: Express.Multer.File,
  vocalUrl?: string,
  options: TranscriptionOptions = {}
): Promise<TranscriptionResult> {
  return transcribe(file, fixtureTranscript, vocalUrl, options);
}

export async function transcribeRecallFragment(file?: Express.Multer.File, options: TranscriptionOptions = {}): Promise<TranscriptionResult> {
  return transcribe(file, fixtureRecallTranscript, undefined, options);
}

async function transcribe(
  file: Express.Multer.File | undefined,
  fixtureSegments: TranscriptSegment[],
  vocalUrl?: string,
  options: TranscriptionOptions = {}
): Promise<TranscriptionResult> {
  if (!file && !vocalUrl) {
    return { source: "fixture", segments: fixtureSegments };
  }

  if (!env.replicateToken && !env.asrApiUrl) {
    throw new Error("No live speech-to-text provider is configured for this clip.");
  }

  const errors: string[] = [];
  if (env.replicateToken) {
    try {
      const result = await transcribeWithReplicate(file, vocalUrl, options);
      return { source: "replicate", engine: result.engine, segments: result.segments };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Replicate transcription failed");
    }
  }

  if (env.asrApiUrl) try {
    const formData = new FormData();
    if (vocalUrl) {
      const vocalResponse = await fetchWithTimeout(vocalUrl, undefined, env.asrExternalTimeoutMs, `Vocal stem download timed out after ${Math.round(env.asrExternalTimeoutMs / 1000)}s`);
      if (!vocalResponse.ok) {
        throw new Error(`Separated vocal download failed with ${vocalResponse.status}`);
      }
      const vocalBlob = await vocalResponse.blob();
      formData.append("file", vocalBlob, "demucs-vocals.mp3");
    } else if (file) {
      formData.append("file", new Blob([toBlobPart(file.buffer)], { type: file.mimetype || "audio/mpeg" }), file.originalname);
    }
    const response = await fetchWithTimeout(env.asrApiUrl, {
      method: "POST",
      headers: env.asrApiKey ? { Authorization: `Bearer ${env.asrApiKey}` } : undefined,
      body: formData
    }, env.asrExternalTimeoutMs, `External ASR timed out after ${Math.round(env.asrExternalTimeoutMs / 1000)}s`);
    if (!response.ok) {
      throw new Error(`ASR failed with ${response.status}`);
    }
    const json = await response.json();
    const rawSegments: ExternalSegment[] = json.segments ?? [];
    const segments = rawSegments
      .map((segment, index): TranscriptSegment | null => {
        if (typeof segment.text !== "string") {
          return null;
        }
        return {
          id: segment.id ?? `A${index + 1}`,
          start: Number(segment.start ?? index * 4),
          end: Number(segment.end ?? index * 4 + 4),
          text: segment.text,
          confidence: normalizeConfidence(segment.confidence, segment.avg_logprob)
        };
      })
      .filter((segment): segment is TranscriptSegment => segment !== null);
    if (segments.length === 0) {
      throw new Error("External ASR returned no transcript segments");
    }
    return { source: "external", segments };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "External ASR transcription failed");
  }

  throw new Error(`Live transcription failed: ${errors.join("; ")}`);
}

async function transcribeWithReplicate(
  file: Express.Multer.File | undefined,
  vocalUrl?: string,
  options: TranscriptionOptions = {}
): Promise<{ segments: TranscriptSegment[]; engine?: string }> {
  const audio = await initialReplicateAudioInput(file, vocalUrl);
  if (!audio || !env.replicateToken) {
    return { segments: [] };
  }

  const replicate = new Replicate({ auth: env.replicateToken, fileEncodingStrategy: "upload" });
  const versions = (options.slowOnly
    ? [env.replicateWhisperFallbackVersion]
    : [
        env.replicateWhisperVersion,
        ...(options.slowFallback || env.asrCompareAllModels || env.asrSlowFallbackEnabled ? [env.replicateWhisperFallbackVersion] : [])
      ])
    .map((version) => version.trim())
    .filter((version, index, values) => version && values.indexOf(version) === index);

  const firstPass = await runReplicateVersions(replicate, versions, audio, options);
  if (firstPass.segments.length > 0) {
    return { segments: firstPass.segments, engine: firstPass.engine };
  }

  if (vocalUrl && typeof audio === "string" && shouldRetryByDownloading(firstPass.messages)) {
    try {
      const downloaded = await downloadAudioFile(vocalUrl);
      const downloadedResult = await runReplicateVersions(replicate, versions, downloaded, options);
      if (downloadedResult.segments.length > 0) {
        return { segments: downloadedResult.segments, engine: downloadedResult.engine };
      }
      firstPass.messages.push(...downloadedResult.messages.map((message) => `downloaded stem: ${message}`));
    } catch (error) {
      firstPass.messages.push(`downloaded stem retry failed: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }

  throw new Error(`Replicate Whisper failed: ${firstPass.messages.join("; ")}`);
}

async function runReplicateVersions(
  replicate: Replicate,
  versions: string[],
  audio: ReplicateAudioInput,
  options: TranscriptionOptions
): Promise<{ segments: TranscriptSegment[]; engine?: string; messages: string[] }> {
  const messages: string[] = [];
  const candidates: ReplicateCandidate[] = [];

  for (const [index, version] of versions.entries()) {
    const cooldownUntil = replicateVersionCooldowns.get(version) ?? 0;
    if (Date.now() < cooldownUntil) {
      messages.push(`${version} skipped during temporary Replicate rate-limit cooldown`);
      continue;
    }

    const outcome = await runReplicateVersion(replicate, version, index, audio, options);
    messages.push(outcome.message);
    if (outcome.candidate) {
      candidates.push(outcome.candidate);
      if (!env.asrCompareAllModels && outcome.candidate.status !== "failed") {
        return { segments: outcome.candidate.segments, engine: outcome.candidate.version, messages };
      }
    }
  }

  const best = chooseBestCandidate(candidates);
  if (best) {
    return { segments: best.segments, engine: best.version, messages };
  }

  return { segments: [], messages };
}

async function runReplicateVersion(
  replicate: Replicate,
  version: string,
  index: number,
  audio: ReplicateAudioInput,
  options: TranscriptionOptions
): Promise<{ candidate?: ReplicateCandidate; message: string }> {
  try {
    const timeoutMs = options.timeoutMs ?? env.asrReplicateTimeoutMs;
    const output = await withTimeout(
      replicate.run(version as `${string}/${string}` | `${string}/${string}:${string}`, {
        input: replicateInput(version, audio)
      }) as Promise<object>,
      timeoutMs,
      `${version} timed out after ${Math.round(timeoutMs / 1000)}s`
    );
    const segments = parseReplicateOutput(output);
    if (segments.length === 0) {
      return { message: `${version} returned no transcript` };
    }
    const quality = assessVocalTranscript(segments, "original");
    return {
      candidate: {
        version,
        index,
        segments,
        score: quality.score,
        status: quality.status
      },
      message: `${version} scored ${Math.round(quality.score * 100)}%`
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "request failed";
    if (isRateLimitMessage(detail)) {
      replicateVersionCooldowns.set(version, Date.now() + retryDelayMs(detail));
    }
    return { message: `${version}: ${detail}` };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function chooseBestCandidate(candidates: ReplicateCandidate[]): ReplicateCandidate | undefined {
  return [...candidates].sort((a, b) =>
    Number(a.status === "failed") - Number(b.status === "failed") ||
    b.score - a.score ||
    a.index - b.index
  )[0];
}

function shouldRetryByDownloading(errors: string[]): boolean {
  return errors.some((message) => /soundfile|malformed|download|ffmpeg|valid audio|correct format/i.test(message));
}

async function initialReplicateAudioInput(
  file: Express.Multer.File | undefined,
  vocalUrl?: string
): Promise<ReplicateAudioInput | undefined> {
  if (vocalUrl) {
    return shouldDownloadBeforeReplicate(vocalUrl) ? downloadAudioFile(vocalUrl) : vocalUrl;
  }
  return file ? namedAudioFile(file.buffer, file.originalname, file.mimetype) : undefined;
}

function shouldDownloadBeforeReplicate(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return !/\.(mp3|wav|flac|m4a|aac|ogg|opus|webm|mp4|mov)(?:$|\?)/i.test(pathname);
  } catch {
    return false;
  }
}

async function downloadAudioFile(url: string): Promise<Blob> {
  const response = await fetchWithTimeout(url, undefined, env.asrReplicateTimeoutMs, `Audio download timed out after ${Math.round(env.asrReplicateTimeoutMs / 1000)}s`);
  if (!response.ok) {
    throw new Error(`audio download failed with ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("audio download returned an empty file");
  }
  const contentType = response.headers.get("Content-Type") ?? "audio/mpeg";
  return namedAudioFile(bytes, filenameFromUrl(url, contentType), contentType);
}

function replicateInput(version: string, audio: ReplicateAudioInput): Record<string, unknown> {
  if (version.startsWith("openai/whisper")) {
    return {
      audio,
      model: "large-v2",
      transcription: "plain text",
      translate: false,
      temperature: 0
    };
  }

  return {
    audio,
    task: "transcribe",
    timestamp: "chunk",
    batch_size: 24,
    diarise_audio: false
  };
}

function namedAudioFile(buffer: Buffer, filename: string, mimetype?: string): Blob {
  const name = ensureAudioFilename(filename, mimetype);
  const bytes = toBlobPart(buffer);
  if (typeof File !== "undefined") {
    return new File([bytes], name, { type: mimetype || mimeTypeFromFilename(name) });
  }
  const blob = new Blob([bytes], { type: mimetype || mimeTypeFromFilename(name) }) as Blob & { name?: string };
  Object.defineProperty(blob, "name", { value: name });
  return blob;
}

function ensureAudioFilename(filename: string, mimetype?: string): string {
  const sanitized = (filename || "live-vocal").replace(/[\\/:*?"<>|\r\n]/g, "_");
  if (/\.(mp3|wav|flac|m4a|aac|ogg|opus|webm|mp4|mov)$/i.test(sanitized)) {
    return sanitized;
  }
  return `${sanitized.replace(/\.+$/, "") || "live-vocal"}${extensionFromMimeType(mimetype)}`;
}

function filenameFromUrl(url: string, contentType?: string): string {
  try {
    const leaf = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "demucs-vocals";
    return ensureAudioFilename(leaf, contentType);
  } catch {
    return ensureAudioFilename("demucs-vocals", contentType);
  }
}

function extensionFromMimeType(mimetype?: string): string {
  const normalized = mimetype?.split(";")[0]?.trim().toLowerCase();
  if (normalized === "audio/wav" || normalized === "audio/x-wav") return ".wav";
  if (normalized === "audio/flac") return ".flac";
  if (normalized === "audio/mp4" || normalized === "audio/m4a") return ".m4a";
  if (normalized === "audio/aac") return ".aac";
  if (normalized === "audio/ogg" || normalized === "video/ogg") return ".ogg";
  if (normalized === "audio/webm" || normalized === "video/webm") return ".webm";
  if (normalized === "video/mp4") return ".mp4";
  if (normalized === "video/quicktime") return ".mov";
  return ".mp3";
}

function mimeTypeFromFilename(filename: string): string {
  if (/\.wav$/i.test(filename)) return "audio/wav";
  if (/\.flac$/i.test(filename)) return "audio/flac";
  if (/\.m4a$/i.test(filename)) return "audio/m4a";
  if (/\.aac$/i.test(filename)) return "audio/aac";
  if (/\.ogg$/i.test(filename)) return "audio/ogg";
  if (/\.opus$/i.test(filename)) return "audio/ogg";
  if (/\.webm$/i.test(filename)) return "audio/webm";
  if (/\.mp4$/i.test(filename)) return "video/mp4";
  if (/\.mov$/i.test(filename)) return "video/quicktime";
  return "audio/mpeg";
}

function isRateLimitMessage(message: string): boolean {
  return /429|too many requests|rate limit|throttled|less than \$5 in credit/i.test(message);
}

function retryDelayMs(message: string): number {
  const retryAfter = /retry_after["']?\s*:\s*(\d+)/i.exec(message)?.[1];
  const seconds = retryAfter ? Number(retryAfter) : 30;
  return Math.max(2_000, Math.min(60_000, (Number.isFinite(seconds) ? seconds : 30) * 1_000));
}

function parseReplicateOutput(output: object): TranscriptSegment[] {
  const record = asRecord(output);
  const rawSegments = Array.isArray(record.chunks)
    ? record.chunks
    : Array.isArray(record.segments)
      ? record.segments
      : [];
  const segments = rawSegments
    .map((value, index): TranscriptSegment | null => {
      const segment = asRecord(value);
      const timestamp = Array.isArray(segment.timestamp) ? segment.timestamp : [];
      const text = typeof segment.text === "string" ? segment.text.trim() : "";
      if (!text) {
        return null;
      }
      return {
        id: typeof segment.id === "string" ? segment.id : `R${index + 1}`,
        start: finiteNumber(segment.start, timestamp[0], index * 4),
        end: finiteNumber(segment.end, timestamp[1], index * 4 + 4),
        text,
        confidence: normalizeConfidence(
          typeof segment.confidence === "number" ? segment.confidence : undefined,
          typeof segment.avg_logprob === "number" ? segment.avg_logprob : undefined
        )
      };
    })
    .filter((segment): segment is TranscriptSegment => segment !== null);

  const cleanedSegments = filterNoiseSegments(segments);
  if (cleanedSegments.length > 0) {
    return cleanedSegments;
  }

  const text = [record.text, record.transcription]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  return text
    ? [{ id: "R1", start: 0, end: 4, text: text.trim(), confidence: ESTIMATED_SEGMENT_CONFIDENCE }]
    : [];
}

function filterNoiseSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const filtered = segments.filter((segment) => {
    const normalized = normalizeText(segment.text);
    if (segment.confidence > 0.75) return true;
    return !knownNoisePhrases.some((phrase) => normalized === phrase || normalized.includes(phrase));
  });
  return filtered.length > 0 ? filtered : segments;
}

const knownNoisePhrases = [
  "okay heres this one",
  "okay here is this one",
  "thanks for watching",
  "thank you for watching",
  "dont forget to subscribe",
  "please subscribe",
  "like and subscribe"
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function finiteNumber(...values: unknown[]): number {
  const value = values.find((candidate) => typeof candidate === "number" && Number.isFinite(candidate));
  return typeof value === "number" ? value : 0;
}

function toBlobPart(buffer: Buffer): BlobPart {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) as unknown as BlobPart;
}

function normalizeConfidence(confidence?: number, avgLogprob?: number): number {
  if (typeof confidence === "number") {
    return Math.max(0.1, Math.min(0.99, confidence));
  }
  if (typeof avgLogprob === "number") {
    return Math.max(0.1, Math.min(0.99, 1 + avgLogprob));
  }
  return ESTIMATED_SEGMENT_CONFIDENCE;
}
