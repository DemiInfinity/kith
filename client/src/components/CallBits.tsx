// The call's pieces shared by the call screen, the mini call in the app, and the Mac app's own mini
// window: the session's React hooks, the 3D Pip's look for a call, and the small portrait card.

import { createContext, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { CallSession, type CallDeps } from "../lib/callSession";
import { startCallBridge } from "../lib/callMac";
import { callView } from "../lib/call";
import { savedLook, usePipPicture } from "./CompanionPic";
import { loadEngine, Pip3D, prefersStill } from "../pip3d/Stage";
import type { PipStage } from "../pip3d/engine";
import type { Look as Look3D, Mood3D } from "../pip3d/look";
import { Icon } from "./Icons";

const Ctx = createContext<CallSession | null>(null);

/** Holds the call for the child's app, so it carries on across pages. Ends it when the app goes. */
export function CallProvider({ session, deps, children }: { session: CallSession; deps: CallDeps; children: React.ReactNode }) {
  useLayoutEffect(() => { session.deps = deps; });
  useEffect(() => {
    const stop = startCallBridge(session);
    return () => { stop(); session.end(false); };
  }, [session]);
  return <Ctx.Provider value={session}>{children}</Ctx.Provider>;
}

export function useCallSession(): CallSession {
  const s = useContext(Ctx);
  if (!s) throw new Error("useCallSession outside CallProvider");
  return s;
}
export function useCall() {
  const s = useCallSession();
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}
/** Pip's mouth and her mic level: these change many times a second, so only what shows them listens. */
export function useCallLevels() {
  const s = useCallSession();
  return useSyncExternalStore(s.subscribeLevels, s.getLevels, s.getLevels);
}
/** Just whether a call is on (re-renders only when that changes). */
export function useCallActive(session: CallSession): boolean {
  const get = () => session.get().active;
  return useSyncExternalStore(session.subscribe, get, get);
}

/** Which Pip a call shows (3D when there's a saved look and WebGL works), and that look. */
export function useCallLook() {
  const picture = usePipPicture();
  const [look, setLook] = useState<Look3D | null | undefined>(undefined);
  const [webgl, setWebgl] = useState<boolean | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [still] = useState(prefersStill);
  useEffect(() => {
    if (picture === null) return;
    let gone = false;
    savedLook().then((l) => { if (!gone) setLook(l); });
    loadEngine().then((m) => { if (!gone) setWebgl(m.webglAvailable()); }).catch(() => { if (!gone) setWebgl(false); });
    return () => { gone = true; };
  }, [picture]);
  return { view: callView({ picture, look, webgl, failed }), look, still, picture, fail: () => setFailed(true) };
}

/** Shown by the 3D stage when WebGL won't start: switches the call to the 2D avatar. */
export function Failed({ onFail }: { onFail: () => void }) {
  useEffect(() => { onFail(); }, [onFail]);
  return null;
}

/**
 * The small portrait call: Pip's head and shoulders, its name, what's happening, mute and end.
 * Tapping Pip goes back to the full call. The same card in the app and in the Mac app's own window.
 */
export function MiniCallCard({ name, look, still, active, mood, status, muted, ended, pic, onStage, onOpen, onMute, onEnd, openLabel, music = false }: {
  name: string;
  /** Music playing on her Mac: headphones for now. */
  music?: boolean;
  /** The 3D look, or null for the still picture / 2D avatar given in `pic`. */
  look: Look3D | null;
  still: boolean;
  /** The 3D Pip moves (false: it rests, e.g. while another 3D view is showing). */
  active: boolean;
  mood: Mood3D;
  status: string;
  muted: boolean;
  ended: boolean;
  pic: React.ReactNode;
  onStage?: (s: PipStage | null) => void;
  onOpen: () => void;
  onMute: () => void;
  onEnd: () => void;
  openLabel: string;
}) {
  return (
    <div className="mc-card">
      <button className="mc-pip" onClick={onOpen} aria-label={openLabel}>
        {look ? (
          <Pip3D look={{ ...look, activity: "none" }} still={still} active={active} mood={mood} framing="portrait" music={music}
            onStage={onStage} label={`${name}, on the call`} fallback={pic} />
        ) : pic}
      </button>
      <span className="mc-status" aria-live="polite">{status}</span>
      <div className="mc-bar">
        <b className="mc-name">{name}</b>
        {!ended && (
          <button className={`mc-btn ${muted ? "on" : ""}`} onClick={onMute} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"}>
            <Icon name={muted ? "micoff" : "mic"} size={18} />
          </button>
        )}
        <button className="mc-btn end" onClick={onEnd} aria-label={ended ? "Close" : "End call"}>
          <Icon name={ended ? "close" : "endcall"} size={18} />
        </button>
      </div>
    </div>
  );
}
