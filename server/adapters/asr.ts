import type { TranscriptSegment } from "../../shared/types";
import { env } from "../config";
import { fixtureTranscript } from "../data/fixtures";

export type TranscriptionResult = {
  source: "external" | "fixture";
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

export async function transcribeLiveVocal(file?: Express.Multer.File): Promise<TranscriptionResult> {
  if (!env.asrApiUrl || !file) {
    return { source: "fixture", segments: fixtureTranscript };
  }

  try {
    const formData = new FormData();
    formData.append("file", new Blob([toBlobPart(file.buffer)], { type: file.mimetype || "audio/mpeg" }), file.originalname);
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
    return segments.length > 0 ? { source: "external", segments } : { source: "fixture", segments: fixtureTranscript };
  } catch {
    return { source: "fixture", segments: fixtureTranscript };
  }
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
