import { env } from "../config";

type LalalUploadResponse = {
  id?: string;
};

type LalalSplitResponse = {
  task_id?: string;
};

type LalalTrack = {
  type?: string;
  label?: string;
  url?: string;
};

type LalalTaskResult = {
  status?: "progress" | "success" | "error" | "cancelled" | "server_error";
  error?: string;
  result?: {
    tracks?: LalalTrack[];
  };
};

type LalalCheckResponse = {
  result?: Record<string, LalalTaskResult>;
};

export type VocalIsolationResult = {
  source: "lalalai" | "fixture";
  confidence: number;
  detail: string;
  vocalUrl?: string;
};

export async function getLalalMinutesLeft(): Promise<number | null> {
  if (!env.lalalKey) {
    return null;
  }

  const response = await fetch(`${env.lalalBaseUrl}/limits/minutes_left/`, {
    method: "POST",
    headers: lalalHeaders()
  });
  if (!response.ok) {
    throw new Error(`LALAL.AI balance check failed with ${response.status}`);
  }

  const payload = await response.json() as { minutes_left?: unknown };
  const minutesLeft = Number(payload.minutes_left);
  if (!Number.isFinite(minutesLeft)) {
    throw new Error("LALAL.AI balance check returned an invalid value");
  }
  return minutesLeft;
}

export async function isolateVocals(file?: Express.Multer.File): Promise<VocalIsolationResult> {
  if (!env.lalalKey || !file) {
    return {
      source: "fixture",
      confidence: 0.74,
      detail: "Fixture vocal isolation used for stable demo playback."
    };
  }

  try {
    const upload = await fetch(`${env.lalalBaseUrl}/upload/`, {
      method: "POST",
      headers: {
        ...lalalHeaders(),
        "Content-Disposition": `attachment; filename="${safeFilename(file.originalname)}"`,
        "Content-Type": file.mimetype || "application/octet-stream"
      },
      body: new Blob([toBlobPart(file.buffer)], { type: file.mimetype || "application/octet-stream" })
    });
    if (!upload.ok) {
      throw new Error(`LALAL upload failed with ${upload.status}`);
    }
    const uploaded = await upload.json() as LalalUploadResponse;
    const sourceId = uploaded.id;
    if (!sourceId) {
      throw new Error("LALAL upload did not return an id");
    }

    const split = await fetch(`${env.lalalBaseUrl}/split/stem_separator/`, {
      method: "POST",
      headers: {
        ...lalalHeaders(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        source_id: sourceId,
        presets: {
          stem: "vocals",
          splitter: "phoenix",
          dereverb_enabled: false,
          encoder_format: "mp3",
          extraction_level: "deep_extraction"
        }
      })
    });
    if (!split.ok) {
      throw new Error(`LALAL split failed with ${split.status}`);
    }
    const splitPayload = await split.json() as LalalSplitResponse;
    if (!splitPayload.task_id) {
      throw new Error("LALAL split did not return a task_id");
    }

    const completed = await waitForSplit(splitPayload.task_id);
    const vocalTrack = completed.result?.tracks?.find((track) => track.type === "stem" && track.label === "vocals");
    if (!vocalTrack?.url) {
      throw new Error("LALAL split completed without a vocal stem URL");
    }

    return {
      source: "lalalai",
      confidence: 0.86,
      detail: "Live LALAL.AI vocal isolation completed.",
      vocalUrl: vocalTrack.url
    };
  } catch {
    return {
      source: "fixture",
      confidence: 0.64,
      detail: "LALAL.AI request failed; fixture vocal isolation kept the demo running."
    };
  }
}

async function waitForSplit(taskId: string): Promise<LalalTaskResult> {
  const deadline = Date.now() + env.lalalPollTimeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(`${env.lalalBaseUrl}/check/`, {
      method: "POST",
      headers: {
        ...lalalHeaders(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ task_ids: [taskId] })
    });
    if (!response.ok) {
      throw new Error(`LALAL status check failed with ${response.status}`);
    }

    const payload = await response.json() as LalalCheckResponse;
    const task = payload.result?.[taskId];
    if (!task?.status) {
      throw new Error("LALAL status check did not return the requested task");
    }
    if (task.status === "success") {
      return task;
    }
    if (task.status !== "progress") {
      throw new Error(task.error || `LALAL split ended with ${task.status}`);
    }

    await delay(env.lalalPollIntervalMs);
  }

  throw new Error("LALAL vocal isolation timed out");
}

function lalalHeaders(): Record<string, string> {
  return { "X-License-Key": env.lalalKey ?? "" };
}

function safeFilename(filename: string): string {
  return filename.replace(/[\r\n"]/g, "_");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function toBlobPart(buffer: Buffer): BlobPart {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) as unknown as BlobPart;
}
