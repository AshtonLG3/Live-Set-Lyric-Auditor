import { afterEach, describe, expect, it, vi } from "vitest";

describe("JamBase adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("uses bearer authentication and maps catalog and setlist evidence", async () => {
    vi.stubEnv("JAMBASE_API_KEY", "jambase-test-key");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      events: [{
        identifier: "event-42",
        name: "The Signal Keeps at Civic Hall",
        startDate: "2026-06-18T20:00:00+02:00",
        url: "https://www.jambase.com/show/event-42",
        performers: [{ identifier: "artist-7", name: "The Signal Keeps" }],
        venue: { identifier: "venue-9", name: "Civic Hall", city: "Cape Town" },
        tour: { name: "City Voltage Tour" },
        lineup: [{ name: "The Signal Keeps" }, { name: "Northline Echo" }],
        setlist: { songs: [{ name: "Signal Fire" }, { name: "Midnight Atlas" }, { name: "Afterimage" }] }
      }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { buildLiveContext, searchEvents } = await import("./jambase");
    const events = await searchEvents({ artist: "The Signal Keeps", city: "Cape Town", date: "2026-06-18" });
    const context = buildLiveContext(events[0], {
      id: "track-1",
      title: "Midnight Atlas",
      artist: "The Signal Keeps",
      hasLyrics: true,
      hasSubtitles: true,
      source: "musixmatch"
    });

    expect(events[0]).toMatchObject({ id: "event-42", artistId: "artist-7", venueId: "venue-9", tourName: "City Voltage Tour" });
    expect(context?.setlist.position).toBe(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer jambase-test-key" });
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("apikey");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
