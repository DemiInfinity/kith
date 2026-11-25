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
