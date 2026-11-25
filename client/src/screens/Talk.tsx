import { useEffect, useRef, useState } from "react";
import { api, isAbort, type Energy, type Me, type Mood, type Turn } from "../api";
import { Avatar } from "../components/Avatar";
import { PowerChip } from "../components/bits";
import { audioContextFromTap, MicCapture, playWithMouth } from "../lib/audio";
import { Icon } from "../components/Icons";
import { savedLook, usePipPicture } from "../components/CompanionPic";
import { loadEngine, Pip3D, prefersStill } from "../pip3d/Stage";
import type { PipStage } from "../pip3d/engine";
import type { Look as Look3D } from "../pip3d/look";
import { callMood, callView, type CallPhase } from "../lib/call";

type Phase = CallPhase;

/**
 * A voice call. The child calls the companion; it never calls them. Captions show both sides.
 * It looks like a one-sided video call: the full 3D Pip, standing, talking along with its voice.
 * The camera is never used. With no saved 3D look (or no WebGL) it's the 2D avatar, as before.
 * Pip can hang up kindly (after saying goodbye); never while a worry is being talked about.
 */
export function Talk({ me, energy, onTurn, openHelp, go }: {
  me: Me; energy: Energy; onTurn: (t: Turn) => void; openHelp: () => void; go: (to: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [mood, setMood] = useState<Mood>(energy.mode === "low" ? "sleepy" : "happy");
  const [mouth, setMouth] = useState(0);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [err, setErr] = useState("");
  const [secs, setSecs] = useState(0);
  const [noVoice, setNoVoice] = useState(false);
  const mic = useRef<MicCapture | null>(null);
  const stopPlay = useRef<AbortController | null>(null);
  // One controller for the whole call: End (or leaving) aborts it, and every step checks it after
  // each wait, so nothing carries on (listening, thinking, speaking) once the call has ended.
  const call = useRef(new AbortController());
  const audio = useRef<AudioContext | null>(null);
  // "Grown-up?" opened during this call: then the companion won't hang up (the server checks too).
  const helpOpened = useRef(false);
  const ended = useRef(false);
  const name = me.profile.name;

  // The 3D Pip: the saved look (only fetched when there's a saved picture), and whether WebGL works.
  const picture = usePipPicture();
  const [look, setLook] = useState<Look3D | null | undefined>(undefined);
  const [webgl, setWebgl] = useState<boolean | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const stage = useRef<PipStage | null>(null);
  const [still] = useState(prefersStill);
  useEffect(() => {
    if (picture === null) return;
    let gone = false;
    savedLook().then((l) => { if (!gone) setLook(l); });
    loadEngine().then((m) => { if (!gone) setWebgl(m.webglAvailable()); }).catch(() => { if (!gone) setWebgl(false); });
    return () => { gone = true; };
  }, [picture]);
  const view = callView({ picture, look, webgl, failed });

  /** The voice moves both mouths. With reduced motion the 3D Pip keeps still, mouth too (captions carry it). */
  const onMouth = (v: number) => {
    setMouth(v);
    if (!still) stage.current?.setMouth(v);
  };
  // No voice: the 3D Pip "talks" the written reply for a moment, like the 2D one does.
  useEffect(() => {
    if (!(noVoice && phase === "speaking") || still) return;
    let i = 0;
    const t = setInterval(() => stage.current?.setMouth([0.2, 0.7, 0.45, 0, 0.9, 0.35][i++ % 6]), 140);
    return () => { clearInterval(t); stage.current?.setMouth(0); };
  }, [noVoice, phase, still]);

  const hangUp = () => {
    call.current.abort();
    stopPlay.current?.abort();
    const m = mic.current;
    mic.current = null;
    void m?.stop();
    void audio.current?.close().catch(() => undefined);
    audio.current = null;
    stage.current?.setMouth(0);
  };

  useEffect(() => {
    // A fresh controller each time the screen is shown (React may mount it twice in development).
    call.current = new AbortController();
    ended.current = false;
    const t = setInterval(() => setSecs((s) => (ended.current ? s : s + 1)), 1000);
    return () => { clearInterval(t); hangUp(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const askHelp = () => { helpOpened.current = true; openHelp(); };

  /** The companion said goodbye: the call ends here, gently, with a way to call again. */
  const pipHungUp = () => {
    hangUp();
    ended.current = true;
    setLevel(0);
    setMouth(0);
    setErr("");
    setMood(energy.mode === "low" ? "sleepy" : "happy");
    setPhase("ended");
  };
  const callAgain = () => {
    call.current = new AbortController();
    ended.current = false;
    helpOpened.current = false;
    setSecs(0); setHeard(""); setSaid(""); setErr("");
    setPhase("idle");
  };

  const listen = async () => {
    const sig = call.current.signal;
    setErr("");
    stopPlay.current?.abort();
    // Made (or resumed) here, inside the tap, so iOS Safari lets the call record and play.
    audio.current = audioContextFromTap(audio.current);
    try {
      const m = new MicCapture();
      m.onLevel = (r) => setLevel(r);
      m.onSilence = () => void finish();
      mic.current = m;
      await m.start(audio.current);
      if (sig.aborted) { void m.stop(); return; }
      setPhase("listening");
      setMood(energy.mode === "low" ? "sleepy" : "happy");
    } catch {
      mic.current = null;
      if (sig.aborted) return;
      setErr("I can’t hear you: the microphone isn’t allowed. You can type instead.");
      setPhase("idle");
    }
  };

  const finish = async () => {
    const m = mic.current;
    if (!m) return;
    const sig = call.current.signal;
    mic.current = null;
    setLevel(0);
    setPhase("hearing");
    setMood("thinking");
    try {
      const pcm = await m.stop();
      if (sig.aborted) return;
      const { text } = await api<{ text: string }>("/api/voice/stt", { raw: pcm, signal: sig });
      if (sig.aborted) return;
      if (!text) { setPhase("idle"); setMood("happy"); setErr("I didn’t catch that. Tap the mic and try again?"); return; }
      setHeard(text);
      setSaid("");
      setPhase("thinking");
      const turn = await api<Turn>("/api/chat", { body: { text, mode: "talk", call: { helpOpened: helpOpened.current } }, signal: sig });
      // The reply is saved on the server either way; it's shown in the chat if the call has ended.
      onTurn(turn);
      if (sig.aborted) return;
      setSaid(turn.reply.text);
      setMood(turn.mood);
      if (turn.openHelp) askHelp();
      setPhase("speaking");
      // Tapping the mic while it talks stops the voice (and then it doesn't hang up: she's still talking).
      const play = new AbortController();
      stopPlay.current = play;
      try {
        const wav = await api<Blob>("/api/voice/tts", { body: { messageId: turn.reply.id }, signal: sig });
        if (sig.aborted) return;
        await playWithMouth(wav, onMouth, play.signal, audio.current ?? undefined);
      } catch {
        if (sig.aborted) return;
        // No voice: show the reply and "talk" it for a moment so it still feels like a call.
        setErr("My voice isn’t working right now, so I’ve written it instead.");
        setNoVoice(true);
        await new Promise<void>((r) => {
          const t = setTimeout(r, Math.min(6000, 600 + turn.reply.text.length * 45));
          const stop = () => { clearTimeout(t); r(); };
          sig.addEventListener("abort", stop, { once: true });
          play.signal.addEventListener("abort", stop, { once: true });
        });
        if (sig.aborted) return;
        setNoVoice(false);
      }
      if (sig.aborted) return;
      if (turn.endCall && !play.signal.aborted && !helpOpened.current) { pipHungUp(); return; }
      if (play.signal.aborted) return; // she started talking again: listen() has the call now
      setPhase("idle");
    } catch (e) {
      if (sig.aborted || isAbort(e)) return;
      setErr((e as Error).message.includes("Voice service") ? "Voices aren’t set up at home yet. You can type instead." : (e as Error).message);
      setPhase("idle");
      setMood("happy");
    }
  };

  const micTap = () => {
    if (phase === "listening") void finish();
    else if (phase === "idle" || phase === "speaking") void listen();
  };

  const status =
    phase === "listening" ? "Listening…" : phase === "hearing" ? "Got it…" : phase === "thinking" ? `${name} is thinking…`
    : phase === "speaking" ? `${name} is talking…` : phase === "ended" ? `${name} hung up` : "Tap the mic to talk";
  const bars = Array.from({ length: 7 }, (_, i) => {
    const v = phase === "speaking" ? mouth : phase === "listening" ? Math.min(1, level * 8) : 0;
    return 10 + Math.round(v * (16 + ((i * 7) % 18)));
  });
  const wave = <div className="wave" aria-hidden>{bars.map((h, i) => <span key={i} style={{ height: h }} />)}</div>;
  const avatar2d = <Avatar look={me.profile.look} mood={mood} mouth={mouth} size={170} variant="halo" talking={phase === "speaking" && mouth === 0 && noVoice} />;
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  const captions = (
    <div className="captions" aria-live="polite">
      {heard && <span className="me">{heard}</span>}
      {said && <span className="pip">{said}</span>}
      {err && <span className="pip" style={{ borderColor: "var(--ember)" }}>{err}</span>}
    </div>
  );
  const hungUp = phase === "ended" && (
    <div className="hungup" role="status">
      <b>{name} hung up</b>
      <span>That was a lovely chat. Call again whenever you like.</span>
      <div className="hungup-btns">
        <button className="btn primary" onClick={callAgain}><Icon name="mic" size={18} /> Call again</button>
        <button className="btn ghost" onClick={() => go("/")}>Back to chat</button>
      </div>
    </div>
  );
  const controls = (
    <div className="controls">
      <button className="side" aria-label="Type instead" onClick={() => go("/")}><Icon name="keyboard" size={24} /></button>
      <button
        className={`mic ${phase === "listening" ? "live" : ""}`} onClick={micTap}
        aria-label={phase === "listening" ? "Stop and send" : "Talk"} disabled={phase === "hearing" || phase === "thinking" || phase === "ended"}
        style={{ ["--lvl" as string]: `${Math.min(30, level * 200)}px` }}
      >
        {phase === "listening" ? <Icon name="stop" size={30} /> : <Icon name="mic" size={32} />}
      </button>
      <button className="end" aria-label="End call" onClick={() => { hangUp(); go("/"); }}><Icon name="endcall" size={26} /></button>
    </div>
  );
  const head = (
    <div className="head">
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--muted)" }}>Talking with {name} · {clock}</span>
        <PowerChip energy={energy} />
      </span>
      <button className="grownup" onClick={askHelp}>Grown-up?</button>
    </div>
  );
  const footnote = <span className="small" style={{ textAlign: "center", paddingBottom: 10 }}>Voices run at home. Recordings aren’t kept.</span>;

  if (view === "2d") {
    return (
      <div className="talk">
        {head}
        <div className="stage">
          {avatar2d}
          {wave}
          <span style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--lilac-soft)" }} aria-live="polite">{status}</span>
        </div>
        {hungUp || captions}
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
            <Pip3D look={{ ...look, activity: "none" }} still={still} mood={callMood(phase, mood)} framing="full"
              onStage={(s) => { stage.current = s; }} label={`${name}, on the call`} fallback={<Failed onFail={() => setFailed(true)} />} />
          )}
        </div>
        <div className="callinfo">
          {wave}
          <span aria-live="polite">{status}</span>
        </div>
        <div className={`youtile ${phase === "listening" ? "live" : ""}`} aria-hidden style={{ ["--lvl" as string]: `${Math.min(10, level * 70)}px` }}>You</div>
        <div className="callbottom">{hungUp || captions}</div>
        <span className="callname">{name}</span>
      </div>
      {controls}
      {footnote}
    </div>
  );
}

/** Shown by the 3D stage when WebGL won't start: switches the call to the 2D avatar. */
function Failed({ onFail }: { onFail: () => void }) {
  useEffect(() => { onFail(); }, [onFail]);
  return null;
}
