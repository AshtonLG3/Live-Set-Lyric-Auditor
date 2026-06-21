import type { LiveVariantPassport, NarrationResponse, TranscriptSegment } from "../../shared/types";
import { env } from "../config";

type ElevenLabsWord = {
  text?: string;
  start?: number;
  end?: number;
  type?: string;
  logprob?: number;
};

type ElevenLabsTranscriptResponse = {
  language_probability?: number;
  text?: string;
  words?: ElevenLabsWord[];
};

export async function narratePassport(jobId: string, passport: LiveVariantPassport): Promise<NarrationResponse> {
  const text = narrationText(passport);
  if (!env.elevenlabsKey) {
    return {
      jobId,
      mode: "fixture",
      text
    };
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${env.elevenlabsVoiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": env.elevenlabsKey
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.48,
            similarity_boost: 0.72,
            style: 0.15
          }
        })
      }
    );
    if (!response.ok) {
      throw new Error(`ElevenLabs failed with ${response.status}`);
    }
    const audio = Buffer.from(await response.arrayBuffer()).toString("base64");
    return {
      jobId,
      mode: "elevenlabs",
      text,
      audioUrl: `data:audio/mpeg;base64,${audio}`
    };
  } catch {
    return {
      jobId,
      mode: "fixture",
      text
    };
  }
}

export async function transcribeWithElevenLabs(file: Express.Multer.File): Promise<{
  source: "external";
  engine: string;
  segments: TranscriptSegment[];
}> {
  if (!env.elevenlabsKey) {
    throw new Error("ElevenLabs API key is not configured.");
  }

  const formData = new FormData();
  formData.append("model_id", env.elevenlabsSttModel);
  formData.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || "audio/mpeg" }), file.originalname);
  formData.append("timestamps_granularity", "word");
  formData.append("diarize", "false");
  formData.append("tag_audio_events", "false");
  formData.append("no_verbatim", "false");

  const response = await withTimeout(
    fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": env.elevenlabsKey },
      body: formData
    }),
    env.elevenlabsSttTimeoutMs,
    `ElevenLabs Scribe timed out after ${Math.round(env.elevenlabsSttTimeoutMs / 1000)}s`
  );
  if (!response.ok) {
    throw new Error(`ElevenLabs Scribe failed with ${response.status}`);
  }

  const json = await response.json() as ElevenLabsTranscriptResponse;
  const segments = parseElevenLabsSegments(json);
  if (segments.length === 0) {
    throw new Error("ElevenLabs Scribe returned no transcript segments.");
  }
  return {
    source: "external",
    engine: `elevenlabs/${env.elevenlabsSttModel}`,
    segments
  };
}

function parseElevenLabsSegments(json: ElevenLabsTranscriptResponse): TranscriptSegment[] {
  const words = (json.words ?? [])
    .filter((word) => word.type === undefined || word.type === "word")
    .map((word) => ({
      text: String(word.text ?? "").trim(),
      start: finite(word.start, 0),
      end: finite(word.end, finite(word.start, 0) + 0.35),
      logprob: typeof word.logprob === "number" ? word.logprob : undefined
    }))
    .filter((word) => word.text);

  if (words.length === 0) {
    const text = json.text?.trim();
    return text
      ? [{ id: "EL1", start: 0, end: 4, text, confidence: normalizeElevenConfidence(json.language_probability) }]
      : [];
  }

  const segments: TranscriptSegment[] = [];
  let current: typeof words = [];
  let segmentStart = words[0]?.start ?? 0;

  for (const word of words) {
    const wouldExceedWindow = current.length > 0 && word.end - segmentStart > 4.5;
    const previous = current.at(-1);
    const previousEndsPhrase = previous ? /[.!?]$/.test(previous.text) : false;
    if (current.length > 0 && (wouldExceedWindow || previousEndsPhrase)) {
      segments.push(buildElevenSegment(segments.length, current, json.language_probability));
      current = [];
      segmentStart = word.start;
    }
    current.push(word);
  }
  if (current.length > 0) {
    segments.push(buildElevenSegment(segments.length, current, json.language_probability));
  }
  return segments;
}

function buildElevenSegment(index: number, words: Array<{ text: string; start: number; end: number; logprob?: number }>, languageProbability?: number): TranscriptSegment {
  const logprobs = words.map((word) => word.logprob).filter((value): value is number => typeof value === "number");
  const confidence = logprobs.length
    ? clamp(Math.exp(logprobs.reduce((sum, value) => sum + value, 0) / logprobs.length), 0.45, 0.98)
    : normalizeElevenConfidence(languageProbability);
  return {
    id: `EL${index + 1}`,
    start: words[0]?.start ?? index * 4,
    end: words.at(-1)?.end ?? index * 4 + 4,
    text: words.map((word) => word.text).join(" ").replace(/\s+([,.!?;:])/g, "$1"),
    confidence
  };
}

function normalizeElevenConfidence(value?: number): number {
  return clamp(typeof value === "number" ? value * 0.92 : 0.82, 0.45, 0.96);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function narrationText(passport: LiveVariantPassport): string {
  const event = passport.event
    ? `${passport.event.title} in ${passport.event.city}`
    : "an unanchored live clip";
  const topVariants = passport.variants
    .filter((variant) => variant.confidence >= 0.5)
    .sort((left, right) => right.confidence - left.confidence || left.start - right.start)
    .slice(0, 4);
  const liveContext = passport.liveContext?.setlist.position
    ? `JamBase places the song at position ${passport.liveContext.setlist.position} in the available setlist.`
    : passport.liveContext?.summary ?? "No setlist position was available.";
  const candidateBrief = topVariants.length
    ? topVariants.map((variant) => {
        const reference = variant.canonicalExcerpt ? ` against the cached reference excerpt "${shorten(variant.canonicalExcerpt)}"` : "";
        return `${formatTime(variant.start)} ${variantLabel(variant.type)}: "${shorten(variant.liveText)}"${reference}`;
      }).join("; ")
    : "no review candidates cleared the confidence threshold";
  const manualCount = passport.variants.filter((variant) => variant.evidenceSource === "manual_entry").length;
  const manualDetails = passport.variants
    .filter((variant) => variant.evidenceSource === "manual_entry")
    .slice(0, 4)
    .map((variant) => `${formatTime(variant.start)} "${shorten(variant.liveText)}"`)
    .join("; ");
  const approvedCount = passport.variants.filter((variant) => (variant as { reviewerDecision?: string }).reviewerDecision === "approved").length;
  const rejectedCount = passport.variants.filter((variant) => (variant as { reviewerDecision?: string }).reviewerDecision === "rejected").length;
  const reviewSentence = approvedCount || rejectedCount
    ? `The reviewer has approved ${approvedCount} and rejected ${rejectedCount} variant${rejectedCount === 1 ? "" : "s"}.`
    : "";
  const manualSentence = manualCount
    ? `${manualCount} human-added live moment${manualCount === 1 ? "" : "s"} are included in the review queue: ${manualDetails}.`
    : "All current candidates come from the automated transcript alignment.";
  const profile = passport.performanceContext.source === "cyanite"
    ? `Cyanite reports ${Math.round(passport.performanceContext.energyLevel * 100)}% energy${passport.performanceContext.bpm ? ` at ${passport.performanceContext.bpm} BPM` : ""}, with ${passport.performanceContext.arrangement.replaceAll("_", " ")} arrangement.`
    : `Performance profile is marked ${passport.performanceContext.status}: ${passport.performanceContext.summary}`;
  const referencePolicy = passport.rights.status === "display_allowed" || passport.rights.status === "fixture"
    ? "Short canonical excerpts are cached for reviewer comparison."
    : "Canonical reference display is restricted for this track.";
  return `Live Set Lyric Auditor review brief: ${passport.track.title} by ${passport.track.artist}, sourced from ${event}. ${passport.summary} ${liveContext} ${profile} Priority checks: ${candidateBrief}. ${reviewSentence} ${manualSentence} ${referencePolicy}`.replace(/  +/g, " ");
}

function variantLabel(type: LiveVariantPassport["variants"][number]["type"]): string {
  return type.replaceAll("_", " ");
}

function formatTime(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value - minutes * 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function shorten(value: string): string {
  return value.length > 72 ? `${value.slice(0, 69)}...` : value;
}
