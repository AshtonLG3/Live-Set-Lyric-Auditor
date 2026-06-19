import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(path.join(root, ".env"));

const textPath = path.resolve(process.argv[2] || "demo/voiceover.txt");
const outputPath = path.resolve(process.argv[3] || "demo/tmp/voiceover.mp3");
const text = await readFile(textPath, "utf8");
const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
const voiceId = process.env.DEMO_ELEVENLABS_VOICE_ID?.trim()
  || process.env.ELEVENLABS_VOICE_ID?.trim()
  || "JBFqnCBsd6RMkjVDRZzb";

if (!apiKey) {
  console.log("ElevenLabs key not found; Windows speech fallback will be used.");
  process.exit(2);
}

const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "xi-api-key": apiKey
  },
  body: JSON.stringify({
    text,
    model_id: process.env.DEMO_ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_v2",
    voice_settings: {
      stability: Number(process.env.DEMO_ELEVENLABS_STABILITY ?? 0.56),
      similarity_boost: Number(process.env.DEMO_ELEVENLABS_SIMILARITY_BOOST ?? 0.78),
      style: Number(process.env.DEMO_ELEVENLABS_STYLE ?? 0.08),
      use_speaker_boost: true
    }
  })
});

if (!response.ok) {
  const detail = await response.text().catch(() => "");
  throw new Error(`ElevenLabs failed with ${response.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
}

const audio = Buffer.from(await response.arrayBuffer());
await writeFile(outputPath, audio);
console.log(`Wrote ElevenLabs voiceover to ${path.relative(root, outputPath)}`);

function loadDotEnv(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      const [, key, value] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  } catch {
    // The repo can build the video without a local .env by falling back to Windows TTS.
  }
}
