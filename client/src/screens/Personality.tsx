import { Icon, IL } from "../components/Icons";
import { useEffect, useRef, useState } from "react";
import { api, type Me, type Profile } from "../api";
import { Avatar, LookIcon } from "../components/Avatar";
import { Toggle } from "../components/bits";
import { playWithMouth } from "../lib/audio";

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
export function Personality({ me, onSaved }: { me: Me; onSaved: (p: Profile) => void }) {
  const [p, setP] = useState<Profile>(me.profile);
  const [saving, setSaving] = useState<"" | "saving" | "saved" | "error">("");
  const [mouth, setMouth] = useState(0);
  const [playing, setPlaying] = useState("");
  const [pose, setPose] = useState<"around" | "talking" | "laptop" | "thinking" | "sleepy">("around");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
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

  const preview = async (voice: string) => {
    set({ voice });
    setPlaying(voice);
    try {
      const wav = await api<Blob>("/api/voice/tts", { body: { preview: voice } });
      await playWithMouth(wav, setMouth);
    } catch {
      /* voices not set up yet: picking still works */
    } finally {
      setPlaying("");
    }
  };

  const dials: [keyof Profile & ("chatty" | "silly" | "detail"), string, string][] = [
    ["chatty", "Calm", "Chatty"], ["silly", "Serious", "Silly"], ["detail", "Short answers", "Explains loads"],
  ];

  return (
    <div className="screen narrow">
      <span className="hand">make {p.name || "me"}, {p.name || "me"}</span>
      <div className="spread"><h2 className="screen-title">Personality</h2><span className="small" aria-live="polite">{saving === "saving" ? "saving…" : saving === "saved" ? "saved ✓" : saving === "error" ? "couldn’t save" : ""}</span></div>

      <div className="card" style={{ alignItems: "center", gap: 10 }}>
        <Avatar look={p.look} size={130} variant="ring" mouth={mouth} laptop={pose === "laptop"} mood={pose === "thinking" ? "thinking" : pose === "sleepy" ? "sleepy" : "happy"} talking={pose === "talking" && !mouth} />
        <div className="chips" style={{ justifyContent: "center" }}>
          {([["around", "eye", "Looking around"], ["talking", "chat2", "Talking"], ["laptop", "laptop", "At its laptop"], ["thinking", "bulb", "Thinking"], ["sleepy", "moon", "Low power"]] as const).map(([k, ic, l]) => (
            <button key={k} className={`chip ${pose === k ? "on" : ""}`} style={{ minHeight: 34, fontSize: 13 }} onClick={() => setPose(k)}><IL i={ic}>{l}</IL></button>
          ))}
        </div>
        <input className="input" aria-label="Name" value={p.name} maxLength={24} onChange={(e) => set({ name: e.target.value })}
          style={{ textAlign: "center", fontFamily: "var(--serif)", fontSize: 22, fontWeight: 600, maxWidth: 220 }} />
        <span className="small">tap to rename</span>
      </div>

      {me.looks.length > 1 ? (
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

      <div className="stack">
        <b>Voice</b>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(3, me.voices.length)}, 1fr)`, gap: 8 }}>
          {me.voices.map((v) => (
            <button key={v} className={`look ${p.voice === v ? "on" : ""}`} style={{ aspectRatio: "auto", minHeight: 56, fontSize: 14, fontWeight: 800, display: "flex", flexDirection: "column", gap: 2 }} onClick={() => preview(v)}>
              <span className="hic"><Icon name={playing === v ? "speaker" : "play"} size={18} /></span>{v}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <span className="eyebrow">How {p.name} sounds now</span>
        <span style={{ fontSize: 15, lineHeight: 1.5 }}>{sampleLine(p)}</span>
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
