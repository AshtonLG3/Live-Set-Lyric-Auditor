import type { EventCandidate, PerformanceContext, TrackCandidate, TranscriptSegment } from "../../shared/types";

export type CanonicalLine = {
  id: string;
  start: number;
  end: number;
  text: string;
};

export const fixtureTracks: TrackCandidate[] = [
  {
    id: "fixture-track-midnight-atlas",
    commonTrackId: "fixture-common-midnight-atlas",
    title: "Midnight Atlas",
    artist: "The Signal Keeps",
    album: "City Voltage (Studio)",
    isrc: "FIK202600001",
    durationSeconds: 226,
    hasLyrics: true,
    hasSubtitles: true,
    hasRichSync: true,
    instrumental: false,
    explicit: false,
    language: "en",
    genre: "Alternative / Electronic",
    releaseType: "Album",
    rating: 88,
    source: "fixture"
  },
  {
    id: "fixture-track-rooftop-static",
    commonTrackId: "fixture-common-rooftop-static",
    title: "Rooftop Static",
    artist: "Northline Echo",
    album: "After the Power Cut",
    hasLyrics: true,
    hasSubtitles: false,
    hasRichSync: false,
    instrumental: false,
    explicit: true,
    language: "en",
    genre: "Indie Rock",
    releaseType: "Single",
    rating: 74,
    source: "fixture"
  }
];

export const fixtureEvents: EventCandidate[] = [
  {
    id: "fixture-event-cape-town-2026",
    title: "The Signal Keeps at Civic Hall",
    artist: "The Signal Keeps",
    artistId: "fixture-artist-signal-keeps",
    venue: "Civic Hall",
    venueId: "fixture-venue-civic-hall",
    city: "Cape Town",
    date: "2026-06-18T20:00:00+02:00",
    tourName: "City Voltage Tour",
    lineup: ["The Signal Keeps", "Northline Echo"],
    setlist: {
      available: true,
      songs: ["Signal Fire", "Midnight Atlas", "Rooftop Static", "Afterimage"],
      sourceUrl: "https://www.jambase.com/"
    },
    url: "https://www.jambase.com/",
    source: "fixture"
  },
  {
    id: "fixture-event-berlin-2026",
    title: "The Signal Keeps at Hafen Club",
    artist: "The Signal Keeps",
    artistId: "fixture-artist-signal-keeps",
    venue: "Hafen Club",
    venueId: "fixture-venue-hafen-club",
    city: "Berlin",
    date: "2026-06-21T21:00:00+02:00",
    tourName: "City Voltage Tour",
    lineup: ["The Signal Keeps"],
    setlist: { available: false },
    url: "https://www.jambase.com/",
    source: "fixture"
  }
];

export const fixtureCanonicalLines: CanonicalLine[] = [
  { id: "L1", start: 0, end: 4, text: "The night opens slowly under electric skies" },
  { id: "L2", start: 4, end: 8, text: "We carry the chorus through the avenue" },
  { id: "L3", start: 8, end: 12, text: "Every bright window keeps calling us home" },
  { id: "L4", start: 12, end: 16, text: "Sing it once more until the morning arrives" },
  { id: "L5", start: 16, end: 20, text: "The city remembers the sound of our names" },
  { id: "L6", start: 20, end: 24, text: "We carry the chorus through the avenue" }
];

export const fixtureTranscript: TranscriptSegment[] = [
  {
    id: "T1",
    start: 0.3,
    end: 4.1,
    text: "The night opens slowly under electric skies",
    confidence: 0.93
  },
  {
    id: "T2",
    start: 4.2,
    end: 8.5,
    text: "Cape Town carry this chorus through the avenue",
    confidence: 0.84
  },
  {
    id: "T3",
    start: 8.7,
    end: 12.6,
    text: "Every bright window keeps calling us home",
    confidence: 0.9
  },
  {
    id: "T4",
    start: 12.8,
    end: 17.4,
    text: "Sing it once more sing it once more until the morning arrives",
    confidence: 0.86
  },
  {
    id: "T5",
    start: 17.6,
    end: 22.2,
    text: "We carry the chorus through the avenue tonight",
    confidence: 0.8
  }
];

export const fixtureRecallTranscript: TranscriptSegment[] = [
  {
    id: "R1",
    start: 0,
    end: 5.4,
    text: "We carry the chorus through the avenue",
    confidence: 0.84
  }
];

export const fixtureClipDuration = 24;

export const fixturePerformanceContext: PerformanceContext = {
  source: "fixture",
  status: "fallback",
  energyLevel: 0.86,
  bpm: 128,
  dominantEmotions: ["energetic", "uplifting", "powerful"],
  instruments: ["electric guitar", "synthesizer", "drums"],
  valence: 0.58,
  arousal: 0.9,
  arrangement: "high_intensity",
  summary: "High-intensity full-band performance with an energetic, crowd-facing arrangement.",
  confidence: 0.82
};
