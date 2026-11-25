// The 3D stage as a React component. The engine (and three.js with it) is loaded on first use, so
// it's never in the main bundle. When WebGL can't start, `fallback` is shown instead.

import { useEffect, useRef, useState } from "react";
import type { PipStage, StageOptions } from "./engine";
import type { Look } from "./look";

/** The engine module, loaded once. */
let engine: Promise<typeof import("./engine")> | null = null;
export const loadEngine = () => (engine ??= import("./engine"));

/** People who ask for less motion get a still Pip to start with. */
export function prefersStill(): boolean {
  try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export function Pip3D({ look, still, active = true, mood, fallback, onStage, label, className, framing, music = false }: {
  framing?: StageOptions["framing"];
  /** Music playing on her Mac (the Mac app): headphones for now, never saved into the look. */
  music?: boolean;
  look: Look;
  still: boolean;
  /** False: draw once and wait (off screen, or another preview is live). */
  active?: boolean;
  mood?: StageOptions["mood"];
  fallback: React.ReactNode;
  onStage?: (s: PipStage | null) => void;
  label: string;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<PipStage | null>(null);
  const [failed, setFailed] = useState(false);
  // The latest props, for the moment the engine arrives.
  const latest = useRef({ look, still, active, mood, music });
  latest.current = { look, still, active, mood, music };

  useEffect(() => {
    let gone = false;
    loadEngine().then((m) => {
      if (gone || !canvas.current) return;
      if (!m.webglAvailable()) { setFailed(true); return; }
      const l = latest.current;
      try {
        stage.current = m.createPipStage(canvas.current, l.look, { still: l.still, active: l.active, mood: l.mood, framing, music: l.music });
        shown.current = JSON.stringify(l.look);
        onStage?.(stage.current);
      } catch (err) {
        console.warn("[pip3d] couldn't start the 3D stage:", (err as Error).message);
        setFailed(true);
      }
    }).catch(() => { if (!gone) setFailed(true); });
    return () => {
      gone = true;
      stage.current?.dispose();
      stage.current = null;
      onStage?.(null);
    };
    // The stage lives as long as the component; changes below are passed in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Rebuilding a chibi isn't free: only when the look really changed.
  const lookKey = JSON.stringify(look);
  const shown = useRef(lookKey);
  useEffect(() => {
    if (!stage.current || shown.current === lookKey) return;
    shown.current = lookKey;
    stage.current.setLook(look);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookKey]);
  useEffect(() => { stage.current?.setStill(still); }, [still]);
  useEffect(() => { stage.current?.setActive(active); }, [active]);
  useEffect(() => { if (mood) stage.current?.setMood(mood); }, [mood]);
  useEffect(() => { stage.current?.setMusic(music); }, [music]);

  if (failed) return <>{fallback}</>;
  return (
    <div className={`p3d ${className ?? ""}`}>
      <canvas ref={canvas} role="img" aria-label={label} />
    </div>
  );
}
