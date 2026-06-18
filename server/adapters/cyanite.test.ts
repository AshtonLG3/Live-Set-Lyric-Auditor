import { afterEach, describe, expect, it, vi } from "vitest";

describe("Cyanite adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("../services/media");
    vi.resetModules();
  });

  it("maps a completed YouTube analysis into performance context", async () => {
    vi.stubEnv("CYANITE_API_TOKEN", "cyanite-test-token");
    vi.stubEnv("YOUTUBE_EXTRACTION_ENABLED", "true");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          youTubeTrackEnqueue: {
            __typename: "YouTubeTrackEnqueueSuccess",
            enqueuedLibraryTrack: { id: "cyanite-track-1" }
          }
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          libraryTrack: {
            __typename: "LibraryTrack",
            audioAnalysisV7: {
              __typename: "AudioAnalysisV7Finished",
              result: {
                bpmRangeAdjusted: 126.4,
                energyLevel: "HIGH",
                moodTags: ["ENERGETIC", "UPLIFTING"],
                advancedInstrumentTags: ["ELECTRIC_GUITAR", "DRUMS", "SYNTHESIZER"],
                valence: 0.62,
                arousal: 0.88,
                transformerCaption: "An energetic live performance with a driving full-band arrangement."
              }
            }
          }
        }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const { analyzePerformance } = await import("./cyanite");
    const result = await analyzePerformance({
      source: {
        kind: "live_link",
        processingMode: "provider_excerpt",
        provider: "youtube",
        url: "https://www.youtube.com/watch?v=M7lc1UVf-VE"
      }
    });

    expect(result).toMatchObject({
      source: "cyanite",
      status: "complete",
      energyLevel: 0.8,
      bpm: 126,
      arrangement: "high_intensity"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer cyanite-test-token" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).query).toContain("youTubeTrackEnqueue");
  });

  it("uses the current upload request contract before polling analysis", async () => {
    vi.stubEnv("CYANITE_API_TOKEN", "cyanite-test-token");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { fileUploadRequest: { id: "upload-1", uploadUrl: "https://upload.example/file" } } }))
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ data: { libraryTrackCreate: { __typename: "LibraryTrackCreateSuccess", createdLibraryTrack: { id: "track-1" } } } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          libraryTrack: {
            __typename: "LibraryTrack",
            audioAnalysisV7: {
              __typename: "AudioAnalysisV7Finished",
              result: { energyLevel: "MEDIUM", moodTags: [], advancedInstrumentTags: [] }
            }
          }
        }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const { analyzePerformance } = await import("./cyanite");
    const result = await analyzePerformance({ file: audioFile() });

    expect(result.source).toBe("cyanite");
    const uploadRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(uploadRequest.query).toContain("fileUploadRequest { id uploadUrl }");
    expect(uploadRequest.variables).toEqual({});
  });

  it("converts non-MP3 uploads before requesting Cyanite analysis", async () => {
    vi.stubEnv("CYANITE_API_TOKEN", "cyanite-test-token");
    const transcodeMediaToMp3 = vi.fn(async (file: Express.Multer.File) => ({
      ...file,
      originalname: "stage-video.mp3",
      mimetype: "audio/mpeg",
      buffer: Buffer.from([9, 8, 7]),
      size: 3
    }));
    vi.doMock("../services/media", () => ({ transcodeMediaToMp3 }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { fileUploadRequest: { id: "upload-1", uploadUrl: "https://upload.example/file" } } }))
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ data: { libraryTrackCreate: { __typename: "LibraryTrackCreateSuccess", createdLibraryTrack: { id: "track-1" } } } }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          libraryTrack: {
            __typename: "LibraryTrack",
            audioAnalysisV7: {
              __typename: "AudioAnalysisV7Finished",
              result: { energyLevel: "HIGH", moodTags: ["ENERGETIC"], advancedInstrumentTags: ["DRUMS"] }
            }
          }
        }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const { analyzePerformance } = await import("./cyanite");
    const result = await analyzePerformance({ file: videoFile() });

    expect(result.source).toBe("cyanite");
    expect(transcodeMediaToMp3).toHaveBeenCalledWith(expect.objectContaining({ originalname: "stage-video.mp4" }), "cyanite");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ "Content-Type": "audio/mpeg" });
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBeInstanceOf(Uint8Array);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

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

function videoFile(): Express.Multer.File {
  return {
    ...audioFile(),
    originalname: "stage-video.mp4",
    mimetype: "video/mp4"
  };
}
