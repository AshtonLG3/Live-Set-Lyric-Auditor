import { env } from "../config";

export type VocalIsolationResult = {
  source: "lalalai" | "fixture";
  confidence: number;
  detail: string;
};

export async function isolateVocals(file?: Express.Multer.File): Promise<VocalIsolationResult> {
  if (!env.lalalKey || !file) {
    return {
      source: "fixture",
      confidence: 0.74,
      detail: "Fixture vocal isolation used for stable demo playback."
    };
  }

  try {
    const formData = new FormData();
    formData.append("file", new Blob([toBlobPart(file.buffer)], { type: file.mimetype || "audio/mpeg" }), file.originalname);

    const upload = await fetch(`${env.lalalBaseUrl}/upload/`, {
      method: "POST",
      headers: {
        "X-License-Key": env.lalalKey
      },
      body: formData
    });
    if (!upload.ok) {
      throw new Error(`LALAL upload failed with ${upload.status}`);
    }
    const uploaded = await upload.json();
    const sourceId = uploaded.source_id ?? uploaded.id;
    if (!sourceId) {
      throw new Error("LALAL upload did not return source_id");
    }

    const split = await fetch(`${env.lalalBaseUrl}/split/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-License-Key": env.lalalKey
      },
      body: JSON.stringify({
        source_id: sourceId,
        stem: "vocals",
        splitter: "phoenix"
      })
    });
    if (!split.ok) {
      throw new Error(`LALAL split failed with ${split.status}`);
    }
    return {
      source: "lalalai",
      confidence: 0.86,
      detail: "Live LALAL.AI upload/split request accepted."
    };
  } catch {
    return {
      source: "fixture",
      confidence: 0.64,
      detail: "LALAL.AI request failed; fixture vocal isolation kept the demo running."
    };
  }
}

function toBlobPart(buffer: Buffer): BlobPart {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) as unknown as BlobPart;
}
