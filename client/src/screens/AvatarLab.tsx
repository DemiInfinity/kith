import { useEffect, useRef, useState } from "react";
import { AvatarSvg, LOOKS } from "../components/Avatar";
import type { Mood } from "../api";

/** A review page for the avatar rig (not linked anywhere): every look, every pose, big, with a time scrubber. */
export function AvatarLab() {
  const [t, setT] = useState<number | null>(null);
  const [pose, setPose] = useState<"around" | "laptop" | "thinking" | "sleepy" | "talking">("around");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelectorAll<SVGElement>("svg *").forEach((e) => {
      e.style.animationPlayState = t === null ? "" : "paused";
      e.style.animationDelay = t === null ? "" : `-${t}s`;
    });
  }, [t, pose]);
  const mood: Mood = pose === "thinking" ? "thinking" : pose === "sleepy" ? "sleepy" : "happy";
  return (
    <div className="screen" style={{ maxWidth: 1200, margin: "0 auto" }}>
      <h2>Avatar lab</h2>
      <div className="chips">{(["around", "laptop", "talking", "thinking", "sleepy"] as const).map((p) => <button key={p} className={`chip ${pose === p ? "on" : ""}`} onClick={() => setPose(p)}>{p}</button>)}</div>
      <label className="row small">Time <input type="range" min={0} max={11} step={0.1} value={t ?? 0} onChange={(e) => setT(Number(e.target.value))} style={{ flex: 1 }} /> {t === null ? "playing" : `${t.toFixed(1)}s`} <button className="btn ghost small" onClick={() => setT(null)}>Play</button></label>
      <div ref={ref} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {LOOKS.map((l) => (
          <div key={l} className="card" style={{ alignItems: "center" }}>
            <span className="orb" style={{ width: 210, height: 210 }}><AvatarSvg look={l} size={200} mood={mood} laptop={pose === "laptop"} mouth={pose === "talking" ? 0.6 : 0} /></span>
            <b>{l}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
