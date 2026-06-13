import { afterEach, describe, expect, it, vi } from "vitest";

describe("Cyanite adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("maps a completed YouTube analysis into performance context", async () => {
    vi.stubEnv("CYANITE_API_TOKEN", "cyanite-test-token");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          libraryTrackEnqueue: {
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
        processingMode: "reference_fixture",
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
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
