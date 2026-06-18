import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { WaveformCanvas } from "./WaveformCanvas";
import { formatOffset, formatTime } from "./studio-utils";
import type { VariantCandidate } from "../../shared/types";

type Props = {
  jobId?: string;
  active: boolean;
  progress: number;
  focusVariant?: VariantCandidate;
  onTimeUpdate: (time: number) => void;
  onDurationChange: (duration: number) => void;
};

export type MediaPlayerHandle = {
  seekTo: (seconds: number, play?: boolean) => void;
};

export const MediaPlayerBar = forwardRef<MediaPlayerHandle, Props>(function MediaPlayerBar({ jobId, active, progress, focusVariant, onTimeUpdate, onDurationChange }, ref) {
  const mediaRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const mediaUrl = jobId ? `/api/analyze/${jobId}/media` : "";
  const displayDuration = mediaDuration;
  const playbackProgress = displayDuration > 0 ? Math.min(100, currentTime / displayDuration * 100) : 0;
  const engineProgress = active ? Math.max(8, progress) : playbackProgress;

  useEffect(() => {
    setCurrentTime(0);
    setMediaDuration(0);
    setIsPlaying(false);
  }, [jobId]);

  function seekTo(seconds: number, play = false) {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = Math.max(0, Math.min(seconds, media.duration || displayDuration || seconds));
    setCurrentTime(media.currentTime);
    onTimeUpdate(media.currentTime);
    if (play) void media.play().catch(() => setIsPlaying(false));
  }

  useImperativeHandle(ref, () => ({ seekTo }));

  function togglePlayback() {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => setIsPlaying(false));
    else media.pause();
  }

  function handleTimeUpdate(time: number) {
    setCurrentTime(time);
    onTimeUpdate(time);
  }

  function handleLoadedMetadata(duration: number) {
    setMediaDuration(duration);
    onDurationChange(duration);
  }

  return (
    <section className="studio-wavebar" aria-label="Live analysis waveform">
      {mediaUrl && (
        <audio
          ref={mediaRef}
          preload="metadata"
          src={mediaUrl}
          onLoadedMetadata={(e) => handleLoadedMetadata(e.currentTarget.duration)}
          onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget.currentTime)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />
      )}
      <div className="studio-wave-meta">
        <span className="studio-label">Live Engine Input</span>
        <div className="mt-2 flex items-center gap-3">
          <div className="studio-transport-group">
            <button type="button" className="studio-transport" disabled={active || !mediaUrl} onClick={() => seekTo(currentTime - 5)} aria-label="Rewind 5 seconds" title="Rewind 5 seconds"><RotateCcw size={17} /></button>
            <button type="button" className={`studio-transport ${isPlaying ? "studio-transport-active" : ""}`} disabled={active || !mediaUrl} onClick={togglePlayback} aria-label={isPlaying ? "Pause analyzed clip" : "Play analyzed clip"} title={isPlaying ? "Pause" : "Play"}>{isPlaying ? <Pause size={18} /> : <Play size={18} />}</button>
          </div>
          <div>
            <p className="studio-time">{formatOffset(active ? focusVariant?.start ?? progress / 4 : currentTime)}</p>
            <p className="studio-subtle">{active ? "Analyzing source" : `${formatTime(currentTime)} / ${formatTime(displayDuration)}`} · {active ? progress : Math.round(playbackProgress)}%</p>
          </div>
        </div>
      </div>
      <div className="studio-waveform">
        <WaveformCanvas progress={engineProgress} active={active || isPlaying} />
        {!active && mediaUrl && <input className="studio-wave-seek" type="range" min="0" max={Math.max(0.1, displayDuration)} step="0.1" value={Math.min(currentTime, displayDuration)} onChange={(e) => seekTo(Number(e.target.value))} aria-label="Seek analyzed clip" />}
        <span className="studio-wave-badge">{active ? "ANALYZING" : isPlaying ? "PLAYING" : "PASSPORT READY"}</span>
      </div>
      <div className="studio-sync">
        <span className="studio-label">Capture Status</span>
        <span className="studio-sync-badge"><span className={`studio-status-dot ${active || isPlaying ? "studio-status-dot-active" : ""}`} /> {active ? "ACTIVE SYNC" : isPlaying ? "PLAYING" : "VALIDATED"}</span>
      </div>
    </section>
  );
});
