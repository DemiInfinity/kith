// The Mac app's own mini call window (route /call-mini, opened by mac/src-tauri/src/mini.rs when
// she switches to another app during a call). It only shows the call and has its buttons: the
// voice, the microphone and the turns stay in Kith's main window (lib/callMac.ts). Clicking Pip
// brings Kith back to the front; dragging anywhere else moves the window.

import { useEffect, useRef, useState } from "react";
import { api, type Me } from "../api";
import { Avatar } from "../components/Avatar";
import { MiniCallCard, useCallLook } from "../components/CallBits";
import { pipPictureUrl, setPipPicture } from "../components/CompanionPic";
import type { MiniState } from "../lib/callMac";
import { tauri } from "../lib/native";
import type { PipStage } from "../pip3d/engine";

export function CallMiniWindow() {
  const t = tauri();
  const [st, setSt] = useState<MiniState | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [mouth, setMouth] = useState(0);
  const stage = useRef<PipStage | null>(null);
  const { view, look, still } = useCallLook();
  const press = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("miniwin");
    api<Me>("/api/me").then((m) => { setMe(m); setPipPicture(m.pipPicture); }).catch(() => undefined);
    if (!t) return;
    const offs = [
      t.event.listen<MiniState>("kith:mini-state", (e) => { setSt(e.payload); setPipPicture(e.payload.picture); }),
      t.event.listen<number>("kith:mini-mouth", (e) => {
        const v = Number(e.payload) || 0;
        setMouth(v);
        if (!still) stage.current?.setMouth(v);
      }),
    ];
    // Ask the main window for the call as it is now.
    void Promise.all(offs).then(() => t.event.emitTo("main", "kith:mini-hello")).catch(() => undefined);
    return () => { for (const o of offs) void o.then((f) => f()).catch(() => undefined); };
  }, [t, still]);

  const cmd = (c: "mini_mute" | "mini_end" | "mini_focus_main") => void t?.core.invoke(c).catch(() => undefined);
  const name = st?.name ?? me?.profile.name ?? "Pip";
  const picture = st?.picture ?? me?.pipPicture ?? null;
  const pic = picture !== null && picture !== undefined
    ? <img className="mc-still" src={pipPictureUrl(picture, st?.mood === "listening" ? "listening" : st?.mood === "thinking" ? "thinking" : "happy")} alt="" draggable={false} />
    : me ? <Avatar look={me.profile.look} mood="happy" mouth={mouth} size={110} variant="halo" /> : null;

  // Drag the window from anywhere but the buttons; a click on Pip (no drag) goes back to Kith.
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".mc-btn")) return;
    press.current = { x: e.screenX, y: e.screenY };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const p = press.current;
    if (!p || Math.hypot(e.screenX - p.x, e.screenY - p.y) < 4) return;
    press.current = null;
    void t?.window?.getCurrentWindow().startDragging().catch(() => undefined);
  };

  return (
    <div className="miniwin-body" onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={() => { press.current = null; }}>
      <div className={`minicall inwin ${st?.phase === "listening" ? "live" : ""}`} role="region" aria-label={`Call with ${name}`}>
        <MiniCallCard name={name} look={view === "3d" ? look ?? null : null} still={still} active mood={st?.mood ?? "happy"}
          status={st?.status ?? "On a call"} muted={!!st?.muted} ended={!!st?.ended} pic={pic}
          onStage={(s) => { stage.current = s; }} onOpen={() => cmd("mini_focus_main")}
          onMute={() => cmd("mini_mute")} onEnd={() => cmd("mini_end")} openLabel={`Back to Kith and the call with ${name}`} />
      </div>
    </div>
  );
}
