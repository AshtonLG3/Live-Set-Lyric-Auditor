import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MediaPlayerBar } from "./MediaPlayerBar";

const noop = vi.fn();

function renderPlayer(active: boolean) {
  return render(
    <MediaPlayerBar
      jobId="job-trimmed"
      active={active}
      progress={35}
      onTimeUpdate={noop}
      onDurationChange={noop}
    />
  );
}

describe("MediaPlayerBar", () => {
  it("waits for analysis to finish before loading saved job media", () => {
    const { container, rerender } = renderPlayer(true);

    expect(container.querySelector("audio")).toBeNull();
    expect(screen.getByRole("button", { name: /Play analyzed clip/i })).toBeDisabled();
    expect(screen.queryByRole("slider", { name: /Seek analyzed clip/i })).not.toBeInTheDocument();

    rerender(
      <MediaPlayerBar
        jobId="job-trimmed"
        active={false}
        progress={100}
        onTimeUpdate={noop}
        onDurationChange={noop}
      />
    );

    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio).toHaveAttribute("src", "/api/analyze/job-trimmed/media?ready=1");
    expect(screen.getByRole("button", { name: /Play analyzed clip/i })).toBeEnabled();
    expect(screen.getByRole("slider", { name: /Seek analyzed clip/i })).toBeInTheDocument();
  });
});
