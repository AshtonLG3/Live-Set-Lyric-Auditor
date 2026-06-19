import Replicate from "replicate";
import { env } from "../config";

type DemucsOutput = Record<string, unknown> | string | unknown[] | null | undefined;

export type VocalIsolationResult = {
  source: "demucs" | "original" | "fixture";
  confidence: number;
  detail: string;
  vocalUrl?: string;
};

// Replicate Demucs (htdemucs) vocal isolation. Runs through the same REPLICATE_API_TOKEN
// the ASR step already uses, returning a remote vocal-stem URL in the same shape LALAL
// produces, so the rest of the pipeline (stem-vs-raw contest, ASR handoff) is unchanged.
export async function isolateVocalsWithDemucs(file?: Express.Multer.File): Promise<VocalIsolationResult> {
  if (!file) {
    return {
      source: "fixture",
      confidence: 0.74,
      detail: "Fixture vocal isolation used for stable demo playback."
    };
  }
  if (!env.replicateToken) {
    return {
      source: "original",
      confidence: 0.5,
      detail: "Replicate is not configured; transcription uses the original supplied audio."
    };
  }

  try {
    const replicate = new Replicate({ auth: env.replicateToken, useFileOutput: false });
    const input: Record<string, unknown> = { audio: audioBlob(file), stem: env.replicateDemucsStem };
    if (env.replicateDemucsModel) {
      input.model_name = env.replicateDemucsModel;
    }
    const output = (await replicate.run(
      env.replicateDemucsRef as `${string}/${string}` | `${string}/${string}:${string}`,
      { input }
    )) as DemucsOutput;

    const vocalUrl = extractVocalUrl(output);
    if (!vocalUrl) {
      throw new Error("Demucs returned no vocal stem URL");
    }
    return {
      source: "demucs",
      confidence: 0.9,
      detail: `Replicate Demucs (${env.replicateDemucsModel ?? "htdemucs"}) vocal stem isolation completed.`,
      vocalUrl
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown Replicate Demucs error";
    throw new Error(`Live vocal isolation failed: ${detail}`);
  }
}

// Demucs returns an object keyed by stem name ({ vocals, no_vocals } in two-stem mode,
// or { vocals, drums, bass, other }). Parse defensively so a different output shape
// degrades to "no stem" -> raw-audio fallback instead of a crash.
function extractVocalUrl(output: DemucsOutput): string | undefined {
  if (!output) return undefined;
  if (typeof output === "string") {
    return output.trim() || undefined;
  }
  if (Array.isArray(output)) {
    const first = output.find((value) => typeof value === "string" && value.trim());
    return typeof first === "string" ? first : undefined;
  }
  const record = output as Record<string, unknown>;
  const vocals = record.vocals ?? record.vocal;
  return typeof vocals === "string" && vocals.trim() ? vocals : undefined;
}

function audioBlob(file: Express.Multer.File): Blob {
  const bytes = new Uint8Array(file.buffer.buffer, file.buffer.byteOffset, file.buffer.byteLength) as unknown as BlobPart;
  const name = file.originalname || "stage-clip.mp3";
  const type = file.mimetype || "audio/mpeg";
  if (typeof File !== "undefined") {
    return new File([bytes], name, { type });
  }
  return new Blob([bytes], { type });
}
