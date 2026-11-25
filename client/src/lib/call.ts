// The call screen's small decisions, kept apart from the screen so they can be tested.

import type { Mood } from "../api";
import type { Mood3D } from "../pip3d/look";

export type CallPhase = "idle" | "listening" | "hearing" | "thinking" | "speaking" | "ended";

/**
 * Which Pip the call shows: the full 3D Pip when there's a saved look and WebGL works, otherwise the
 * 2D avatar as before. "wait" while the look is still loading (only when a picture says there is one).
 */
export function callView(a: { picture: number | null; look: unknown | null | undefined; webgl: boolean | undefined; failed: boolean }): "3d" | "2d" | "wait" {
  if (a.failed || a.picture === null || a.look === null || a.webgl === false) return "2d";
  if (a.look === undefined || a.webgl === undefined) return "wait";
  return "3d";
}

/** The 3D Pip's mood in a call: listening while she speaks, thinking while it waits, its own mood when it talks. */
export function callMood(phase: CallPhase, mood: Mood): Mood3D {
  if (phase === "listening") return "listening";
  if (phase === "hearing" || phase === "thinking") return "thinking";
  return ({ happy: "happy", thinking: "thinking", sleepy: "sleepy", resting: "sleepy", concerned: "listening" } as const)[mood] ?? "happy";
}

/** How she talks in a call: Kith notices when she starts and stops ("handsfree"), or she taps the mic ("tap"). */
export type CallMode = "handsfree" | "tap";
const MODE_KEY = "kith-call-mode";
/** Her last choice (tap to talk until she picks hands-free). */
export function savedCallMode(): CallMode {
  try { return localStorage.getItem(MODE_KEY) === "handsfree" ? "handsfree" : "tap"; } catch { return "tap"; }
}
export function saveCallMode(m: CallMode) {
  try { localStorage.setItem(MODE_KEY, m); } catch { /* fine: it's remembered for this call */ }
}

/** Hands-free's ear: "start" needs a tap first (the browser wants one before the mic), "ready" learns the room, "open" is waiting for her. */
export type Ear = "off" | "start" | "ready" | "open";

/** The words under Pip in a call (and in the mini call), announced as they change. */
export function callStatus(a: { phase: CallPhase; mode: CallMode; muted: boolean; ear: Ear; name: string }): string {
  const { phase, name } = a;
  if (phase === "ended") return `${name} hung up`;
  if (phase === "speaking") return a.mode === "handsfree" ? `${name} is talking… tap the mic to cut in` : `${name} is talking…`;
  if (phase === "thinking") return `${name} is thinking…`;
  if (phase === "hearing") return "Got it…";
  if (phase === "listening") return "Listening…";
  if (a.muted) return "You’re muted";
  if (a.mode === "tap") return "Tap the mic to talk";
  if (a.ear === "ready") return "Getting ready to listen…";
  if (a.ear === "open") return "Go ahead, I’m listening";
  return "Tap the mic to start";
}

/** The mini call's corners. */
export type Corner = "tl" | "tr" | "bl" | "br";
/** Where the mini call snaps when she lets go of it: the corner nearest its middle. */
export function nearestCorner(cx: number, cy: number, width: number, height: number): Corner {
  return `${cy < height / 2 ? "t" : "b"}${cx < width / 2 ? "l" : "r"}` as Corner;
}
const CORNER_KEY = "kith-mini-corner";
export function savedCorner(): Corner {
  try { const c = localStorage.getItem(CORNER_KEY); return c === "tl" || c === "tr" || c === "bl" || c === "br" ? c : "tr"; } catch { return "tr"; }
}
export function saveCorner(c: Corner) {
  try { localStorage.setItem(CORNER_KEY, c); } catch { /* fine */ }
}
