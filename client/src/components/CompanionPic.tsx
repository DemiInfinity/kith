// The companion as a small picture: the chat picture made from the 3D Pip when there is one
// (My Pip saves it), otherwise the 2D avatar. The larger animated views (calls, the profile
// panel's Pip, picking a look) stay as the 2D avatar.

import { useSyncExternalStore } from "react";
import type { Look, Mood } from "../api";
import { Avatar } from "./Avatar";

// When the saved picture last changed (null: there isn't one). Set from /api/me and /api/state,
// and straight away when My Pip saves.
let version: number | null = null;
const listeners = new Set<() => void>();
export function setPipPicture(v: number | null | undefined) {
  const next = v ?? null;
  if (next === version) return;
  version = next;
  for (const l of listeners) l();
}
export const pipPictureVersion = () => version;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function usePipPicture(): number | null {
  return useSyncExternalStore(subscribe, pipPictureVersion, pipPictureVersion);
}
export const pipPictureUrl = (v: number) => `/api/pip/picture.png?v=${v}`;

export function CompanionPic({ look, mood = "happy", size = 52, variant = "plain", laptop = false, alt = "" }: {
  look: Look; mood?: Mood; size?: number; variant?: "plain" | "ring" | "halo" | "side"; laptop?: boolean; alt?: string;
}) {
  const v = usePipPicture();
  if (v === null) return <Avatar look={look} mood={mood} size={size} variant={variant} laptop={laptop} />;
  return (
    <span className={`orb ${variant} pic`} style={{ width: size, height: size }}>
      <img src={pipPictureUrl(v)} alt={alt} width={size} height={size} draggable={false}
        onError={() => setPipPicture(null)} />
    </span>
  );
}
