import { describe, expect, it } from "vitest";
import { buildLiveContext, searchEvents } from "./jambase";
import { analyzePerformance } from "./cyanite";
import { isolateVocalsWithDemucs } from "./demucs";
import { searchTracks } from "./musixmatch";
import { narratePassport } from "./elevenlabs";
import { buildPassport } from "../services/alignment";
import { fixtureCanonicalLines, fixtureEvents, fixtureTranscript, fixtureTracks } from "../data/fixtures";

describe("fixture-safe adapters", () => {
  it("returns Musixmatch fixture tracks when no API key is configured", async () => {
    const tracks = await searchTracks("Midnight Atlas");
    expect(tracks[0]?.source).toBe("fixture");
  });

  it("returns no JamBase events when no API key is configured", async () => {
    const events = await searchEvents({ artist: "The Signal Keeps", city: "Cape Town" });
    expect(events).toEqual([]);
  });

  it("derives a setlist-aware live context from the event anchor", () => {
    const context = buildLiveContext(fixtureEvents[0], fixtureTracks[0]);
    expect(context?.setlist.position).toBe(2);
    expect(context?.artistId).toBeTruthy();
    expect(context?.summary).toContain("position 2");
  });

  it("returns fixture performance context when Cyanite is not configured", async () => {
    await expect(analyzePerformance({ source: { kind: "fixture", processingMode: "fixture" } })).resolves.toMatchObject({
      source: "fixture",
      arrangement: "high_intensity"
    });
  });

  it("returns fixture Demucs isolation without a file or key", async () => {
    await expect(isolateVocalsWithDemucs()).resolves.toMatchObject({ source: "fixture" });
  });

  it("returns a fixture narration script when ElevenLabs is not configured", async () => {
    const passport = buildPassport({
      id: "job-1",
      track: fixtureTracks[0],
      event: fixtureEvents[0],
      filename: "demo.mp3",
      durationSeconds: 24,
      canonicalLines: fixtureCanonicalLines,
      transcript: fixtureTranscript,
      sourceCoverage: 0.72,
      canonicalSource: "fixture",
      restricted: false,
      matchMethod: "fixture_rescue",
      vocalIsolationSource: "fixture",
      vocalIsolationConfidence: 0.74,
      asrSource: "fixture",
      source: { kind: "fixture", processingMode: "fixture" }
    });
    const narration = await narratePassport("job-1", passport);
    expect(narration.mode).toBe("fixture");
    expect(narration.text).toContain("Live Set Lyric Auditor");
  });
});
