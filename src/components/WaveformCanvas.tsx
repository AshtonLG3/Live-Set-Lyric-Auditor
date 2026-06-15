import { useEffect, useRef } from "react";

export function WaveformCanvas({ progress, active }: { progress: number; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (typeof CanvasRenderingContext2D === "undefined") return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const render = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(bounds.width * ratio));
      canvas.height = Math.max(1, Math.floor(bounds.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);

      const styles = getComputedStyle(canvas);
      const cyan = styles.getPropertyValue("--studio-cyan").trim() || "#25c9d4";
      const orange = styles.getPropertyValue("--studio-orange").trim() || "#ff5a36";
      const muted = styles.getPropertyValue("--studio-wave-muted").trim() || "#52606a";
      const center = bounds.height / 2;
      const bars = Math.max(48, Math.floor(bounds.width / 7));
      const gap = bounds.width / bars;

      for (let index = 0; index < bars; index += 1) {
        const signal = Math.sin(index * 1.91) * 0.32 + Math.sin(index * 0.43) * 0.24 + Math.sin(index * 0.17) * 0.18;
        const normalized = Math.min(0.94, Math.max(0.12, Math.abs(signal) + 0.22));
        const height = normalized * bounds.height * 0.76;
        const x = index * gap + gap / 2;
        const passed = index / bars <= progress / 100;
        context.strokeStyle = passed ? (index % 13 === 0 ? orange : cyan) : muted;
        context.globalAlpha = passed ? (active ? 0.95 : 0.76) : 0.42;
        context.lineWidth = Math.max(1, Math.min(2, gap * 0.28));
        context.beginPath();
        context.moveTo(x, center - height / 2);
        context.lineTo(x, center + height / 2);
        context.stroke();
      }

      const playheadX = Math.max(2, Math.min(bounds.width - 2, bounds.width * progress / 100));
      context.globalAlpha = 1;
      context.strokeStyle = orange;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(playheadX, 0);
      context.lineTo(playheadX, bounds.height);
      context.stroke();
    };

    render();
    const themeObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(render);
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", render);
      return () => {
        window.removeEventListener("resize", render);
        themeObserver?.disconnect();
      };
    }

    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      themeObserver?.disconnect();
    };
  }, [active, progress]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-label="Live vocal waveform and analysis playhead" />;
}
