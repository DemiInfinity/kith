// The mini call: when she leaves the call screen during a call, the call carries on in a small
// portrait window over the page. Pip (head and shoulders), its name, mute, end, and a tap on Pip
// goes back to the full call. It can be dragged to any corner (it snaps there), and its corners are
// kept clear of "Grown-up?" and the chat's send button (theme.css, .minicall).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Me } from "../api";
import { callMood, callStatus, nearestCorner, savedCorner, saveCorner, type Corner } from "../lib/call";
import { Avatar } from "./Avatar";
import { MiniCallCard, useCall, useCallLevels, useCallLook, useCallSession } from "./CallBits";
import { pipPictureUrl } from "./CompanionPic";
import { prefersStill } from "../pip3d/Stage";
import type { PipStage } from "../pip3d/engine";
import { useMusic } from "../lib/music";

export function MiniCall({ me, go, still3d }: {
  me: Me;
  go: (to: string) => void;
  /** Another 3D view is on the page (My Pip, the OC workshop, the profile panel): show the still picture instead. */
  still3d: boolean;
}) {
  const session = useCallSession();
  const call = useCall();
  const name = me.profile.name;
  const { view, look, still, picture } = useCallLook();
  const music = useMusic().playing;
  const [corner, setCorner] = useState<Corner>(savedCorner);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const before = useRef<DOMRect | null>(null);
  const stageOff = useRef<(() => void) | null>(null);

  // Pip said goodbye while she was elsewhere: the mini call says so, then closes by itself.
  useEffect(() => {
    if (call.phase !== "ended") return;
    const t = setTimeout(() => session.end(), 10_000);
    return () => clearTimeout(t);
  }, [call.phase, session]);

  // Snapping to a new corner glides there (not with reduced motion).
  useLayoutEffect(() => {
    const el = box.current, was = before.current;
    before.current = null;
    if (!el || !was || prefersStill()) return;
    const now = el.getBoundingClientRect();
    el.style.transition = "none";
    el.style.transform = `translate(${was.left - now.left}px, ${was.top - now.top}px)`;
    void el.offsetWidth;
    el.style.transition = "transform 0.22s ease-out";
    el.style.transform = "";
    const done = () => { el.style.transition = ""; };
    el.addEventListener("transitionend", done, { once: true });
  }, [corner]);

  const onPointerDown = (e: React.PointerEvent) => {
    // The buttons are just buttons; dragging starts anywhere else on the card (Pip included).
    if ((e.target as HTMLElement).closest(".mc-btn")) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    if (!d.moved) { d.moved = true; try { box.current?.setPointerCapture(e.pointerId); } catch { /* fine */ } }
    setOffset({ x: dx, y: dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !d.moved) return;
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 0);
    const r = box.current?.getBoundingClientRect();
    setOffset(null);
    if (!r) return;
    const c = nearestCorner(r.left + r.width / 2, r.top + r.height / 2, innerWidth, innerHeight);
    before.current = r;
    setCorner(c);
    saveCorner(c);
  };

  const open = () => { if (!justDragged.current) go("/talk"); };
  const status = callStatus({ phase: call.phase, mode: call.mode, muted: call.muted, ear: call.ear, name });
  const pic = picture !== null
    ? <img className="mc-still" src={pipPictureUrl(picture, call.phase === "listening" ? "listening" : call.phase === "thinking" || call.phase === "hearing" ? "thinking" : "happy")} alt="" draggable={false} />
    : <MiniAvatar me={me} mood={call.mood} />;
  const live3d = view === "3d" && !!look && !still3d && !call.elsewhere;
  const onStage = (s: PipStage | null) => {
    stageOff.current?.();
    stageOff.current = s ? session.addStage(s, still) : null;
  };

  return (
    <div ref={box} className={`minicall mc-${corner} ${offset ? "dragging" : ""} ${call.phase === "listening" ? "live" : ""}`}
      role="region" aria-label={`Call with ${name}`}
      style={offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; setOffset(null); }}>
      <MiniCallCard name={name} look={live3d ? look : null} still={still} active mood={callMood(call.phase, call.mood)}
        status={status} muted={call.muted} ended={call.phase === "ended"} pic={pic} music={music}
        onStage={onStage} onOpen={open} onMute={() => session.toggleMute()} onEnd={() => session.end()}
        openLabel={`Back to the call with ${name}`} />
    </div>
  );
}

/** The 2D avatar, talking along with the voice. */
function MiniAvatar({ me, mood }: { me: Me; mood: Parameters<typeof Avatar>[0]["mood"] }) {
  const { mouth } = useCallLevels();
  return <Avatar look={me.profile.look} mood={mood} mouth={mouth} size={96} variant="halo" />;
}
