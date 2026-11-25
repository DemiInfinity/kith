// The companion as a small picture: the chat picture made from the 3D Pip when there is one
// (My Pip saves it), otherwise the 2D avatar.
// - It follows Pip's mood: My Pip saves a still for each of happy, thinking, sleepy and listening.
// - It can come alive as the live 3D Pip: `live="on"` while it's shown (the header, at a low frame
//   rate; the profile panel), `live="hover"` only while a mouse is over it. Never with reduced motion.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, type Look, type Mood } from "../api";
import { Avatar } from "./Avatar";
import type { PipStage } from "../pip3d/engine";
import { normaliseLook, type Look as Look3D, type Mood3D } from "../pip3d/look";

// When the saved picture last changed (null: there isn't one). Set from /api/me and /api/state,
// and straight away when My Pip saves.
let version: number | null = null;
const listeners = new Set<() => void>();
export function setPipPicture(v: number | null | undefined) {
  const next = v ?? null;
  if (next === version) return;
  version = next;
  look3d = null;
  for (const l of listeners) l();
}
export const pipPictureVersion = () => version;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function usePipPicture(): number | null {
  return useSyncExternalStore(subscribe, pipPictureVersion, pipPictureVersion);
}

/** The moods the saved stills cover (in step with PICTURE_MOODS in server/src/pip/look.ts). */
export const PICTURE_MOODS = ["happy", "thinking", "sleepy", "listening"] as const;
export type PictureMood = (typeof PICTURE_MOODS)[number];
const MOOD_PIC: Record<Mood, PictureMood> = { happy: "happy", thinking: "thinking", sleepy: "sleepy", resting: "sleepy", concerned: "listening" };
export const pipPictureUrl = (v: number, mood?: PictureMood) => `/api/pip/picture.png?v=${v}${mood ? `&mood=${mood}` : ""}`;

// The saved 3D look, fetched once (for the live picture).
let look3d: Promise<Look3D | null> | null = null;
/** The saved 3D look (null when there isn't one), fetched once and cached until My Pip saves again. */
export const savedLook = () => (look3d ??= api<{ look: unknown }>("/api/pip/look").then((r) => (r.look ? normaliseLook(r.look) : null)).catch(() => null));

const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

export function CompanionPic({ look, mood = "happy", size = 52, variant = "plain", laptop = false, alt = "", live = "off" }: {
  look: Look; mood?: Mood; size?: number; variant?: "plain" | "ring" | "halo" | "side"; laptop?: boolean; alt?: string; live?: "off" | "hover" | "on";
}) {
  const v = usePipPicture();
  const [hover, setHover] = useState(false);
  if (v === null) return <Avatar look={look} mood={mood} size={size} variant={variant} laptop={laptop} />;
  const pm = MOOD_PIC[mood] ?? "happy";
  const alive = live === "on" || (live === "hover" && hover);
  return (
    <span className={`orb ${variant} pic`} style={{ width: size, height: size, position: "relative" }}
      onPointerEnter={live === "hover" ? (e) => { if (e.pointerType === "mouse") setHover(true); } : undefined}
      onPointerLeave={live === "hover" ? () => setHover(false) : undefined}>
      <img key={pm} className="pic-mood" src={pipPictureUrl(v, pm)} alt={alt} width={size} height={size} draggable={false}
        onError={() => setPipPicture(null)} />
      {alive && !reducedMotion() && <LivePic mood={pm} version={v} fps={size <= 72 ? 24 : 0} />}
    </span>
  );
}

/** The live 3D Pip over the still picture: loads the engine on first use and fades in when ready. */
function LivePic({ mood, version: v, fps }: { mood: Mood3D; version: number; fps: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stage = useRef<PipStage | null>(null);
  const [ready, setReady] = useState(false);
  const first = useRef(mood);
  useEffect(() => {
    let gone = false;
    let io: IntersectionObserver | null = null;
    void (async () => {
      const l = await savedLook();
      if (gone || !l || !ref.current) return;
      const { createPipStage, webglAvailable } = await import("../pip3d/engine");
      if (gone || !ref.current || !webglAvailable()) return;
      try { stage.current = createPipStage(ref.current, l, { framing: "portrait", mood: first.current, maxFps: fps, active: false }); setReady(true); } catch { /* the still stays */ return; }
      // Only moves while it can be seen (the phone and computer headers are both on the page; one is hidden).
      io = new IntersectionObserver(([e]) => stage.current?.setActive(!!e?.isIntersecting));
      io.observe(ref.current);
    })();
    return () => { gone = true; io?.disconnect(); stage.current?.dispose(); stage.current = null; };
  }, [v]);
  useEffect(() => { stage.current?.setMood(mood); }, [mood]);
  return <canvas ref={ref} className={`pic-live ${ready ? "on" : ""}`} aria-hidden="true" />;
}
