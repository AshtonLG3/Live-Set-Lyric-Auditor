import { useEffect, useState } from "react";
import { CircleAlert, Pencil, Search } from "lucide-react";
import type { TrackCandidate } from "../../shared/types";
import { searchTracks } from "../api";
import { slugify } from "./studio-utils";

type Props = {
  track?: TrackCandidate;
  recovery?: boolean;
  onCorrectTrack: (track: TrackCandidate) => Promise<void> | void;
  onClose: () => void;
};

export function CorrectionPanel({ track, recovery = false, onCorrectTrack, onClose }: Props) {
  const [title, setTitle] = useState(track?.title ?? "");
  const [artist, setArtist] = useState(track?.artist ?? "");
  const [results, setResults] = useState<TrackCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTitle(track?.title ?? "");
    setArtist(track?.artist ?? "");
    setResults([]);
    setError("");
  }, [track?.id, track?.title, track?.artist]);

  async function findMatches() {
    const query = `${title} ${artist}`.trim();
    if (!query) return;
    setBusy(true);
    setError("");
    try {
      const matches = await searchTracks(query);
      setResults(matches);
      if (matches.length === 0) setError("No Musixmatch catalog matches found. You can still use the manual labels.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not search the catalog.");
    } finally {
      setBusy(false);
    }
  }

  async function applyCorrection(correctedTrack: TrackCandidate) {
    setBusy(true);
    setError("");
    try {
      await onCorrectTrack(correctedTrack);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not correct the track anchor.");
    } finally {
      setBusy(false);
    }
  }

  function applyManualCorrection() {
    const t = title.trim();
    const a = artist.trim();
    if (!t || !a) {
      setError("Enter both the correct track title and artist.");
      return;
    }
    void applyCorrection({
      id: `manual-${slugify(a)}-${slugify(t)}`,
      title: t,
      artist: a,
      hasLyrics: false,
      hasSubtitles: false,
      source: "manual"
    });
  }

  return (
    <section className="studio-rack-panel studio-correction-panel" aria-label={recovery ? "Choose track anchor" : "Correct track match"}>
      <header><span><Pencil size={17} /> {recovery ? "Choose Track Anchor" : "Correct Track Anchor"}</span><small><i /> {recovery ? "Transcript saved" : "No audio reprocessing"}</small></header>
      <div className="studio-rack-body">
        <p className="studio-panel-intro">{recovery ? "Auto-match failed, but the ASR transcript is preserved. Choose a Musixmatch recording or manual labels to generate the passport without rerunning the clip." : "Search for the correct Musixmatch recording, or preserve your own title and artist labels when the catalog match is wrong."}</p>
        <div className="studio-correction-fields">
          <label><span>Track title</span><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Correct track title" /></label>
          <label><span>Artist</span><input className="field" value={artist} onChange={(e) => setArtist(e.target.value)} aria-label="Correct track artist" /></label>
          <button type="button" className="studio-secondary-button" disabled={busy} onClick={() => void findMatches()}><Search size={15} /> {busy ? "Searching" : "Search catalog"}</button>
          <button type="button" className="studio-secondary-button" disabled={busy} onClick={applyManualCorrection}><Pencil size={15} /> Use manual labels</button>
        </div>
        {error && <p className="studio-inline-error"><CircleAlert size={15} /> {error}</p>}
        {results.length > 0 && <div className="studio-correction-results">{results.map((result) => <button key={result.id} type="button" onClick={() => void applyCorrection(result)}><strong>{result.title}</strong><span>{result.artist}{result.album ? ` · ${result.album}` : ""}</span></button>)}</div>}
      </div>
    </section>
  );
}
