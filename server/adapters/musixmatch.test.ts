import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptSegment } from "../../shared/types";

describe("Musixmatch identification", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("prefers the ranked lyric fingerprint result", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "musixmatch-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fingerprintResponse([
        { similarity: 98.4, ...track(9, "Correct Song", "Low-rated Cover", 1) },
        { similarity: 98.4, ...track(42, "Correct Song", "Correct Artist", 80) }
      ]))
      .mockResolvedValueOnce(searchResponse([track(42, "Correct Song", "Correct Artist", 80)]));
    vi.stubGlobal("fetch", fetchMock);

    const { identifyTrackFromLyrics } = await import("./musixmatch");
    await expect(identifyTrackFromLyrics(transcript())).resolves.toMatchObject({
      id: "42",
      title: "Correct Song",
      artist: "Correct Artist",
      source: "musixmatch"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("track.lyrics.fingerprint.post"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("falls back to repeated lyric search when fingerprint access is unavailable", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "musixmatch-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(searchResponse([track(42, "Correct Song", "Correct Artist"), track(9, "Noise", "Other")]))
      .mockResolvedValueOnce(searchResponse([track(42, "Correct Song", "Correct Artist")]))
      .mockResolvedValueOnce(searchResponse([track(77, "Another Guess", "Other")]));
    vi.stubGlobal("fetch", fetchMock);

    const { identifyTrackFromLyrics } = await import("./musixmatch");
    await expect(identifyTrackFromLyrics(transcript())).resolves.toMatchObject({ id: "42" });
  });
});

describe("subtitle timing", () => {
  it("parses real LRC timestamps instead of fabricating index*4 spacing", async () => {
    const { parseLrcBody } = await import("./musixmatch");
    const lines = parseLrcBody("[ar:Some Artist]\n[00:09.50]first line here\n[00:14.20]second line here\n[00:19.00]third line here");
    expect(lines).toEqual([
      { id: "L1", start: 9.5, end: 14.2, text: "first line here" },
      { id: "L2", start: 14.2, end: 19, text: "second line here" },
      { id: "L3", start: 19, end: 23, text: "third line here" }
    ]);
  });
});

function transcript(): TranscriptSegment[] {
  return [
    { id: "T1", start: 0, end: 4, text: "these are the first clear lyric words", confidence: 0.95 },
    { id: "T2", start: 4, end: 8, text: "another distinctive line from the chorus", confidence: 0.91 }
  ];
}

function track(id: number, title: string, artist: string, rating = 80) {
  return {
    track: {
      track_id: id,
      track_name: title,
      artist_name: artist,
      has_lyrics: 1,
      has_subtitles: 1,
      track_rating: rating
    }
  };
}

function searchResponse(trackList: unknown[]): Response {
  return new Response(JSON.stringify({ message: { body: { track_list: trackList } } }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function fingerprintResponse(trackList: unknown[]): Response {
  return new Response(JSON.stringify({ track_list: trackList }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
