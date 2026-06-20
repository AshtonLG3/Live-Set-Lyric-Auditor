import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Camera,
  CircleAlert,
  FileAudio,
  FileCheck2,
  FileVideo,
  Fingerprint,
  Mic,
  Play,
  Search,
  ShieldCheck,
  Square,
  Trash2,
  Upload
} from "lucide-react";
import type { ClipSource, RecallRescueResponse, TrackCandidate, TranscriptSegment } from "../../shared/types";
import { MAX_RECALL_SECONDS, TARGET_CLIP_SECONDS } from "../../shared/version";
import { rescueRecall } from "../api";
import { formatFileSize, inspectClip, type ClipSelection } from "../clip";

export type IntakeAnalysisInput = {
  file?: File;
  durationSeconds?: number;
  autoMatch: boolean;
  source: ClipSource;
  recallSegments?: TranscriptSegment[];
};

type IntakeMode = "upload" | "recall";

type Props = {
  busy: boolean;
  tracks: TrackCandidate[];
  selectedTrack?: TrackCandidate;
  trackQuery: string;
  onAnalyze: (input: IntakeAnalysisInput) => Promise<void> | void;
  onTrackMatched: (track: TrackCandidate) => void;
  onTrackQueryChange: (value: string) => void;
  onTrackSearch: () => Promise<void> | void;
  onTrackSelect: (track: TrackCandidate) => void;
};

export function ClipIntake({
  busy,
  tracks,
  selectedTrack,
  trackQuery,
  onAnalyze,
  onTrackMatched,
  onTrackQueryChange,
  onTrackSearch,
  onTrackSelect
}: Props) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [mode, setMode] = useState<IntakeMode>("upload");
  const [autoMatch, setAutoMatch] = useState(true);
  const [uploadClip, setUploadClip] = useState<ClipSelection>();
  const [fileError, setFileError] = useState("");
  const [fileProcessing, setFileProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingFile, setRecordingFile] = useState<File>();
  const [recordingUrl, setRecordingUrl] = useState("");
  const [recordingError, setRecordingError] = useState("");
  const [rememberedWords, setRememberedWords] = useState("");
  const [recallBusy, setRecallBusy] = useState(false);
  const [recallResult, setRecallResult] = useState<RecallRescueResponse>();
  const [matchedTrackId, setMatchedTrackId] = useState("");

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

  async function importClip(file: File | undefined) {
    setFileError("");
    if (!file) return;
    setFileProcessing(true);
    try {
      const inspected = await inspectClip(file);
      setUploadClip(inspected);
    } catch (error) {
      setUploadClip(undefined);
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

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-slate-50 p-1 dark:bg-slate-900">
        <ModeButton active={mode === "upload"} onClick={() => setMode("upload")} icon={<Upload size={15} />} label="Upload clip" />
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
            void importClip(event.dataTransfer.files?.[0]);
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
            onChange={(event) => void importClip(event.target.files?.[0])}
          />
          <input
            ref={cameraInputRef}
            className="sr-only"
            type="file"
            accept="video/*"
            capture="environment"
            aria-label="Record a live performance video"
            onChange={(event) => void importClip(event.target.files?.[0])}
          />
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
                <button type="button" className="button-secondary w-full" onClick={() => setMode("upload")}>
                  <Upload size={16} /> Upload performance clip
                </button>
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

      {mode !== "recall" && !autoMatch && (
        <section className="studio-inline-anchor" aria-label="Selected track anchor">
          <div className="studio-inline-anchor-head">
            <span><Search size={15} /> Track Anchor</span>
            <strong>{selectedTrack ? "Selected" : "Required"}</strong>
          </div>
          <p>{selectedTrack ? "This clip will compare against the selected Musixmatch recording." : "Search and select the Musixmatch recording before running selected-track analysis."}</p>
          <div className="studio-inline-anchor-search">
            <input className="field" value={trackQuery} onChange={(event) => onTrackQueryChange(event.target.value)} aria-label="Selected track search" placeholder="Track title or artist" />
            <button type="button" className="studio-square-button" onClick={() => void onTrackSearch()} aria-label="Search selected track" title="Search Musixmatch tracks"><Search size={18} /></button>
          </div>
          {selectedTrack && (
            <button type="button" className="select-row select-row-active" onClick={() => onTrackSelect(selectedTrack)} aria-label={`Selected track ${selectedTrack.title} by ${selectedTrack.artist}`}>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-bold">{selectedTrack.title}</span>
                <span className="block truncate text-[13px] text-slate-600 dark:text-slate-400">{selectedTrack.artist} · {selectedTrack.album ?? "Version pending"}</span>
              </span>
              <CheckCircle2 className="shrink-0 text-lagoon" size={18} />
            </button>
          )}
          {tracks.filter((track) => track.id !== selectedTrack?.id).slice(0, 4).map((track) => (
            <button key={track.id} type="button" className="select-row" onClick={() => onTrackSelect(track)}>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-bold">{track.title}</span>
                <span className="block truncate text-[13px] text-slate-600 dark:text-slate-400">{track.artist} · {track.album ?? "Catalog match"}</span>
              </span>
              <Search className="shrink-0 text-slate-400" size={17} />
            </button>
          ))}
        </section>
      )}

      <div className="mt-4">
        {mode === "upload" && (
          <button
            type="button"
            className="button-primary w-full"
            disabled={busy || fileProcessing || !uploadClip || Boolean(fileError) || (!autoMatch && !selectedTrack)}
            onClick={() => void onAnalyze({
              file: uploadClip?.file,
              durationSeconds: uploadClip?.durationSeconds,
              autoMatch,
              source: { kind: "upload", processingMode: "uploaded_media" }
            })}
          >
            <Play size={17} /> {!autoMatch && !selectedTrack ? "Choose track to analyze" : "Analyze clip"}
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
