import { useState } from "react";
import { api, type Me, type Profile } from "../api";
import { Avatar } from "../components/Avatar";
import { Toggle } from "../components/bits";
import { Icon, IL, type IconName } from "../components/Icons";
import { playWithMouth } from "../lib/audio";
import { enablePush, pushStatus } from "../lib/push";
import { sampleLine, TRAITS } from "./Personality";

type Step = "hello" | "name" | "personality" | "voice" | "help" | "notify" | "safe";
const STEPS: Step[] = ["hello", "name", "personality", "voice", "help", "notify", "safe"];

/** First run: a short wizard where the child sets up their pal. Honest from the first screen. */
export function Meet({ me, onDone }: { me: Me; onDone: (p: Profile) => void }) {
  const [p, setP] = useState<Profile>({ ...me.profile, name: me.profile.name || "Pip", look: me.looks.includes(me.profile.look) ? me.profile.look : me.looks[0] });
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mouth, setMouth] = useState(0);
  const [playing, setPlaying] = useState("");
  const [push, setPush] = useState<"" | "on" | "blocked" | "unsupported" | "…">("");
  const step = STEPS[i];
  const set = (patch: Partial<Profile>) => setP((x) => ({ ...x, ...patch }));
  const name = p.name.trim() || "Pip";
  const toggleTrait = (t: string) => set({ traits: p.traits.includes(t) ? p.traits.filter((x) => x !== t) : [...p.traits, t].slice(-3) });

  const finish = async () => {
    setBusy(true); setErr("");
    try {
      onDone(await api<Profile>("/api/profile", { method: "PUT", body: { ...p, name, setupDone: true } }));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  const next = () => (i < STEPS.length - 1 ? setI(i + 1) : void finish());
  const back = () => setI(Math.max(0, i - 1));
  const preview = async (voice: string) => {
    set({ voice }); setPlaying(voice);
    try { await playWithMouth(await api<Blob>("/api/voice/tts", { body: { preview: voice } }), setMouth); } catch { /* voices not set up yet: picking still works */ }
    setPlaying("");
  };
  const turnOnPush = async () => {
    setPush("…");
    try { const st = await pushStatus(); if (st === "unsupported" || st === "blocked") { setPush(st); return; } await enablePush(me.push.publicKey); setPush("on"); }
    catch { setPush("blocked"); }
  };

  const helps: [keyof Profile["helpWith"], IconName, string][] = [["homework", "study", "Homework and revision (helping you learn it, not doing it)"], ["stories", "sparkle", "Stories, ideas and art"], ["music", "music", "Music and films to try"]];

  return (
    <div className="main">
      <div className="wizard">
        <div className="wiz-top">
          <div className="wiz-dots" aria-label={`Step ${i + 1} of ${STEPS.length}`}>{STEPS.map((s, j) => <span key={s} className={j === i ? "on" : j < i ? "done" : ""} />)}</div>
          {i > 0 && <button className="btn ghost small" onClick={back}><IL i="back">Back</IL></button>}
        </div>
        <div className="wiz-pal">
          <Avatar look={p.look} size={step === "hello" ? 150 : 120} variant="ring" mouth={mouth} talking={step === "voice" && !!playing && !mouth}
            mood="happy" />
        </div>

        <div className="wiz-body" key={step}>
          {step === "hello" && <>
            <span className="hand" style={{ fontSize: "1.75rem" }}>hello{me.name ? `, ${me.name}` : ""}!</span>
            <h2>Let’s set up your pal</h2>
            <p>I’m an AI, not a person. I live on your family’s home server, not out on the internet. I can chat, help you learn, make things with you and be good company. It takes about a minute to make me yours.</p>
          </>}

          {step === "name" && <>
            <h2>What would you like to call me?</h2>
            <input className="input wiz-name" aria-label="Name" value={p.name} maxLength={24} autoFocus onChange={(e) => set({ name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") next(); }} />
            <p className="small">You can change it any time in Settings.</p>
          </>}

          {step === "personality" && <>
            <h2>What’s {name} like?</h2>
            <p className="small">Pick up to three.</p>
            <div className="chips" style={{ justifyContent: "center" }}>
              {TRAITS.map((t) => <button key={t} className={`chip ${p.traits.includes(t) ? "on" : ""}`} aria-pressed={p.traits.includes(t)} onClick={() => toggleTrait(t)}>{t}</button>)}
            </div>
            <div className="wiz-say"><span className="eyebrow">{name} sounds like</span>“{sampleLine(p)}”</div>
          </>}

          {step === "voice" && <>
            <h2>Pick {name}’s voice</h2>
            <p className="small">For calls. Tap one to hear it.</p>
            <div className="wiz-voices">
              {me.voices.map((v) => (
                <button key={v} className={`look ${p.voice === v ? "on" : ""}`} onClick={() => preview(v)}>
                  <span className="hic"><Icon name={playing === v ? "speaker" : "play"} size={18} /></span>{v}
                </button>
              ))}
            </div>
          </>}

          {step === "help" && <>
            <h2>What should {name} help with?</h2>
            <div className="stack" style={{ gap: 4, alignSelf: "stretch", textAlign: "left" }}>
              {helps.map(([k, ic, l]) => <Toggle key={k} label={<IL i={ic}>{l}</IL>} checked={p.helpWith[k]} onChange={(v) => set({ helpWith: { ...p.helpWith, [k]: v } })} />)}
            </div>
            <p className="small">Chatting, Grown-up? and calls always work.</p>
          </>}

          {step === "notify" && <>
            <h2>Can {name} send you notifications?</h2>
            <p>Reminders you ask for, and when something {name} made for you is ready. Never in quiet hours ({me.quietHours.start}–{me.quietHours.end}), never guilt-trippy, and you can turn them off any time.</p>
            {me.push.ready ? (
              <button className="btn primary" onClick={turnOnPush} disabled={push === "on" || push === "…"}><IL i="bell">{push === "on" ? "Notifications are on" : "Turn on notifications"}</IL></button>
            ) : <p className="small">{me.parentLabel} still needs to finish setting notifications up. You can turn them on later in Settings.</p>}
            {push === "unsupported" && <p className="small">On an iPhone, add Kith to your Home Screen first (Share › Add to Home Screen), then turn them on in Settings.</p>}
            {push === "blocked" && <p className="small">They’re blocked in your phone’s settings. That’s fine: you can change it later.</p>}
          </>}

          {step === "safe" && <>
            <h2>How we stay safe</h2>
            <div className="wiz-safe">
              <span><Icon name="heart" size={20} /><span>Our everyday chats are between us. {me.parentLabel} doesn’t read them.</span></span>
              <span><Icon name="shield" size={20} /><span>If something worries me, I’ll <b>tell you first</b>, then let {me.parentLabel} know. You won’t be in trouble.</span></span>
              <span><Icon name="grownup" size={20} /><span><b>Grown-up?</b> is always there, on every screen: message {me.parentLabel}, or call Childline or 999.</span></span>
              <span><Icon name="question" size={20} /><span>Stuck? Settings › Help has the answers, and typing <b>/</b> in chat shows what you can do.</span></span>
            </div>
          </>}
        </div>

        {err && <span className="small" style={{ color: "var(--ember)" }}>{err}</span>}
        <button className="btn primary block wiz-next" disabled={busy || (step === "name" && !p.name.trim())} onClick={next}>
          {step === "hello" ? "Let’s go" : step === "safe" ? `Say hi to ${name}` : step === "notify" && push !== "on" ? "Maybe later" : "Next"}
        </button>
      </div>
    </div>
  );
}
