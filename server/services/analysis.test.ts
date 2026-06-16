import { beforeEach, describe, expect, it } from "vitest";
import type { TrackCandidate } from "../../shared/types";
import { fixturePerformanceContext, fixtureTracks } from "../data/fixtures";
import { createJob, jobs, updateJob } from "../store";
import { reanchorAnalysis, runAnalysis } from "./analysis";

describe("analysis recovery", () => {
  beforeEach(() => {
    jobs.clear();
  });

  it("re-anchors a failed auto-match without repeating transcription", async () => {
    const job = createJob();
    updateJob(job.id, (current) => ({
      ...current,
      status: "failed",
      error: "The live transcript did not produce a confident Musixmatch track match.",
      progress: current.progress.map((step) => step.id === "anchor" ? { ...step, status: "failed" } : step),
      recovery: {
        filename: "stage.mp4",
        durationSeconds: 21.7,
        vocalIsolationSource: "lalalai",
        vocalIsolationConfidence: 0.86,
        asrSource: "replicate",
        transcript: [{ id: "R1", start: 0, end: 5, text: "How you broke my heart", confidence: 0.9 }],
        source: { kind: "upload", processingMode: "uploaded_media" },
        performanceContext: fixturePerformanceContext,
        event: null
      }
    }));

    const corrected = await reanchorAnalysis(job.id, manualTrack());

    expect(corrected.status).toBe("complete");
    expect(corrected.error).toBeUndefined();
    expect(corrected.recovery).toBeUndefined();
    expect(corrected.passport?.track.title).toBe("I Don't Want to Talk About It");
    expect(corrected.passport?.clip.transcript).toEqual([
      { id: "R1", start: 0, end: 5, text: "How you broke my heart", confidence: 0.9 }
    ]);
    expect(corrected.progress.find((step) => step.id === "anchor")?.status).toBe("complete");
  });

  it("analyzes a typed recall fragment without requiring an uploaded clip", async () => {
    const job = createJob();

    await runAnalysis(job.id, {
      track: fixtureTracks[0],
      autoMatch: false,
      source: { kind: "recall_recording", processingMode: "recall_recording" },
      recallSegments: [{ id: "R1", start: 0, end: 0, text: "We carry the chorus through the avenue", confidence: 1 }]
    });

    const analyzed = jobs.get(job.id);
    expect(analyzed?.status).toBe("complete");
    expect(analyzed?.passport?.clip.source.kind).toBe("recall_recording");
    expect(analyzed?.passport?.clip.transcript).toEqual([
      { id: "R1", start: 0, end: 1, text: "We carry the chorus through the avenue", confidence: 1 }
    ]);
    expect(analyzed?.progress.find((step) => step.id === "isolate")?.detail).toContain("no vocal isolation needed");
  });
});

function manualTrack(): TrackCandidate {
  return {
    id: "manual-rod-stewart",
    title: "I Don't Want to Talk About It",
    artist: "Rod Stewart",
    hasLyrics: false,
    hasSubtitles: false,
    source: "manual"
  };
}
