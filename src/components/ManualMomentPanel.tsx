import { useState } from "react";
import { CircleAlert, Plus } from "lucide-react";
import type { VariantCandidate, VariantType } from "../../shared/types";
import { formatTime, parseTimecode } from "./studio-utils";

type Props = {
  currentTime: number;
  displayDuration: number;
  focusStart?: number;
  onAdd: (variant: VariantCandidate) => void;
  onClose: () => void;
};

export function ManualMomentPanel({ currentTime, displayDuration, focusStart, onAdd, onClose }: Props) {
  const [time, setTime] = useState(formatTime(currentTime || focusStart || 0));
  const [type, setType] = useState<VariantType>("crowd_response");
  const [text, setText] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");

  function submit() {
    const content = text.trim();
    if (!content) {
      setError("Enter the live words or audience response you heard.");
      return;
    }
    const start = parseTimecode(time);
    if (!Number.isFinite(start) || start < 0) {
      setError("Enter a valid timestamp, for example 00:05.6.");
      return;
    }
    const ref = reference.trim();
    const id = `M${Date.now().toString(36)}`;
    const end = Math.min(displayDuration || start + 2, start + 2);
    onAdd({
      id,
      type,
      start,
      end: Math.max(start + 0.5, end),
      liveText: content,
      canonicalAlignmentReference: ref ? "Manual anchor supplied by reviewer" : "Manual reviewer note; not detected by ASR",
      canonicalExcerpt: ref || undefined,
      confidence: 0.99,
      impactNote: "Human-added live moment. The automated transcript did not capture this evidence.",
      recommendedAction: type === "crowd_response"
        ? "Add as an audience-response caption or live-performance annotation."
        : "Preserve as a live-only caption note after reviewer approval.",
      translationRisk: type === "timing_drift" ? "low" : "medium",
      severity: "medium",
      evidenceSource: "manual_entry",
      reviewerNote: "Added manually from playback review."
    });
    onClose();
  }

  return (
    <section className="studio-rack-panel studio-manual-panel" aria-label="Add missed live moment">
      <header><span><Plus size={17} /> Add Missed Live Moment</span><small><i /> Human verified</small></header>
      <div className="studio-rack-body">
        <p className="studio-panel-intro">Use this when playback reveals words, ad-libs, or audience responses the ASR missed, such as a fan shouting a response after a sung line.</p>
        <div className="studio-manual-fields">
          <label><span>Time</span><input className="field" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Manual moment timestamp" placeholder="00:05.6" /></label>
          <label><span>Type</span><select className="field" value={type} onChange={(e) => setType(e.target.value as VariantType)} aria-label="Manual moment type"><option value="crowd_response">Crowd response</option><option value="adlib">Vocal ad-lib</option><option value="extension">Extended phrase</option><option value="timing_drift">Timing note</option><option value="uncertain">Uncertain</option></select></label>
          <label className="studio-manual-wide"><span>Live content</span><input className="field" value={text} onChange={(e) => setText(e.target.value)} aria-label="Manual live content" placeholder="fan shouts: better!" /></label>
          <label className="studio-manual-wide"><span>Reference excerpt or anchor</span><input className="field" value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Reference excerpt or anchor" placeholder="near: How you broke my heart" /></label>
          <button type="button" className="studio-secondary-button" onClick={submit}><Plus size={15} /> Add live moment</button>
        </div>
        {error && <p className="studio-inline-error"><CircleAlert size={15} /> {error}</p>}
      </div>
    </section>
  );
}
