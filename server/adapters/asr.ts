import Replicate from "replicate";
import type { TranscriptSegment } from "../../shared/types";
import { env } from "../config";
import { fixtureRecallTranscript, fixtureTranscript } from "../data/fixtures";
import { assessVocalTranscript } from "../services/vocal-quality";

export type TranscriptionResult = {
  source: "replicate" | "external" | "fixture";
  engine?: string;
  segments: TranscriptSegment[];
};

type ExternalSegment = {
  id?: string;
  start?: number;
  end?: number;
  text?: string;
  confidence?: number;
  avg_logprob?: number;
};

export async function transcribeLiveVocal(file?: Express.Multer.File, vocalUrl?: string): Promise<TranscriptionResult> {
  return transcribe(file, fixtureTranscript, vocalUrl);
}

export async function transcribeRecallFragment(file?: Express.Multer.File): Promise<TranscriptionResult> {
  return transcribe(file, fixtureRecallTranscript);
}

async function transcribe(
  file: Express.Multer.File | undefined,
  fixtureSegments: TranscriptSegment[],
  vocalUrl?: string
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
      const result = await transcribeWithReplicate(file, vocalUrl);
      return { source: "replicate", engine: result.engine, segments: result.segments };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Replicate transcription failed");
    }
  }

  if (env.asrApiUrl) try {
    const formData = new FormData();
    if (vocalUrl) {
      const vocalResponse = await fetch(vocalUrl);
      if (!vocalResponse.ok) {
        throw new Error(`Separated vocal download failed with ${vocalResponse.status}`);
      }
      const vocalBlob = await vocalResponse.blob();
      formData.append("file", vocalBlob, "lalal-vocals.mp3");
    } else if (file) {
      formData.append("file", new Blob([toBlobPart(file.buffer)], { type: file.mimetype || "audio/mpeg" }), file.originalname);
    }
    const response = await fetch(env.asrApiUrl, {
      method: "POST",
      headers: env.asrApiKey ? { Authorization: `Bearer ${env.asrApiKey}` } : undefined,
      body: formData
    });
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
  vocalUrl?: string
): Promise<{ segments: TranscriptSegment[]; engine?: string }> {
  const audio = vocalUrl || file?.buffer;
  if (!audio || !env.replicateToken) {
    return { segments: [] };
  }

  const replicate = new Replicate({ auth: env.replicateToken });
  const versions = [env.replicateWhisperVersion, env.replicateWhisperFallbackVersion]
    .map((version) => version.trim())
    .filter((version, index, values) => version && values.indexOf(version) === index);

  const errors = await runReplicateVersions(replicate, versions, audio);
  if (errors.segments.length > 0) {
    return { segments: errors.segments, engine: errors.engine };
  }

  if (vocalUrl && shouldRetryByDownloading(errors.messages)) {
    try {
      const downloaded = await downloadAudioBuffer(vocalUrl);
      const downloadedResult = await runReplicateVersions(replicate, versions, downloaded);
      if (downloadedResult.segments.length > 0) {
        return { segments: downloadedResult.segments, engine: downloadedResult.engine };
      }
      errors.messages.push(...downloadedResult.messages.map((message) => `downloaded stem: ${message}`));
    } catch (error) {
      errors.messages.push(`downloaded stem retry failed: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }

  throw new Error(`Replicate Whisper failed: ${errors.messages.join("; ")}`);
}

async function runReplicateVersions(
  replicate: Replicate,
  versions: string[],
  audio: string | Buffer
): Promise<{ segments: TranscriptSegment[]; engine?: string; messages: string[] }> {
  const messages: string[] = [];
  const candidates: Array<{ version: string; index: number; segments: TranscriptSegment[]; score: number; failed: boolean }> = [];

  for (const [index, version] of versions.entries()) {
    try {
      const output = await replicate.run(version as `${string}/${string}:${string}`, {
        input: replicateInput(version, audio)
      });
      const segments = parseReplicateOutput(output);
      if (segments.length > 0) {
        const quality = assessVocalTranscript(segments, "original");
        candidates.push({
          version,
          index,
          segments,
          score: quality.score,
          failed: quality.status === "failed"
        });
        messages.push(`${version} scored ${Math.round(quality.score * 100)}%`);
        continue;
      }
      messages.push(`${version} returned no transcript`);
    } catch (error) {
      messages.push(`${version}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }

  const best = candidates.sort((a, b) =>
    Number(a.failed) - Number(b.failed) ||
    b.score - a.score ||
    a.index - b.index
  )[0];
  if (best) {
    return { segments: best.segments, engine: best.version, messages };
  }

  return { segments: [], messages };
}

function shouldRetryByDownloading(errors: string[]): boolean {
  return errors.some((message) => /soundfile|malformed|download|ffmpeg|valid audio|correct format/i.test(message));
}

async function downloadAudioBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`audio download failed with ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("audio download returned an empty file");
  }
  return bytes;
}

function replicateInput(version: string, audio: string | Buffer): Record<string, unknown> {
  if (version.startsWith("openai/whisper:")) {
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
    ? [{ id: "R1", start: 0, end: 4, text: text.trim(), confidence: 0.78 }]
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
  return 0.72;
}
