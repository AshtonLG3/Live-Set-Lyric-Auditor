import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Camera,
  CircleAlert,
  ExternalLink,
  FileAudio,
  FileCheck2,
  FileVideo,
  Fingerprint,
  Link2,
  Mic,
  Play,
  Search,
  ShieldCheck,
  Square,
  Trash2,
  Upload
} from "lucide-react";
import type { ClipSource, RecallRescueResponse, TrackCandidate, TranscriptSegment } from "../../shared/types";
import { MAX_CLIP_SECONDS, MAX_RECALL_SECONDS, TARGET_CLIP_SECONDS } from "../../shared/version";
import { rescueRecall } from "../api";
import { formatFileSize, inspectClip, type ClipSelection } from "../clip";
import { formatSourceTime, parseLiveSource } from "../source";

export type IntakeAnalysisInput = {
  file?: File;
  durationSeconds?: number;
  autoMatch: boolean;
  source: ClipSource;
  recallSegments?: TranscriptSegment[];
};

type IntakeMode = "upload" | "live_link" | "recall";

type Props = {
  busy: boolean;
  onAnalyze: (input: IntakeAnalysisInput) => Promise<void> | void;
  onTrackMatched: (track: TrackCandidate) => void;
};

export function ClipIntake({ busy, onAnalyze, onTrackMatched }: Props) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const excerptInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [mode, setMode] = useState<IntakeMode>("upload");
  const [autoMatch, setAutoMatch] = useState(true);
  const [uploadClip, setUploadClip] = useState<ClipSelection>();
  const [linkClip, setLinkClip] = useState<ClipSelection>();
  const [fileError, setFileError] = useState("");
  const [fileProcessing, setFileProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(30);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingFile, setRecordingFile] = useState<File>();
  const [recordingUrl, setRecordingUrl] = useState("");
  const [recordingError, setRecordingError] = useState("");
  const [rememberedWords, setRememberedWords] = useState("");
  const [recallBusy, setRecallBusy] = useState(false);
  const [recallResult, setRecallResult] = useState<RecallRescueResponse>();
  const [matchedTrackId, setMatchedTrackId] = useState("");

  const parsedSource = useMemo(
    () => parseLiveSource(sourceUrl, startSeconds, endSeconds),
    [sourceUrl, startSeconds, endSeconds]
  );
  const rangeDuration = endSeconds - startSeconds;
  const validRange = rangeDuration > 0 && rangeDuration <= MAX_CLIP_SECONDS;
  const liveSourceReady = Boolean(parsedSource && (parsedSource.provider === "youtube" || linkClip));
  const microphoneUnavailableMessage = getMicrophoneUnavailableMessage();
  const matchedTrack = recallResult?.candidates.find((track) => track.id === matchedTrackId);
  const recallAnalysisReady = Boolean(recallResult?.segments.length);

  useEffect(() => () => {
    stopMediaStream();
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
  }, []);

  useEffect(() => () => {
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  }, [recordingUrl]);

  async function importClip(file: File | undefined, target: "upload" | "link") {
    setFileError("");
    if (!file) return;
    setFileProcessing(true);
    try {
      const inspected = await inspectClip(file);
      if (target === "upload") setUploadClip(inspected);
      else setLinkClip(inspected);
    } catch (error) {
      if (target === "upload") setUploadClip(undefined);
      else setLinkClip(undefined);
      setFileError(error instanceof Error ? error.message : "Could not import this clip.");
    } finally {
      setFileProcessing(false);
    }
  }

  async function startRecording() {
    setRecordingError("");
    setRecallResult(undefined);
    if (microphoneUnavailableMessage) {
      setRecordingError(microphoneUnavailableMessage);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      setRecordingSeconds(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => finishRecording(recorder.mimeType || mimeType || "audio/webm");
      recorder.start(500);
      setIsRecording(true);
      const startedAt = Date.now();
      recordingTimerRef.current = window.setInterval(() => {
        const seconds = Math.min(MAX_RECALL_SECONDS, Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
        setRecordingSeconds(seconds);
        if (seconds >= MAX_RECALL_SECONDS && recorder.state === "recording") recorder.stop();
      }, 500);
    } catch (error) {
      stopMediaStream();
      setRecordingError(getMicrophoneCaptureErrorMessage(error));
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function stopMediaStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function finishRecording(mimeType: string) {
    if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    setIsRecording(false);
    stopMediaStream();
    const blob = new Blob(chunksRef.current, { type: mimeType });
    if (!blob.size) {
      setRecordingError("No microphone audio was captured.");
      return;
    }
    const extension = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
    const file = new File([blob], `remembered-lyric.${extension}`, { type: mimeType });
    setRecordingFile(file);
    setRecordingUrl(URL.createObjectURL(blob));
  }

  async function findRecallMatch() {
    if (!recordingFile && !rememberedWords.trim()) {
      setRecordingError("Record or enter the lyric fragment first.");
      return;
    }
    setRecallBusy(true);
    setRecordingError("");
    try {
      setRecallResult(await rescueRecall({ file: recordingFile, phrase: rememberedWords.trim() || undefined }));
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : "Recall Rescue could not search this fragment.");
    } finally {
      setRecallBusy(false);
    }
  }

  function useRecallMatch(track: TrackCandidate) {
    onTrackMatched(track);
    setMatchedTrackId(track.id);
    setAutoMatch(false);
  }

  function removeUploadClip() {
    setUploadClip(undefined);
    setFileError("");
    if (uploadInputRef.current) uploadInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }

  function removeLinkClip() {
    setLinkClip(undefined);
    setFileError("");
    if (excerptInputRef.current) excerptInputRef.current.value = "";
  }

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-md bg-slate-50 p-1 dark:bg-slate-900">
        <ModeButton active={mode === "upload"} onClick={() => setMode("upload")} icon={<Upload size={15} />} label="Upload clip" />
        <ModeButton active={mode === "live_link"} onClick={() => setMode("live_link")} icon={<Link2 size={15} />} label="Live link" />
        <ModeButton active={mode === "recall"} onClick={() => setMode("recall")} icon={<Mic size={15} />} label="Recall lyric fragment" />
      </div>

      {mode === "upload" && (
        <div
          data-testid="clip-dropzone"
          className={`flex min-h-44 flex-col items-center justify-center rounded-md border border-dashed px-4 py-5 text-center transition ${
            isDragging
              ? "border-ember bg-ember/10"
              : uploadClip
                ? "border-lagoon bg-lagoon/5"
                : "border-slate-300 bg-slate-50 hover:border-ember dark:border-slate-700 dark:bg-slate-900/70"
          }`}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false); }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            void importClip(event.dataTransfer.files?.[0], "upload");
          }}
        >
          {uploadClip ? (
            <ClipSummary
              clip={uploadClip}
              onReplace={() => uploadInputRef.current?.click()}
              onCapture={() => cameraInputRef.current?.click()}
              onRemove={removeUploadClip}
            />
          ) : (
            <>
              <FileAudio className={`mb-3 ${isDragging ? "text-ember" : "text-slate-500"}`} size={30} />
              <span className="text-base font-bold">{fileProcessing ? "Inspecting clip..." : isDragging ? "Drop clip to import" : "Drag a concert clip here"}</span>
              <span className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">
                Audio or video · target {TARGET_CLIP_SECONDS}s · max 40 MB
              </span>
              <div className="studio-capture-actions mt-4">
                <button type="button" className="button-secondary" onClick={() => uploadInputRef.current?.click()} disabled={fileProcessing}>
                  <Upload size={16} /> Browse files
                </button>
                <button type="button" className="button-secondary" onClick={() => cameraInputRef.current?.click()} disabled={fileProcessing}>
                  <Camera size={16} /> Record live
                </button>
              </div>
              <span className="mt-2 text-xs text-slate-500">Record live opens the rear camera on supported phones.</span>
            </>
          )}
          <input
            ref={uploadInputRef}
            className="sr-only"
            type="file"
            accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.mp4,.mov,.webm"
            onChange={(event) => void importClip(event.target.files?.[0], "upload")}
          />
          <input
            ref={cameraInputRef}
            className="sr-only"
            type="file"
            accept="video/*"
            capture="environment"
            aria-label="Record a live performance video"
            onChange={(event) => void importClip(event.target.files?.[0], "upload")}
          />
        </div>
      )}

      {mode === "live_link" && (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-bold uppercase text-slate-600 dark:text-slate-400">Live performance URL</span>
            <div className="flex gap-2">
              <input
                className="field w-full"
                type="url"
                placeholder="https://youtube.com/watch?v=..."
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                aria-label="Live performance URL"
              />
              {parsedSource && (
                <a className="icon-button" href={parsedSource.normalizedUrl} target="_blank" rel="noreferrer" aria-label="Open source link" title="Open source link">
                  <ExternalLink size={17} />
                </a>
              )}
            </div>
          </label>

          {sourceUrl && !parsedSource && <InlineNotice tone="warning" text="Enter a valid HTTP or HTTPS media link." />}

          {parsedSource?.provider === "youtube" && (
            <div className="rounded-md border border-slate-200 bg-slate-950 p-4 text-white dark:border-slate-700">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold">YouTube source ready</p>
                  <p className="mt-1 text-[13px] leading-5 text-slate-300">
                    Inline preview is unavailable for some videos. The selected range stays available for analysis.
                  </p>
                </div>
                <a
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-white/20 px-3 text-xs font-bold text-white transition hover:bg-white/10"
                  href={parsedSource.normalizedUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={15} /> Open on YouTube
                </a>
              </div>
              <div className="mt-3 inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1 text-xs font-semibold text-slate-100">
                <Link2 size={14} /> {formatSourceTime(startSeconds)}-{formatSourceTime(endSeconds)}
              </div>
            </div>
          )}

          {parsedSource?.provider !== "youtube" && parsedSource?.embedUrl && (
            <div className="aspect-video overflow-hidden rounded-md bg-black">
              <iframe
                className="h-full w-full"
                src={parsedSource.embedUrl}
                title="Live performance preview"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}

          {parsedSource && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
              <span className="inline-flex items-center gap-2 text-sm font-semibold"><Link2 size={16} className="text-lagoon" /> {parsedSource.label}</span>
              <span className="text-xs text-slate-500">source evidence</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="mb-1 block text-[12px] font-bold uppercase text-slate-600 dark:text-slate-400">Start</span>
              <input className="field w-full" type="number" min="0" value={startSeconds} onChange={(event) => setStartSeconds(Number(event.target.value))} aria-label="Clip start seconds" />
            </label>
            <label>
              <span className="mb-1 block text-[12px] font-bold uppercase text-slate-600 dark:text-slate-400">End</span>
              <input className="field w-full" type="number" min="1" value={endSeconds} onChange={(event) => setEndSeconds(Number(event.target.value))} aria-label="Clip end seconds" />
            </label>
          </div>
          <p className={`text-xs ${validRange ? "text-slate-500" : "text-ember"}`}>
            {formatSourceTime(startSeconds)}-{formatSourceTime(endSeconds)} · {Math.max(0, rangeDuration)}s selected · maximum {MAX_CLIP_SECONDS}s
          </p>

          <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
            {linkClip ? (
              <ClipSummary clip={linkClip} onReplace={() => excerptInputRef.current?.click()} onRemove={removeLinkClip} compact />
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold">Authorized excerpt</p>
                  <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-400">Optional audio/video for real processing.</p>
                </div>
                <button type="button" className="button-secondary shrink-0" onClick={() => excerptInputRef.current?.click()}>
                  <Upload size={16} /> Attach
                </button>
              </div>
            )}
            <input
              ref={excerptInputRef}
              className="sr-only"
              type="file"
              accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.mp4,.mov,.webm"
              onChange={(event) => void importClip(event.target.files?.[0], "link")}
            />
          </div>

          {!linkClip && parsedSource && (
            <InlineNotice
              tone={parsedSource.provider === "youtube" ? "neutral" : "warning"}
              text={parsedSource.provider === "youtube"
                ? "Only the selected YouTube time range is temporarily extracted for analysis. Hosted servers may need private YouTube cookies configured, or you can attach an authorized excerpt."
                : "Attach an authorized audio or video excerpt to analyze this provider."}
            />
          )}
        </div>
      )}

      {mode === "recall" && (
        <div className="space-y-3">
          <div className="flex min-h-32 flex-col items-center justify-center rounded-md border border-slate-200 bg-slate-50 p-4 text-center dark:border-slate-800 dark:bg-slate-900/70">
            <button
              type="button"
              className={`grid h-14 w-14 place-items-center rounded-full text-white transition ${isRecording ? "bg-ember" : microphoneUnavailableMessage ? "cursor-not-allowed bg-slate-500 opacity-70" : "bg-violetmark hover:bg-[#5e46e8]"}`}
              onClick={isRecording ? stopRecording : () => void startRecording()}
              disabled={!isRecording && Boolean(microphoneUnavailableMessage)}
              aria-label={isRecording ? "Stop recording" : "Record remembered lyric"}
              title={isRecording ? "Stop recording" : "Record remembered lyric"}
            >
              {isRecording ? <Square size={20} fill="currentColor" /> : <Mic size={23} />}
            </button>
            <p className="mt-3 text-base font-bold">{isRecording ? `Listening · ${recordingSeconds}s` : recordingFile ? "Fragment captured" : "Speak or sing the words you remember"}</p>
            <p className="mt-1 text-xs text-slate-500">Up to {MAX_RECALL_SECONDS} seconds</p>
            {recordingUrl && <audio className="mt-3 h-9 w-full" controls src={recordingUrl} />}
          </div>

          {microphoneUnavailableMessage && <InlineNotice tone="warning" text={microphoneUnavailableMessage} />}

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            <span className="text-xs text-slate-400">or enter words</span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </div>
          <textarea
            className="min-h-20 w-full resize-y rounded-md border border-slate-200 bg-white p-3 text-sm outline-none focus:border-lagoon focus:ring-2 focus:ring-lagoon/20 dark:border-slate-700 dark:bg-slate-950"
            placeholder="A line or a few words you remember"
            value={rememberedWords}
            onChange={(event) => setRememberedWords(event.target.value)}
            aria-label="Remembered lyric words"
          />
          <button type="button" className="button-secondary w-full" disabled={recallBusy || isRecording} onClick={() => void findRecallMatch()}>
            <Fingerprint size={17} /> {recallBusy ? "Searching lyrics..." : "Find the track"}
          </button>

          {recallResult && (
            <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-bold uppercase text-slate-600 dark:text-slate-400">Recognized fragment</p>
                  <p className="mt-1 text-sm leading-6">{recallResult.transcript}</p>
                </div>
                <span className="rounded-md bg-violetmark/10 px-2 py-1 text-[11px] font-semibold uppercase text-violetmark">{recallResult.mode.replaceAll("_", " ")}</span>
              </div>
              {recallResult.candidates.map((track) => (
                <button key={track.id} type="button" className={`select-row ${matchedTrackId === track.id ? "select-row-active" : ""}`} onClick={() => useRecallMatch(track)}>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-bold">{track.title}</span>
                    <span className="block truncate text-[13px] text-slate-600 dark:text-slate-400">{track.artist} · {track.album ?? "Catalog match"}</span>
                  </span>
                  {matchedTrackId === track.id ? <CheckCircle2 className="shrink-0 text-lagoon" size={18} /> : <Search className="shrink-0 text-slate-400" size={17} />}
                </button>
              ))}
              {matchedTrack && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button type="button" className="button-secondary w-full" onClick={() => setMode("upload")}>
                    <Upload size={16} /> Upload performance clip
                  </button>
                  <button type="button" className="button-secondary w-full" onClick={() => setMode("live_link")}>
                    <Link2 size={16} /> Use YouTube / live link
                  </button>
                </div>
              )}
              {recallAnalysisReady && (
                <button
                  type="button"
                  className="button-primary w-full"
                  disabled={busy || recallBusy}
                  onClick={() => void onAnalyze({
                    durationSeconds: recallDurationSeconds(recallResult?.segments),
                    autoMatch: !matchedTrackId,
                    source: { kind: "recall_recording", processingMode: "recall_recording" },
                    recallSegments: recallResult?.segments
                  })}
                >
                  <Play size={17} /> {matchedTrack ? `Analyze recalled fragment as ${matchedTrack.title}` : "Analyze recalled fragment"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {fileError && <p className="mt-2 text-sm text-ember">{fileError}</p>}
      {recordingError && <p className="mt-2 text-sm text-ember">{recordingError}</p>}

      {mode !== "recall" && (
        <div className="mt-3 rounded-md bg-slate-50 p-1 dark:bg-slate-900">
          <div className="grid grid-cols-2 gap-1">
            <button type="button" className={`segmented-button ${autoMatch ? "segmented-button-active" : ""}`} onClick={() => setAutoMatch(true)}>
              <Fingerprint size={15} /> Auto-identify vocal
            </button>
            <button type="button" className={`segmented-button ${!autoMatch ? "segmented-button-active" : ""}`} onClick={() => setAutoMatch(false)}>
              <Search size={15} /> Selected track
            </button>
          </div>
        </div>
      )}

      <div className="mt-4">
        {mode === "upload" && (
          <button
            type="button"
            className="button-primary w-full"
            disabled={busy || fileProcessing || !uploadClip || Boolean(fileError)}
            onClick={() => void onAnalyze({
              file: uploadClip?.file,
              durationSeconds: uploadClip?.durationSeconds,
              autoMatch,
              source: { kind: "upload", processingMode: "uploaded_media" }
            })}
          >
            <Play size={17} /> Analyze clip
          </button>
        )}
        {mode === "live_link" && (
          <button
            type="button"
            className="button-primary w-full"
            disabled={busy || fileProcessing || !liveSourceReady || !validRange || Boolean(fileError)}
            onClick={() => parsedSource && void onAnalyze({
              file: linkClip?.file,
              durationSeconds: linkClip?.durationSeconds ?? rangeDuration,
              autoMatch,
              source: {
                kind: "live_link",
                processingMode: linkClip ? "authorized_excerpt" : "provider_excerpt",
                provider: parsedSource.provider,
                url: parsedSource.normalizedUrl,
                startSeconds,
                endSeconds
              }
            })}
          >
            <Play size={17} /> Analyze selected range
          </button>
        )}
        {mode === "recall" && recordingFile && (
          <button
            type="button"
            className="button-primary w-full"
            disabled={busy || isRecording}
            onClick={() => void onAnalyze({
              file: recordingFile,
              durationSeconds: recordingSeconds || undefined,
              autoMatch: !matchedTrackId,
              source: { kind: "recall_recording", processingMode: "recall_recording" }
            })}
          >
            <Play size={17} /> {matchedTrack ? `Analyze as ${matchedTrack.title}` : "Audit this rendition"}
          </button>
        )}
      </div>

      {mode === "live_link" && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-500">
          <ShieldCheck className="mt-0.5 shrink-0 text-lagoon" size={14} />
          Original provider attribution and source URL remain attached to the Passport.
        </p>
      )}
    </div>
  );
}

function ModeButton(props: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" className={`segmented-button ${props.active ? "segmented-button-active" : ""}`} onClick={props.onClick}>
      {props.icon} {props.label}
    </button>
  );
}

function ClipSummary({ clip, onReplace, onCapture, onRemove, compact = false }: { clip: ClipSelection; onReplace: () => void; onCapture?: () => void; onRemove: () => void; compact?: boolean }) {
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    if (compact || clip.kind !== "video" || typeof URL.createObjectURL !== "function") {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(clip.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [clip.file, clip.kind, compact]);

  return (
    <div className={`flex w-full ${compact ? "items-center justify-between gap-3 text-left" : "flex-col items-center text-center"}`}>
      {previewUrl && <video className="studio-clip-preview" src={previewUrl} controls playsInline preload="metadata" aria-label="Imported live performance preview" />}
      <div className={compact ? "flex min-w-0 items-center gap-3" : "contents"}>
        {clip.kind === "video" ? <FileVideo className={compact ? "shrink-0 text-lagoon" : "mb-3 text-lagoon"} size={compact ? 24 : 30} /> : <FileCheck2 className={compact ? "shrink-0 text-lagoon" : "mb-3 text-lagoon"} size={compact ? 24 : 30} />}
        <div className="min-w-0">
          <span className="block max-w-full truncate text-[15px] font-bold">{clip.file.name}</span>
          <span className="mt-1 block text-[13px] text-slate-600 dark:text-slate-400">
            {clip.kind} · {formatFileSize(clip.file.size)} · {clip.durationSeconds ? `${clip.durationSeconds.toFixed(1)}s` : "duration checked on server"}
          </span>
        </div>
      </div>
      <div className={`${compact ? "shrink-0" : "studio-clip-summary-actions mt-4"} flex gap-2`}>
        <button type="button" className="button-secondary" onClick={onReplace}><Upload size={16} /> Replace</button>
        {onCapture && <button type="button" className="button-secondary" onClick={onCapture}><Camera size={16} /> Record another</button>}
        <button type="button" className="icon-button" onClick={onRemove} aria-label="Remove imported clip" title="Remove imported clip"><Trash2 size={17} /></button>
      </div>
    </div>
  );
}

function InlineNotice({ tone, text }: { tone: "neutral" | "warning"; text: string }) {
  return (
    <p className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs leading-5 ${tone === "warning" ? "bg-ember/10 text-ember" : "bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300"}`}>
      {tone === "warning" ? <CircleAlert className="mt-0.5 shrink-0" size={14} /> : <ShieldCheck className="mt-0.5 shrink-0 text-lagoon" size={14} />}
      {text}
    </p>
  );
}

function pickRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export function getMicrophoneUnavailableMessage(): string {
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return "Microphone capture needs HTTPS on mobile. Open this app from an HTTPS address, or enter the remembered words instead. Camera capture remains available under Upload clip.";
  }
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    return "Microphone recording is unavailable in this browser. Enter the remembered words instead, or use Record live under Upload clip.";
  }
  return "";
}

function getMicrophoneCaptureErrorMessage(error: unknown): string {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "Microphone access was blocked. Allow microphone permission in the browser's site settings, then try again.";
    if (error.name === "NotFoundError") return "No microphone was found on this device. Enter the remembered words instead.";
    if (error.name === "NotReadableError") return "The microphone is busy in another app. Close the other recording app, then try again.";
    if (error.name === "SecurityError") return "Microphone capture needs HTTPS on mobile. Open this app from an HTTPS address, then try again.";
  }
  return error instanceof Error && error.message ? error.message : "Microphone permission was not granted.";
}

function recallDurationSeconds(segments?: TranscriptSegment[]): number | undefined {
  const lastEnd = Math.max(0, ...(segments ?? []).map((segment) => Number(segment.end) || 0));
  return lastEnd > 0 ? lastEnd : undefined;
}
