import { Icon, IL } from "../components/Icons";
import { useEffect, useRef, useState } from "react";
import { api, type AppState, type Me, type PipChange, type Profile } from "../api";
import { ChangeCard } from "../components/ChangeCard";
import { Avatar, LookIcon } from "../components/Avatar";
import { usePipPicture } from "../components/CompanionPic";
import { Pip3D, prefersStill } from "../pip3d/Stage";
import { normaliseLook, type Look as Look3D } from "../pip3d/look";
import { Toggle } from "../components/bits";
import { playWithMouth } from "../lib/audio";
import { isChildMacApp, MAC_VOICES, macVoiceOffered, prepareMacVoice, waitForMacVoice, saveMacVoice, savedMacVoice, speakOnMac, useMacVoice, voiceProgressText } from "../lib/macVoice";

export const TRAITS = ["Curious", "Funny", "Calm", "Encouraging", "Nerdy", "Creative", "Sporty", "Gentle"];

export function sampleLine(p: Profile): string {
  if (p.traits.includes("Funny")) return "Fractions again? Easy. We’ll have them sorted faster than you can say “lowest common denominator”. Probably. 😄";
  if (p.traits.includes("Calm")) return "Let’s take the fractions one at a time. No rush. What’s the first one?";
  if (p.traits.includes("Nerdy")) return "Fractions are just sharing things fairly. Want to see why the bottoms have to match first?";
  if (p.traits.includes("Sporty")) return "Right, fractions: warm-up question first, then we go for the win. Ready?";
  if (p.traits.includes("Creative")) return "Imagine the fraction is a pizza. Want to draw it out together?";
  if (p.traits.includes("Gentle")) return "Fractions can feel tricky. We’ll go slowly. Which one shall we start with?";
  return "Ooh, fractions! Want to try the first one and I’ll cheer you on?";
}

/** Make it yours: name, look, traits, how it talks, voice and what it helps with. */
export function Personality({ me, onSaved, go }: { me: Me; onSaved: (p: Profile) => void; go?: (to: string) => void }) {
  // Her saved 3D look (My Pip): shown here instead of the old flat avatar once there is one.
  const pic = usePipPicture();
  const [look3d, setLook3d] = useState<Look3D | null>(null);
  useEffect(() => {
    if (pic === null) { setLook3d(null); return; }
    let gone = false;
    api<{ look: unknown }>("/api/pip/look").then((r) => { if (!gone) setLook3d(r.look ? normaliseLook(r.look) : null); }).catch(() => undefined);
    return () => { gone = true; };
  }, [pic]);
  const [p, setP] = useState<Profile>(me.profile);
  const [saving, setSaving] = useState<"" | "saving" | "saved" | "error">("");
  const [mouth, setMouth] = useState(0);
  const [playing, setPlaying] = useState("");
  const [pose, setPose] = useState<"around" | "talking" | "laptop" | "thinking" | "sleepy">("around");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const first = useRef(true);
  // Set when the profile comes from the server (Pip tweaked it, or an Undo): shown, not saved again.
  const fromServer = useRef(false);
  const [recent, setRecent] = useState<PipChange[]>([]);
  const showServer = (q: Profile) => { fromServer.current = true; setP(q); onSaved(q); };

  useEffect(() => {
    api<{ changes: PipChange[] }>("/api/pip/changes?kind=personality").then((r) => setRecent(r.changes.slice(0, 5))).catch(() => undefined);
    // Pip may have tweaked itself since this page's copy was loaded: start from what's saved.
    api<AppState>("/api/state").then((s) => { if (JSON.stringify(s.profile) !== JSON.stringify(me.profile)) showServer(s.profile); }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (fromServer.current) { fromServer.current = false; return; }
    clearTimeout(timer.current);
    setSaving("saving");
    timer.current = setTimeout(async () => {
      try {
        const saved = await api<Profile>("/api/profile", { method: "PUT", body: { ...p, name: p.name.trim() || "Pip" } });
        onSaved(saved);
        setSaving("saved");
      } catch {
        setSaving("error");
      }
    }, 500);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);

  const set = (patch: Partial<Profile>) => setP((x) => ({ ...x, ...patch }));
  const toggleTrait = (t: string) => set({ traits: p.traits.includes(t) ? p.traits.filter((x) => x !== t) : [...p.traits, t].slice(-3) });

  // The Mac app: Kokoro's British voices, made on the Mac (kept on this Mac; the phone keeps the home voices).
  const macVoice = useMacVoice();
  const onMac = isChildMacApp() && macVoiceOffered(macVoice);
  const [macPick, setMacPick] = useState(savedMacVoice);
  useEffect(() => { if (isChildMacApp()) prepareMacVoice(); }, []);
  // Sound has to be switched on during the tap itself (the Mac's web view, like Safari, won't start
  // audio a few seconds later, once the voice has finished making it), then played into.
  const soundOn = () => { const ctx = new AudioContext(); void ctx.resume().catch(() => undefined); return ctx; };
  const previewMac = async (id: string) => {
    setMacPick(id);
    saveMacVoice(id);
    // Sound on now, in the tap; then wait for the voice if it's still loading (about a minute after
    // the app opens, or after a quiet while), and play into the sound that's already on.
    const ctx = soundOn();
    setPlaying(id);
    try {
      if (macVoice.phase !== "ready") await waitForMacVoice();
      const where = await speakOnMac(sampleLine(p), setMouth, undefined, ctx, id);
      if (where === "home") await playWithMouth(await api<Blob>("/api/voice/tts", { body: { preview: p.voice } }), setMouth, undefined, ctx);
    } catch { /* picking still works */ } finally { setPlaying(""); void ctx.close().catch(() => undefined); }
  };

  const preview = async (voice: string) => {
    set({ voice });
    const ctx = soundOn();
    setPlaying(voice);
    try {
      const wav = await api<Blob>("/api/voice/tts", { body: { preview: voice } });
      await playWithMouth(wav, setMouth, undefined, ctx);
    } catch {
      /* voices not set up yet: picking still works */
    } finally {
      setPlaying("");
      void ctx.close().catch(() => undefined);
    }
  };

  const dials: [keyof Profile & ("chatty" | "silly" | "detail"), string, string][] = [
    ["chatty", "Calm", "Chatty"], ["silly", "Serious", "Silly"], ["detail", "Short answers", "Explains loads"],
  ];

  return (
    <div className="screen narrow">
      <div className="spread"><h2 className="screen-title">Personality</h2><span className="small" aria-live="polite">{saving === "saving" ? "saving…" : saving === "saved" ? "saved ✓" : saving === "error" ? "couldn’t save" : ""}</span></div>
      <span className="hand sub">make {p.name || "me"}, {p.name || "me"}</span>

      <div className="card" style={{ alignItems: "center", gap: 10 }}>
        {/* Her saved 3D look from My Pip, always (the old flat avatar only until she's made one). */}
        {look3d ? (
          <div className="ed-pip">
            <Pip3D look={{ ...look3d, activity: pose === "laptop" ? "writing" : pose === "sleepy" ? "none" : "none" }} still={prefersStill()} framing="portrait"
              mood={pose === "thinking" ? "thinking" : pose === "sleepy" ? "sleepy" : pose === "talking" ? "excited" : "happy"} label={`${p.name || "Pip"} in 3D`}
              fallback={<Avatar look={p.look} size={130} variant="ring" />} />
          </div>
        ) : (
          <Avatar look={p.look} size={130} variant="ring" mouth={mouth} laptop={pose === "laptop"} mood={pose === "thinking" ? "thinking" : pose === "sleepy" ? "sleepy" : "happy"} talking={pose === "talking" && !mouth} />
        )}
        <div className="chips" style={{ justifyContent: "center" }}>
          {([["around", "eye", "Looking around"], ["talking", "chat2", "Talking"], ["laptop", "laptop", "At its laptop"], ["thinking", "bulb", "Thinking"], ["sleepy", "moon", "Low power"]] as const).map(([k, ic, l]) => (
            <button key={k} className={`chip ${pose === k ? "on" : ""}`} style={{ minHeight: 34, fontSize: "0.8125rem" }} onClick={() => setPose(k)}><IL i={ic}>{l}</IL></button>
          ))}
        </div>
        <input className="input" aria-label="Name" value={p.name} maxLength={24} onChange={(e) => set({ name: e.target.value })}
          style={{ textAlign: "center", fontFamily: "var(--serif)", fontSize: "1.375rem", fontWeight: 600, maxWidth: 220 }} />
        <span className="small">tap to rename</span>
      </div>

      {look3d ? (
        <button className="btn ghost small" style={{ alignSelf: "center" }} onClick={() => go?.("/my-pip")}>Change {p.name || "Pip"}’s look in My {p.name || "Pip"}</button>
      ) : me.looks.length > 1 ? (
        <>
          <b>Pick a look</b>
          <div className="looks" role="radiogroup" aria-label="Look">
            {me.looks.map((l) => (
              <button key={l} className={`look ${p.look === l ? "on" : ""}`} role="radio" aria-checked={p.look === l} aria-label={l} onClick={() => set({ look: l })}><LookIcon look={l} /></button>
            ))}
          </div>
        </>
      ) : <span className="small" style={{ textAlign: "center" }}>More looks are coming soon.</span>}

      <div className="stack">
        <b>{p.name} is…</b>
        <div className="chips">
          {TRAITS.map((t) => <button key={t} className={`chip ${p.traits.includes(t) ? "on" : ""}`} aria-pressed={p.traits.includes(t)} onClick={() => toggleTrait(t)}>{t}</button>)}
        </div>
        <span className="small">Pick up to three.</span>
      </div>

      <div className="stack">
        {dials.map(([k, a, b]) => (
          <label key={k} className="slider">
            <span className="ends"><span>{a}</span><span>{b}</span></span>
            <input type="range" min={0} max={100} value={p[k]} aria-label={`${a} to ${b}`}
              style={{ ["--v" as string]: `${p[k]}%` }} onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<Profile>)} />
          </label>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="stack">
          <b>Recent changes {p.name} made</b>
          {recent.map((c) => <ChangeCard key={c.id} c={c} name={p.name} onProfile={showServer} onChange={(n) => setRecent((l) => l.map((x) => (x.id === n.id ? n : x)))} />)}
          <span className="small">{p.name} can make small tweaks to how it talks when it helps. Undo puts it back, or change it yourself above.</span>
        </div>
      )}

      {onMac && (
        <div className="stack">
          <b>Voice</b>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {MAC_VOICES.map((v) => (
              <button key={v.id} className={`look ${macPick === v.id ? "on" : ""}`} aria-pressed={macPick === v.id} style={{ aspectRatio: "auto", minHeight: 56, fontSize: "0.875rem", fontWeight: 800, display: "flex", flexDirection: "column", gap: 2 }} onClick={() => previewMac(v.id)}>
                <span className="hic"><Icon name={playing === v.id ? "speaker" : "play"} size={18} /></span>{v.name}
              </button>
            ))}
          </div>
          <span className="small" role="status">{voiceProgressText(macVoice, p.name) || `British voices, made on this Mac for calls. On your phone, ${p.name} keeps its usual voice.`}</span>
        </div>
      )}

      {!onMac && (
        <div className="stack">
          <b>Voice</b>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, me.voices.length)}, 1fr)`, gap: 8 }}>
            {me.voices.map((v) => (
              <button key={v} className={`look ${p.voice === v ? "on" : ""}`} style={{ aspectRatio: "auto", minHeight: 56, fontSize: "0.875rem", fontWeight: 800, display: "flex", flexDirection: "column", gap: 2 }} onClick={() => preview(v)}>
                <span className="hic"><Icon name={playing === v ? "speaker" : "play"} size={18} /></span>{v}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <span className="eyebrow">How {p.name} sounds now</span>
        <span style={{ fontSize: "0.9375rem", lineHeight: 1.5 }}>{sampleLine(p)}</span>
      </div>

      <div className="stack">
        <b>{p.name} can help with</b>
        <Toggle label="Homework (helps you learn it)" checked={p.helpWith.homework} onChange={(v) => set({ helpWith: { ...p.helpWith, homework: v } })} />
        <Toggle label="Stories and ideas" checked={p.helpWith.stories} onChange={(v) => set({ helpWith: { ...p.helpWith, stories: v } })} />
        <Toggle label="Music and films to try" checked={p.helpWith.music} onChange={(v) => set({ helpWith: { ...p.helpWith, music: v } })} />
      </div>

      <span className="small">Want to say more about who {p.name} is? Tap {p.name}’s picture › Who {p.name} is. Personality changes how {p.name} talks, never the safety rules underneath. {p.name} is an AI, not a person: it’s here to help and cheer you on, not to replace your friends.</span>
    </div>
  );
}
