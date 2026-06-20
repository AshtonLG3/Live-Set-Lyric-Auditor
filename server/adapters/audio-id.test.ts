import { afterEach, describe, expect, it, vi } from "vitest";

describe("audio identification", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("normalizes a configured audio-id endpoint and resolves it to a Musixmatch track", async () => {
    vi.stubEnv("AUDIO_ID_PROVIDER", "custom");
    vi.stubEnv("AUDIO_ID_API_URL", "https://id.example/identify");
    vi.stubEnv("AUDIO_ID_API_KEY", "audio-secret");
    vi.stubEnv("MUSIXMATCH_API_KEY", "mxm-secret");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://id.example/identify") {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual({ Authorization: "Bearer audio-secret" });
        expect((init?.body as FormData).get("clip")).toBeInstanceOf(Blob);
        return jsonResponse({
          track: {
            title: "Falling Forever",
            artist: "Dua Lipa",
            isrc: "GBUM72401234",
            confidence: 0.97
          }
        });
      }
      expect(url).toContain("track.search");
      return searchResponse([track(42, "Falling Forever", "Dua Lipa", 91, "GBUM72401234")]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { identifyTrackFromAudio } = await import("./audio-id");
    const result = await identifyTrackFromAudio(audioFile());

    expect(result).toMatchObject({
      provider: "custom",
      confidence: 0.97,
      track: {
        id: "42",
        title: "Falling Forever",
        artist: "Dua Lipa",
        source: "musixmatch",
        isrc: "GBUM72401234"
      }
    });
  });

  it("signs ACRCloud identification requests and maps the returned recording", async () => {
    vi.setSystemTime(new Date("2026-06-20T08:00:00Z"));
    vi.stubEnv("AUDIO_ID_PROVIDER", "acrcloud");
    vi.stubEnv("ACRCLOUD_HOST", "identify-eu-west-1.acrcloud.com");
    vi.stubEnv("ACRCLOUD_ACCESS_KEY", "acr-key");
    vi.stubEnv("ACRCLOUD_ACCESS_SECRET", "acr-secret");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://identify-eu-west-1.acrcloud.com/v1/identify");
      const body = init?.body as FormData;
      expect(body.get("access_key")).toBe("acr-key");
      expect(body.get("data_type")).toBe("audio");
      expect(body.get("signature")).toBeTruthy();
      expect(body.get("sample")).toBeInstanceOf(Blob);
      return jsonResponse({
        metadata: {
          music: [{
            title: "Training Season",
            artists: [{ name: "Dua Lipa" }],
            album: { name: "Radical Optimism" },
            external_ids: { isrc: "GBAHT2301192" },
            duration_ms: 209000,
            score: 98
          }]
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { identifyTrackFromAudio } = await import("./audio-id");
    const result = await identifyTrackFromAudio(audioFile());

    expect(result).toMatchObject({
      provider: "acrcloud",
      confidence: 0.98,
      track: {
        title: "Training Season",
        artist: "Dua Lipa",
        isrc: "GBAHT2301192",
        source: "manual"
      }
    });
  });

  it("stays silent when no audio-id provider is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { identifyTrackFromAudio } = await import("./audio-id");
    await expect(identifyTrackFromAudio(audioFile())).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function audioFile(): Express.Multer.File {
  return {
    fieldname: "clip",
    originalname: "stage-clip.mp3",
    encoding: "7bit",
    mimetype: "audio/mpeg",
    size: 4,
    buffer: Buffer.from([1, 2, 3, 4]),
    stream: undefined as never,
    destination: "",
    filename: "",
    path: ""
  };
}

function track(id: number, title: string, artist: string, rating = 80, isrc?: string) {
  return {
    track: {
      track_id: id,
      track_name: title,
      artist_name: artist,
      commontrack_isrcs: isrc ? [[isrc]] : undefined,
      has_lyrics: 1,
      has_subtitles: 1,
      has_richsync: 1,
      track_rating: rating
    }
  };
}

function searchResponse(trackList: unknown[]): Response {
  return jsonResponse({ message: { body: { track_list: trackList } } });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
