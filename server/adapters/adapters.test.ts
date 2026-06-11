import { describe, expect, it } from "vitest";
import { searchEvents } from "./jambase";
import { isolateVocals } from "./lalal";
import { searchTracks } from "./musixmatch";
import { narratePassport } from "./elevenlabs";
import { buildPassport } from "../services/alignment";
import { fixtureCanonicalLines, fixtureEvents, fixtureTranscript, fixtureTracks } from "../data/fixtures";

describe("fixture-safe adapters", () => {
  it("returns Musixmatch fixture tracks when no API key is configured", async () => {
    const tracks = await searchTracks("Midnight Atlas");
    expect(tracks[0]?.source).toBe("fixture");
  });

  it("returns JamBase fixture events when no API key is configured", async () => {
    const events = await searchEvents({ artist: "The Signal Keeps", city: "Cape Town" });
    expect(events[0]?.source).toBe("fixture");
  });

  it("returns fixture vocal isolation without a file or key", async () => {
    await expect(isolateVocals()).resolves.toMatchObject({ source: "fixture" });
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
