// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PublicError, apiErrorHandler } from "./errors";

type CapturedResponse = {
  statusCode?: number;
  payload?: unknown;
  status(code: number): CapturedResponse;
  json(body: unknown): CapturedResponse;
};

function captureResponse(): CapturedResponse {
  const res: CapturedResponse = {
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.payload = body;
      return res;
    }
  };
  return res;
}

const noopReq = {} as never;
const noopNext = (() => {}) as never;

describe("apiErrorHandler", () => {
  it("surfaces PublicError messages and status so retries report the real reason", () => {
    const res = captureResponse();

    apiErrorHandler(
      new PublicError("Whisper fallback retry failed: provider unreachable", 502),
      noopReq,
      res as never,
      noopNext
    );

    expect(res.statusCode).toBe(502);
    expect(res.payload).toEqual({ error: "Whisper fallback retry failed: provider unreachable" });
  });

  it("keeps unexpected errors generic to avoid leaking internals", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = captureResponse();

    apiErrorHandler(new Error("connect ECONNREFUSED 10.0.0.5:5432"), noopReq, res as never, noopNext);

    expect(res.statusCode).toBe(500);
    expect(res.payload).toEqual({ error: "Unexpected server error." });
    consoleError.mockRestore();
  });
});
