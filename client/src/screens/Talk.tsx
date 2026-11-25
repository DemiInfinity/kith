import { useEffect, useRef } from "react";
import type { Energy, Me } from "../api";
import { Avatar } from "../components/Avatar";
import { PowerChip } from "../components/bits";
import { Icon } from "../components/Icons";
import { Pip3D } from "../pip3d/Stage";
import { callMood, callStatus } from "../lib/call";
import { Failed, useCall, useCallLevels, useCallLook, useCallSession } from "../components/CallBits";
import { useMusic } from "../lib/music";
import { isChildMacApp, useMacVoice, voiceProgressText } from "../lib/macVoice";

/**
 * A voice call. The child calls the companion; it never calls them. Captions show both sides.
 * It looks like a one-sided video call: the full 3D Pip, standing, talking along with its voice.
 * The camera is never used. With no saved 3D look (or no WebGL) it's the 2D avatar, as before.
 * Pip can hang up kindly (after saying goodbye); never while a worry is being talked about.
 *
 * The call itself lives in lib/callSession.ts, so it carries on (as a small mini call) when she
 * goes to another page; this screen is its full view. She talks hands-free (Kith notices when she
 * starts and stops) or by tapping the mic, and can switch between them here.
 */
export function Talk({ me, energy, go, leave }: {
  me: Me; energy: Energy; go: (to: string) => void;
  /** Back to the page she was on, with the call carrying on as a mini call. */
  leave: () => void;
}) {
  const session = useCallSession();
  const call = useCall();
  const name = me.profile.name;
  const { view, look, still, fail } = useCallLook();
  const music = useMusic().playing;
  const voice = useMacVoice();
  const voiceComing = voiceProgressText(voice, name);

  // Opening the call screen starts a call (or shows the one that's on). If it's ended from
  // elsewhere (the Mac app's mini window), leave.
  useEffect(() => { session.open(); }, [session]);
  const wasActive = useRef(false);
  useEffect(() => {
    if (call.active) wasActive.current = true;
    else if (wasActive.current) go("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.active]);
  const stageOff = useRef<(() => void) | null>(null);

  const { phase, mode, muted } = call;
  const hands = mode === "handsfree";
  const status = callStatus({ phase, mode, muted, ear: call.ear, name });
  const clock = `${Math.floor(call.secs / 60)}:${String(call.secs % 60).padStart(2, "0")}`;
  const endCall = () => { session.end(); go("/"); };

  const captions = (
    <div className="captions" aria-live="polite">
      {call.heard && <span className="me">{call.heard}</span>}
      {call.said && <span className="pip">{call.said}</span>}
      {call.err && <span className="pip" style={{ borderColor: "var(--ember)" }}>{call.err}</span>}
    </div>
  );
  const hungUp = phase === "ended" && (
    <div className="hungup" role="status">
      <b>{name} hung up</b>
      <span>That was a lovely chat. Call again whenever you like.</span>
      <div className="hungup-btns">
        <button className="btn primary" onClick={() => session.callAgain()}><Icon name="mic" size={18} /> Call again</button>
        <button className="btn ghost" onClick={endCall}>Back to chat</button>
      </div>
    </div>
  );
  const micLabel = phase === "listening" ? (hands ? "Send now" : "Stop and send")
    : phase === "speaking" ? "Cut in and talk"
    : hands ? (call.ear === "open" || call.ear === "ready" ? "Talk now" : "Start listening") : "Talk";
  const options = phase !== "ended" && (
    <div className="calloptions">
      <div className="callmode" role="radiogroup" aria-label="How to talk">
        <button role="radio" aria-checked={hands} className={hands ? "on" : ""} onClick={() => session.setMode("handsfree")}>Hands-free</button>
        <button role="radio" aria-checked={!hands} className={!hands ? "on" : ""} onClick={() => session.setMode("tap")}>Tap to talk</button>
      </div>
      <button className={`mutebtn ${muted ? "on" : ""}`} aria-pressed={muted} onClick={() => session.toggleMute()}>
        <Icon name={muted ? "micoff" : "mic"} size={18} /> {muted ? "Muted" : "Mute"}
      </button>
    </div>
  );
  const controls = (
    <div className="controls">
      <button className="side" aria-label="Type instead (ends the call)" onClick={endCall}><Icon name="keyboard" size={24} /></button>
      <MicButton label={micLabel} live={phase === "listening"} onClick={() => session.micTap()}
        disabled={phase === "hearing" || phase === "thinking" || phase === "ended"} />
      <button className="end" aria-label="End call" onClick={endCall}><Icon name="endcall" size={26} /></button>
    </div>
  );
  const head = (
    <div className="head">
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="iconbtn" onClick={leave} aria-label="Shrink the call and look around (it keeps going)"><Icon name="shrink" size={20} /></button>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--muted)" }}>Talking with {name} · {clock}</span>
          <PowerChip energy={energy} />
        </span>
      </span>
      <button className="grownup" onClick={() => session.askHelp()}>Grown-up?</button>
    </div>
  );
  const footnote = (
    <span className="small" style={{ textAlign: "center", paddingBottom: 10 }}>
      {voiceComing ? `${voiceComing} ` : ""}
      {voice.phase === "ready" && isChildMacApp() ? `${name}’s voice is made on this Mac. ` : "Voices run at home. "}Recordings aren’t kept.
    </span>
  );
  const statusLine = <span aria-live="polite">{status}</span>;

  if (view === "2d") {
    return (
      <div className="talk">
        {head}
        <div className="stage">
          <Avatar2D me={me} mood={call.mood} />
          <Wave />
          <span style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--lilac-soft)" }}>{statusLine}</span>
        </div>
        {hungUp || captions}
        {options}
        {controls}
        {footnote}
      </div>
    );
  }

  // The video call: the full 3D Pip standing in a big rounded frame (full screen on a phone), its name
  // set into the frame's bottom edge. One-sided: no camera, so her side is just a small "You" tile.
  return (
    <div className="talk call">
      {head}
      <div className="callview">
        <div className="callpip">
          {view === "3d" && look && (
            <Pip3D look={{ ...look, activity: "none" }} still={still} active={!call.elsewhere} mood={callMood(phase, call.mood)} framing="full" music={music}
              onStage={(s) => { if (s) stageOff.current = session.addStage(s, still); else { stageOff.current?.(); stageOff.current = null; } }}
              label={`${name}, on the call`} fallback={<Failed onFail={fail} />} />
          )}
        </div>
        <div className="callinfo">
          <Wave />
          {statusLine}
        </div>
        <YouTile />
        <div className="callbottom">{hungUp || captions}</div>
        <span className="callname">{name}</span>
      </div>
      {options}
      {controls}
      {footnote}
    </div>
  );
}

/** The voice bars: Pip's voice while it talks, hers while she does. */
function Wave() {
  const { phase } = useCall();
  const { mouth, level } = useCallLevels();
  const bars = Array.from({ length: 7 }, (_, i) => {
    const v = phase === "speaking" ? mouth : phase === "listening" ? Math.min(1, level * 8) : 0;
    return 10 + Math.round(v * (16 + ((i * 7) % 18)));
  });
  return <div className="wave" aria-hidden>{bars.map((h, i) => <span key={i} style={{ height: h }} />)}</div>;
}

/** Her side of the call: no camera, just a tile that glows with her voice. */
function YouTile() {
  const { phase, muted, mode, ear } = useCall();
  const { level } = useCallLevels();
  const live = phase === "listening";
  const open = !live && !muted && mode === "handsfree" && ear === "open" && phase === "idle";
  return (
    <div className={`youtile ${live ? "live" : ""} ${open ? "open" : ""} ${muted ? "muted" : ""}`} aria-hidden
      style={{ ["--lvl" as string]: `${Math.min(10, level * 70)}px` }}>
      {muted ? <Icon name="micoff" size={20} /> : "You"}
    </div>
  );
}

function MicButton({ label, live, onClick, disabled }: { label: string; live: boolean; onClick: () => void; disabled: boolean }) {
  const { level } = useCallLevels();
  return (
    <button className={`mic ${live ? "live" : ""}`} onClick={onClick} aria-label={label} disabled={disabled}
      style={{ ["--lvl" as string]: `${Math.min(30, level * 200)}px` }}>
      {live ? <Icon name="stop" size={30} /> : <Icon name="mic" size={32} />}
    </button>
  );
}

function Avatar2D({ me, mood }: { me: Me; mood: Parameters<typeof Avatar>[0]["mood"] }) {
  const { mouth } = useCallLevels();
  return <Avatar look={me.profile.look} mood={mood} mouth={mouth} size={170} variant="halo" />;
}
