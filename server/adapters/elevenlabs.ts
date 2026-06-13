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
    .slice(0, 3)
    .map((variant) => variant.type.replace("_", " "))
    .join(", ");
  const liveContext = passport.liveContext?.setlist.position
    ? `JamBase places the song at position ${passport.liveContext.setlist.position} in the available setlist.`
    : passport.liveContext?.summary ?? "No setlist position was available.";
  return `Live Set Lyric Auditor analyzed ${passport.track.title} by ${passport.track.artist} from ${event}. ${passport.summary} ${liveContext} Cyanite performance context: ${passport.performanceContext.summary} The strongest candidate categories are ${topVariants || "none"}. This passport is derived analysis only and does not store the canonical lyric reference.`;
}
