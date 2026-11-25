import { useEffect, useRef, useState } from "react";
import { api, isAbort, type Energy, type Me, type Mood, type Turn } from "../api";
import { Avatar } from "../components/Avatar";
import { PowerChip } from "../components/bits";
import { audioContextFromTap, MicCapture, playWithMouth } from "../lib/audio";
import { Icon } from "../components/Icons";

type Phase = "idle" | "listening" | "hearing" | "thinking" | "speaking";

/** A voice call. The child calls the companion; it never calls them. Captions show both sides. */
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
  const name = me.profile.name;

  const hangUp = () => {
    call.current.abort();
    stopPlay.current?.abort();
    const m = mic.current;
    mic.current = null;
    void m?.stop();
    void audio.current?.close().catch(() => undefined);
    audio.current = null;
  };

  useEffect(() => {
    // A fresh controller each time the screen is shown (React may mount it twice in development).
    call.current = new AbortController();
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => { clearInterval(t); hangUp(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const turn = await api<Turn>("/api/chat", { body: { text, mode: "talk" }, signal: sig });
      // The reply is saved on the server either way; it's shown in the chat if the call has ended.
      onTurn(turn);
      if (sig.aborted) return;
      setSaid(turn.reply.text);
      setMood(turn.mood);
      if (turn.openHelp) openHelp();
      setPhase("speaking");
      try {
        const wav = await api<Blob>("/api/voice/tts", { body: { messageId: turn.reply.id }, signal: sig });
        if (sig.aborted) return;
        stopPlay.current = new AbortController();
        await playWithMouth(wav, setMouth, stopPlay.current.signal, audio.current ?? undefined);
      } catch {
        if (sig.aborted) return;
        // No voice: show the reply and "talk" it for a moment so it still feels like a call.
        setErr("My voice isn’t working right now, so I’ve written it instead.");
        setNoVoice(true);
        await new Promise<void>((r) => {
          const t = setTimeout(r, Math.min(6000, 600 + turn.reply.text.length * 45));
          sig.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true });
        });
        if (sig.aborted) return;
        setNoVoice(false);
      }
      if (sig.aborted) return;
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
    : phase === "speaking" ? `${name} is talking…` : "Tap the mic to talk";
  const bars = Array.from({ length: 7 }, (_, i) => {
    const v = phase === "speaking" ? mouth : phase === "listening" ? Math.min(1, level * 8) : 0;
    return 10 + Math.round(v * (16 + ((i * 7) % 18)));
  });

  return (
    <div className="talk">
      <div className="head">
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--muted)" }}>Talking with {name} · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
          <PowerChip energy={energy} />
        </span>
        <button className="grownup" onClick={openHelp}>Grown-up?</button>
      </div>
      <div className="stage">
        <Avatar look={me.profile.look} mood={mood} mouth={mouth} size={170} variant="halo" talking={phase === "speaking" && mouth === 0 && noVoice} />
        <div className="wave" aria-hidden>{bars.map((h, i) => <span key={i} style={{ height: h }} />)}</div>
        <span style={{ fontSize: "0.9375rem", fontWeight: 800, color: "var(--lilac-soft)" }} aria-live="polite">{status}</span>
      </div>
      <div className="captions" aria-live="polite">
        {heard && <span className="me">{heard}</span>}
        {said && <span className="pip">{said}</span>}
        {err && <span className="pip" style={{ borderColor: "var(--ember)" }}>{err}</span>}
      </div>
      <div className="controls">
        <button className="side" aria-label="Type instead" onClick={() => go("/")}><Icon name="keyboard" size={24} /></button>
        <button
          className={`mic ${phase === "listening" ? "live" : ""}`} onClick={micTap}
          aria-label={phase === "listening" ? "Stop and send" : "Talk"} disabled={phase === "hearing" || phase === "thinking"}
          style={{ ["--lvl" as string]: `${Math.min(30, level * 200)}px` }}
        >
          {phase === "listening" ? <Icon name="stop" size={30} /> : <Icon name="mic" size={32} />}
        </button>
        <button className="end" aria-label="End call" onClick={() => { hangUp(); go("/"); }}><Icon name="endcall" size={26} /></button>
      </div>
      <span className="small" style={{ textAlign: "center", paddingBottom: 10 }}>Voices run at home. Recordings aren’t kept.</span>
    </div>
  );
}
