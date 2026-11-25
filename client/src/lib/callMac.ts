// The call and the Mac app's own mini window (mac/src-tauri/src/mini.rs). Only in Kith.app, the
// child's; in a browser or Kith Parent none of this runs.
//
// When a call is on and she switches to another app, the Mac app shows a small always-on-top
// window with Pip (route /call-mini). That window only shows the call and has buttons: the audio,
// the microphone and the turns all stay here, in the main window. They talk by Tauri events:
// - here → mini: "kith:mini-state" (phase, mood, status, muted, ended…) and "kith:mini-mouth";
// - mini → here: "kith:mini-hello" (send me everything), and the app's commands mini_mute /
//   mini_end / mini_focus_main, which the app passes on as "kith:mini-action".
// The app says when the mini window shows or goes ("kith:mini-shown"): while it shows, the 3D Pip
// in this window rests, so only one moves at a time.

import { callMood, callStatus, type CallPhase, type Ear, type CallMode } from "./call";
import type { CallSession } from "./callSession";
import type { Mood3D } from "../pip3d/look";
import { tauri } from "./native";
import { pipPictureVersion } from "../components/CompanionPic";
import { musicNow, subscribeMusic } from "./music";

export const MINI = "mini";

/** What the mini window shows. */
export interface MiniState {
  name: string;
  phase: CallPhase;
  mood: Mood3D;
  status: string;
  muted: boolean;
  ended: boolean;
  /** The saved 3D picture's version (null: the 2D avatar). */
  picture: number | null;
  /** Music playing on her Mac: Pip wears headphones in the mini window too. */
  music: boolean;
}

export function miniState(s: { phase: CallPhase; mood: Parameters<typeof callMood>[1]; muted: boolean; mode: CallMode; ear: Ear }, name: string, picture: number | null, music = false): MiniState {
  return {
    name, phase: s.phase, mood: callMood(s.phase, s.mood), muted: s.muted, ended: s.phase === "ended", picture, music,
    status: callStatus({ ...s, name }),
  };
}

const isChildApp = () => (window as unknown as { __KITH_APP__?: string }).__KITH_APP__ === "child";

/** Wires a call to the Mac app. Returns a function that undoes it. */
export function startCallBridge(session: CallSession): () => void {
  const t = tauri();
  if (!t || !isChildApp()) return () => {};
  let running = false;
  let shown = false;
  let lastMouthAt = 0;
  const push = () => {
    if (!shown) return;
    const s = session.get();
    void t.event.emitTo(MINI, "kith:mini-state", miniState(s, session.deps.name, pipPictureVersion(), musicNow().playing)).catch(() => undefined);
  };
  const offState = session.subscribe(() => {
    const s = session.get();
    const now = s.active && s.phase !== "ended";
    if (now !== running) {
      running = now;
      void t.core.invoke("call_status", { running: now }).catch(() => undefined);
    }
    push();
  });
  const offMusic = subscribeMusic(push);
  const offLevels = session.subscribeLevels(() => {
    if (!shown) return;
    const at = performance.now();
    const m = session.getLevels().mouth;
    // ~20 a second is plenty for a small window; always send the closing 0.
    if (m !== 0 && at - lastMouthAt < 50) return;
    lastMouthAt = at;
    void t.event.emitTo(MINI, "kith:mini-mouth", m).catch(() => undefined);
  });
  const unlisten: Promise<() => void>[] = [
    t.event.listen<boolean>("kith:mini-shown", (e) => { shown = !!e.payload; session.setElsewhere(shown); push(); }),
    t.event.listen("kith:mini-hello", () => push()),
    t.event.listen<string>("kith:mini-action", (e) => {
      if (e.payload === "mute") session.toggleMute();
      else if (e.payload === "end") session.end();
    }),
  ];
  return () => {
    offState();
    offMusic();
    offLevels();
    for (const u of unlisten) void u.then((f) => f()).catch(() => undefined);
    if (running) void t.core.invoke("call_status", { running: false }).catch(() => undefined);
    session.setElsewhere(false);
  };
}
