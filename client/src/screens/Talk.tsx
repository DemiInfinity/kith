import { useEffect, useRef, useState } from "react";
import { api, type Energy, type Me, type Mood, type Turn } from "../api";
import { Avatar } from "../components/Avatar";
import { PowerChip } from "../components/bits";
import { MicCapture, playWithMouth } from "../lib/audio";

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
  const mic = useRef<MicCapture | null>(null);
  const stopPlay = useRef<AbortController | null>(null);
  const name = me.profile.name;

  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => { clearInterval(t); stopPlay.current?.abort(); void mic.current?.stop(); };
  }, []);

  const listen = async () => {
    setErr("");
    stopPlay.current?.abort();
    try {
      const m = new MicCapture();
      m.onLevel = (r) => setLevel(r);
      m.onSilence = () => void finish();
      mic.current = m;
      await m.start();
      setPhase("listening");
      setMood(energy.mode === "low" ? "sleepy" : "happy");
    } catch {
      setErr("I can’t hear you: the microphone isn’t allowed. You can type instead.");
      setPhase("idle");
    }
  };

  const finish = async () => {
    const m = mic.current;
    if (!m) return;
    mic.current = null;
    setLevel(0);
    setPhase("hearing");
    setMood("thinking");
    try {
      const pcm = await m.stop();
      const { text } = await api<{ text: string }>("/api/voice/stt", { raw: pcm });
      if (!text) { setPhase("idle"); setMood("happy"); setErr("I didn’t catch that. Tap the mic and try again?"); return; }
      setHeard(text);
      setSaid("");
      setPhase("thinking");
      const turn = await api<Turn>("/api/chat", { body: { text, mode: "talk" } });
      onTurn(turn);
      setSaid(turn.reply.text);
      setMood(turn.mood);
      if (turn.openHelp) openHelp();
      setPhase("speaking");
      try {
        const wav = await api<Blob>("/api/voice/tts", { body: { messageId: turn.reply.id } });
        stopPlay.current = new AbortController();
        await playWithMouth(wav, setMouth, stopPlay.current.signal);
      } catch {
        setErr("My voice isn’t working right now, so I’ve written it instead.");
      }
      setPhase("idle");
    } catch (e) {
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
          <span style={{ fontSize: 14, fontWeight: 800, color: "var(--muted)" }}>Talking with {name} · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
          <PowerChip energy={energy} />
        </span>
        <button className="grownup" onClick={openHelp}>Need a grown-up?</button>
      </div>
      <div className="stage">
        <Avatar look={me.profile.look} mood={mood} mouth={mouth} size={170} variant="halo" />
        <div className="wave" aria-hidden>{bars.map((h, i) => <span key={i} style={{ height: h }} />)}</div>
        <span style={{ fontSize: 15, fontWeight: 800, color: "var(--lilac-soft)" }} aria-live="polite">{status}</span>
      </div>
      <div className="captions" aria-live="polite">
        {heard && <span className="me">{heard}</span>}
        {said && <span className="pip">{said}</span>}
        {err && <span className="pip" style={{ borderColor: "var(--ember)" }}>{err}</span>}
      </div>
      <div className="controls">
        <button className="side" aria-label="Type instead" onClick={() => go("/")}>⌨️</button>
        <button
          className={`mic ${phase === "listening" ? "live" : ""}`} onClick={micTap}
          aria-label={phase === "listening" ? "Stop and send" : "Talk"} disabled={phase === "hearing" || phase === "thinking"}
          style={{ ["--lvl" as string]: `${Math.min(30, level * 200)}px` }}
        >
          {phase === "listening" ? "⏹" : "🎙️"}
        </button>
        <button className="end" aria-label="End call" onClick={() => { stopPlay.current?.abort(); go("/"); }}>✕</button>
      </div>
      <span className="small" style={{ textAlign: "center", paddingBottom: 10 }}>Voices run at home. Recordings aren’t kept.</span>
    </div>
  );
}
