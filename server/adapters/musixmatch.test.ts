import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptSegment } from "../../shared/types";

describe("Musixmatch identification", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("requires repeated evidence across lyric phrases", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "musixmatch-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(searchResponse([track(42, "Correct Song", "Correct Artist"), track(9, "Noise", "Other")]))
      .mockResolvedValueOnce(searchResponse([track(42, "Correct Song", "Correct Artist")]))
      .mockResolvedValueOnce(searchResponse([track(77, "Another Guess", "Other")]))
      .mockResolvedValueOnce(searchResponse([track(42, "Correct Song", "Correct Artist")]))
      .mockResolvedValueOnce(searchResponse([track(77, "Another Guess", "Other")]))
      .mockResolvedValueOnce(searchResponse([track(88, "Third Guess", "Other")]))
      .mockRejectedValueOnce(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    const { identifyTrackFromLyrics } = await import("./musixmatch");
    await expect(identifyTrackFromLyrics(transcript())).resolves.toMatchObject({
      id: "42",
      title: "Correct Song",
      artist: "Correct Artist",
      source: "musixmatch"
    });
    await expect(identifyTrackFromLyrics(transcript())).resolves.toBeUndefined();
    await expect(identifyTrackFromLyrics(transcript().slice(0, 1))).resolves.toBeUndefined();
  });
});

function transcript(): TranscriptSegment[] {
  return [
    { id: "T1", start: 0, end: 4, text: "these are the first clear lyric words", confidence: 0.95 },
    { id: "T2", start: 4, end: 8, text: "another distinctive line from the chorus", confidence: 0.91 }
  ];
}

function track(id: number, title: string, artist: string) {
  return {
    track: {
      track_id: id,
      track_name: title,
      artist_name: artist,
      has_lyrics: 1,
      has_subtitles: 1,
      track_rating: 80
    }
  };
}

function searchResponse(trackList: unknown[]): Response {
  return new Response(JSON.stringify({ message: { body: { track_list: trackList } } }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
