import { describe, expect, it } from "vitest";
import { parseElevenLabsSegments } from "./elevenlabs";

describe("ElevenLabs Scribe transcription", () => {
  it("removes periods and marks same-timestamp second lines as backing vocals", async () => {
    const segments = parseElevenLabsSegments({
      language_probability: 0.98,
      words: [
        { text: "Hello.", start: 0, end: 0.3, type: "word", logprob: -0.05 },
        { text: "World.", start: 0.4, end: 0.8, type: "word", logprob: -0.05 },
        { text: "Lead", start: 5, end: 5.3, type: "word", logprob: -0.05 },
        { text: "line.", start: 5.4, end: 5.8, type: "word", logprob: -0.05 }
      ]
    });

    expect(segments.map((segment) => segment.text)).toEqual([
      "Hello",
      "(World)",
      "Lead line"
    ]);
  });
});
