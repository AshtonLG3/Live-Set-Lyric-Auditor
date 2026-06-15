import type { LiveVariantPassport, NarrationResponse } from "../../shared/types";
import { env } from "../config";

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
  const manualSentence = manualCount
    ? `${manualCount} human-added live moment${manualCount === 1 ? "" : "s"} are included in the review queue.`
    : "All current candidates come from the automated transcript alignment.";
  const profile = passport.performanceContext.source === "cyanite"
    ? `Cyanite reports ${Math.round(passport.performanceContext.energyLevel * 100)}% energy${passport.performanceContext.bpm ? ` at ${passport.performanceContext.bpm} BPM` : ""}, with ${passport.performanceContext.arrangement.replaceAll("_", " ")} arrangement.`
    : `Performance profile is marked ${passport.performanceContext.status}: ${passport.performanceContext.summary}`;
  const referencePolicy = passport.rights.status === "display_allowed" || passport.rights.status === "fixture"
    ? "Short canonical excerpts are cached for reviewer comparison."
    : "Canonical reference display is restricted for this track.";
  return `Live Set Lyric Auditor review brief: ${passport.track.title} by ${passport.track.artist}, sourced from ${event}. ${passport.summary} ${liveContext} ${profile} Priority checks: ${candidateBrief}. ${manualSentence} ${referencePolicy}`;
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
