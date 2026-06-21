import { useRef, useState } from "react";
import {
  Check,
  FileCheck2,
  Pencil,
  Play,
  Plus,
  X
} from "lucide-react";
import type {
  LineComparison,
  VariantCandidate
} from "../../shared/types";
import {
  type DiffWord,
  type ReviewDecision,
  type ReviewDecisions,
  computeInlineWordDiff,
  formatEvidenceTier,
  formatComparisonStatus,
  formatTime
} from "./studio-utils";

type Props = {
  comparisons: LineComparison[];
  variants: VariantCandidate[];
  decisions: ReviewDecisions;
  counts: { matched: number; changed: number; liveOnly: number; skipped: number; timing: number };
  confidence: number;
  rightsStatus?: string;
  onLiveTextEdit: (comparisonId: string, newText: string) => void;
  onDecision: (variantId: string, decision: ReviewDecision) => void;
  onInsertMoment: (afterStart: number) => void;
  onSeekToTime: (seconds: number) => void;
  onJoinWithNext: (current: LineComparison, next: LineComparison) => void;
  onSplitLine: (comparison: LineComparison) => void;
};

export function DiffView(props: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const variantMap = new Map(props.variants.map((v) => [v.id, v]));

  function startEdit(comparison: LineComparison) {
    setEditingId(comparison.id);
    setEditBuffer(comparison.liveText);
  }

  function commitEdit(comparisonId: string) {
    const trimmed = editBuffer.trim();
    if (trimmed) props.onLiveTextEdit(comparisonId, trimmed);
    setEditingId(null);
    setEditBuffer("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditBuffer("");
  }

  return (
    <section id="diff-view" className="studio-rack-panel studio-diff-view">
      <header>
        <span><FileCheck2 size={18} /> Passport Preview / Diff View</span>
        <small><i /> {props.rightsStatus === "display_allowed" || props.rightsStatus === "fixture" ? "Cached excerpts enabled" : "Reference restricted"}</small>
      </header>

      <div className="studio-diff-summary">
        <SummaryPill label="Matched" value={props.counts.matched} tone="match" />
        <SummaryPill label="Changed" value={props.counts.changed} tone="change" />
        <SummaryPill label="Live-only" value={props.counts.liveOnly} tone="live" />
        <SummaryPill label="Skipped" value={props.counts.skipped} tone="skip" />
        <SummaryPill label="Timing" value={props.counts.timing} tone="timing" />
        <span className="studio-diff-confidence">Overall {props.confidence}%</span>
      </div>

      <div className="studio-lyric-editor">
        {props.comparisons.map((comparison, index) => {
          const nextComparison = props.comparisons[index + 1];
          const variant = comparison.variantId ? variantMap.get(comparison.variantId) : undefined;
          const decision = comparison.variantId ? props.decisions[comparison.variantId] : undefined;
          const isEditing = editingId === comparison.id;
          const diff = computeInlineWordDiff(comparison.canonicalText ?? "", comparison.liveText);
          const isSkipped = comparison.status === "skipped";
          const hasChanges = diff.studio.some((w) => w.type === "removed") || diff.live.some((w) => w.type === "added");

          return (
            <div key={comparison.id}>
              {index > 0 && (
                <div className="studio-lyric-insert">
                  <button type="button" onClick={() => props.onInsertMoment(comparison.start)} aria-label="Add missed moment here" title="Add missed moment here"><Plus size={12} /></button>
                </div>
              )}

              <div className={`studio-lyric-row ${decision === "approved" ? "studio-lyric-approved" : decision === "rejected" ? "studio-lyric-rejected" : ""} status-${comparison.status}`}>
                <div className="studio-lyric-row-meta">
                  <button type="button" className="studio-lyric-time" onClick={() => props.onSeekToTime(comparison.start)} title="Seek to this moment">
                    <Play size={10} />
                    <span>{formatTime(comparison.start)}</span>
                  </button>
                  <span className={`studio-lyric-status status-${comparison.status}`}>{formatComparisonStatus(comparison.status)}</span>
                  {variant && <span className="studio-lyric-type">{variant.type.replaceAll("_", " ")}</span>}
                  {comparison.evidenceTier && <span className={`studio-evidence-tier tier-${comparison.evidenceTier}`}>{formatEvidenceTier(comparison.evidenceTier)}</span>}
                </div>

                {comparison.canonicalText && hasChanges && !isSkipped && (
                  <p className="studio-lyric-reference">
                    <DiffWords words={diff.studio} />
                  </p>
                )}

                <div className="studio-lyric-live-row">
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      className="field studio-lyric-input"
                      value={editBuffer}
                      onChange={(e) => setEditBuffer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(comparison.id);
                        if (e.key === "Escape") cancelEdit();
                      }}
                      onBlur={() => commitEdit(comparison.id)}
                      autoFocus
                      aria-label="Edit live transcription"
                    />
                  ) : (
                    <p
                      className={`studio-lyric-text ${isSkipped ? "studio-lyric-skipped" : ""} ${decision === "rejected" ? "studio-lyric-struck" : ""}`}
                      onClick={() => !isSkipped && startEdit(comparison)}
                      title={isSkipped ? undefined : "Click to edit"}
                    >
                      {isSkipped
                        ? "[not detected in live vocal]"
                        : hasChanges
                          ? <DiffWords words={diff.live} />
                          : comparison.liveText
                      }
                      {!isSkipped && <Pencil className="studio-lyric-edit-icon" size={11} />}
                    </p>
                  )}

                  {variant && !isEditing && (
                    <div className="studio-lyric-actions">
                      <button
                        type="button"
                        className={`studio-lyric-btn ${decision === "approved" ? "studio-lyric-btn-approved" : ""}`}
                        onClick={() => props.onDecision(variant.id, "approved")}
                        aria-label="Approve variant"
                        title="Approve variant"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        className={`studio-lyric-btn ${decision === "rejected" ? "studio-lyric-btn-rejected" : ""}`}
                        onClick={() => props.onDecision(variant.id, "rejected")}
                        aria-label="Reject variant"
                        title="Reject variant"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {!isEditing && !isSkipped && (
                  <div className="studio-lyric-tools" aria-label="Line edit tools">
                    {nextComparison && <button type="button" onClick={() => props.onJoinWithNext(comparison, nextComparison)}>Join next</button>}
                    <button type="button" onClick={() => props.onSplitLine(comparison)}>Split line</button>
                  </div>
                )}

                {decision && (
                  <p className={`studio-lyric-decision-label ${decision === "approved" ? "approved" : "rejected"}`}>
                    {decision === "approved" ? "Approved" : "Rejected"}
                  </p>
                )}
                {variant?.reviewerNote && <p className="studio-lyric-review-note">{variant.reviewerNote}</p>}
              </div>
            </div>
          );
        })}

        {props.comparisons.length > 0 && (
          <div className="studio-lyric-insert studio-lyric-insert-last">
            <button type="button" onClick={() => props.onInsertMoment(props.comparisons[props.comparisons.length - 1].end)} aria-label="Add missed moment at end" title="Add missed moment at end"><Plus size={12} /></button>
          </div>
        )}
      </div>
    </section>
  );
}

function DiffWords({ words }: { words: DiffWord[] }) {
  return (
    <>
      {words.map((w, i) => (
        <span key={i} className={w.type === "removed" ? "studio-diff-word-removed" : w.type === "added" ? "studio-diff-word-added" : ""}>
          {w.word}{i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

function SummaryPill({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`studio-diff-pill tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
