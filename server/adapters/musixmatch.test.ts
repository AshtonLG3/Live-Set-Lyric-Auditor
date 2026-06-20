import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptSegment } from "../../shared/types";

describe("Musixmatch identification", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("reranks short artist-intent searches above title-only hits", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "musixmatch-test-key");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("q_artist=dua")) {
        return searchResponse([
          track(25, "Seiya", "DUA :)", 15),
          track(24, "One Kiss", "Calvin Harris feat. Dua Lipa", 99),
          track(22, "Levitating", "Dua Lipa", 92),
          track(23, "New Rules", "Dua Lipa", 88)
        ]);
      }
      if (url.includes("q_track=dua")) {
        return searchResponse([
          track(11, "Dua Lipa", "Jack Harlow", 99),
          track(12, "Dua", "Mansyr S", 15)
        ]);
      }
      return searchResponse([
        track(11, "Dua Lipa", "Jack Harlow", 99),
        track(22, "Levitating", "Dua Lipa", 92)
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { searchTracks } = await import("./musixmatch");
    const results = await searchTracks("dua");

    expect(results[0]).toMatchObject({ title: "Levitating", artist: "Dua Lipa" });
    expect(results[1]).toMatchObject({ title: "New Rules", artist: "Dua Lipa" });
    expect(results.findIndex((result) => result.title === "One Kiss" && result.artist.includes("Dua Lipa"))).toBeGreaterThan(1);
    expect(results.findIndex((result) => result.artist === "DUA :)")).toBeGreaterThan(1);
    expect(results.findIndex((result) => result.title === "Dua Lipa" && result.artist === "Jack Harlow")).toBeGreaterThan(0);
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

  it("accepts a strong live-performance fingerprint that clears the studio-lyrics bar", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "musixmatch-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValue(searchResponse([]))
      .mockResolvedValueOnce(fingerprintResponse([
        { similarity: 73.2, ...track(101, "Falling Forever (Live from the Royal Albert Hall)", "Dua Lipa", 43) },
        { similarity: 72.8, ...track(102, "Falling Forever", "Dua Lipa", 51) },
        { similarity: 72.8, ...track(103, "Falling Forever (Live From Mexico)", "Dua Lipa", 11) },
        { similarity: 35.3, ...track(900, "Need", "Lamu", 3) }
      ]))
      .mockResolvedValueOnce(searchResponse([track(102, "Falling Forever", "Dua Lipa", 51)]));
    vi.stubGlobal("fetch", fetchMock);

    const { identifyTrackFromLyrics } = await import("./musixmatch");
    await expect(identifyTrackFromLyrics(transcript())).resolves.toMatchObject({
      title: "Falling Forever",
      artist: "Dua Lipa"
    });
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

describe("fingerprint text", () => {
  it("drops short noisy ASR fragments before fingerprinting", async () => {
    const { buildFingerprintText } = await import("./musixmatch");
    const text = buildFingerprintText([
      { id: "T1", start: 0, end: 3, text: "You can wake up all alone", confidence: 0.77 },
      { id: "T2", start: 3, end: 6, text: "So tonight I'll give you something to remember", confidence: 0.78 },
      { id: "T3", start: 6, end: 9, text: "So small", confidence: 0.72 },
      { id: "T4", start: 9, end: 12, text: "In the air", confidence: 0.7 },
      { id: "T5", start: 12, end: 15, text: "How long?", confidence: 0.66 },
      { id: "T6", start: 15, end: 18, text: "Can we keep falling forever?", confidence: 0.8 }
    ]);

    expect(text).toContain("You can wake up all alone");
    expect(text).toContain("So tonight I'll give you something to remember");
    expect(text).toContain("Can we keep falling forever?");
    expect(text).not.toContain("So small");
    expect(text).not.toContain("In the air");
    expect(text).not.toContain("How long?");
  });

  it("keeps short fragments when there is not enough substantial lyric text", async () => {
    const { buildFingerprintText } = await import("./musixmatch");
    const text = buildFingerprintText([
      { id: "T1", start: 0, end: 2, text: "Keep me close", confidence: 0.75 },
      { id: "T2", start: 2, end: 4, text: "Falling forever", confidence: 0.76 },
      { id: "T3", start: 4, end: 6, text: "In your arms", confidence: 0.77 }
    ]);

    expect(text).toBe("Keep me close Falling forever In your arms");
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
