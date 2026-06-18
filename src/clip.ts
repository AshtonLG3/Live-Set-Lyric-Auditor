import { MAX_CLIP_BYTES, MAX_CLIP_SECONDS } from "../shared/version";

export type ClipSelection = {
  file: File;
  durationSeconds?: number;
  kind: "audio" | "video";
};

const supportedExtensions = /\.(mp3|wav|m4a|aac|ogg|mp4|mov|webm)$/i;

export async function inspectClip(file: File): Promise<ClipSelection> {
  const kind = getClipKind(file);
  if (!kind) {
    throw new Error("Choose an audio or video clip: MP3, WAV, M4A, AAC, OGG, MP4, MOV, or WebM.");
  }
  if (file.size > MAX_CLIP_BYTES) {
    throw new Error("Keep the clip under 40 MB.");
  }

  const durationSeconds = await readMediaDuration(file, kind);
  if (durationSeconds && durationSeconds > MAX_CLIP_SECONDS) {
    throw new Error(`Keep the clip under ${MAX_CLIP_SECONDS} seconds.`);
  }
  return { file, durationSeconds: durationSeconds ?? undefined, kind };
}

export { formatBytes as formatFileSize } from "../shared/format";

function getClipKind(file: File): ClipSelection["kind"] | null {
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("video/")) return "video";
  if (!supportedExtensions.test(file.name)) return null;
  return /\.(mp4|mov|webm)$/i.test(file.name) ? "video" : "audio";
}

function readMediaDuration(file: File, kind: ClipSelection["kind"]): Promise<number | null> {
  return new Promise((resolve) => {
    const media = document.createElement(kind);
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      media.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    const timeout = window.setTimeout(() => finish(null), 4000);
    media.preload = "metadata";
    media.onloadedmetadata = () => finish(Number.isFinite(media.duration) ? media.duration : null);
    media.onerror = () => finish(null);
    media.src = url;
  });
}
