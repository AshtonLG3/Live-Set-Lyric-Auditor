import Replicate from "replicate";
import type { TranscriptSegment } from "../../shared/types";
import { env } from "../config";
import { fixtureRecallTranscript, fixtureTranscript } from "../data/fixtures";

export type TranscriptionResult = {
  source: "replicate" | "external" | "fixture";
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
  if ((!env.replicateToken && !env.asrApiUrl) || (!file && !vocalUrl)) {
    return { source: "fixture", segments: fixtureSegments };
  }

  if (env.replicateToken) {
    const replicated = await transcribeWithReplicate(file, vocalUrl);
    if (replicated.length > 0) {
      return { source: "replicate", segments: replicated };
    }
  }

  if (!env.asrApiUrl) {
    return { source: "fixture", segments: fixtureSegments };
  }

  try {
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
    return segments.length > 0 ? { source: "external", segments } : { source: "fixture", segments: fixtureSegments };
  } catch {
    return { source: "fixture", segments: fixtureSegments };
  }
}

async function transcribeWithReplicate(
  file: Express.Multer.File | undefined,
  vocalUrl?: string
): Promise<TranscriptSegment[]> {
  const audio = vocalUrl || file?.buffer;
  if (!audio || !env.replicateToken) {
    return [];
  }

  const replicate = new Replicate({ auth: env.replicateToken });
  const versions = [env.replicateWhisperVersion, env.replicateWhisperFallbackVersion]
    .map((version) => version.trim())
    .filter((version, index, values) => version && values.indexOf(version) === index);

  for (const version of versions) {
    try {
      const output = await replicate.run(version as `${string}/${string}:${string}`, {
        input: replicateInput(version, audio)
      });
      const segments = parseReplicateOutput(output);
      if (segments.length > 0) {
        return segments;
      }
    } catch {
      // Try the pinned fallback before returning to the fixture-safe path.
    }
  }

  return [];
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

  if (segments.length > 0) {
    return segments;
  }

  const text = [record.text, record.transcription]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  return text
    ? [{ id: "R1", start: 0, end: 4, text: text.trim(), confidence: 0.78 }]
    : [];
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
