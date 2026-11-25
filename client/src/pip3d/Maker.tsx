// The parts the two 3D makers share (My Pip and the OC workshop): the stage with its name plate
// and "Take a picture" menu, and the Describe, Look and Mood tabs.

import { useEffect, useRef, useState } from "react";
import { api, type Described } from "../api";
import { Icon } from "../components/Icons";
import type { PipStage } from "./engine";
import {
  BEANIES, describeLook, EARS, HAIR, HAIR_STYLES, IRIS, OUTFIT, OUTFIT_STYLES, PALETTES, PATTERNS, SKIN, STYLES, surpriseLook,
  type Activity, type Look, type Mood3D,
} from "./look";
import { Pip3D, prefersStill } from "./Stage";

export type MakerFor = "pip" | "oc";

const LABEL = {
  kind: { blob: "Creature", chibi: "Anime chibi" },
  style: { glossy: "Glossy toy", clay: "Soft clay", plush: "Plush" },
  pattern: { plain: "Plain", galaxy: "Galaxy", spots: "Spots", stripes: "Stripes" },
  ears: { none: "None", wolf: "Wolf", fox: "Fox", bunny: "Bunny", bear: "Bear", cat: "Cat" },
  wear: { beanie: "Beanie", scarf: "Scarf", glasses: "Glasses", headphones: "Headphones" },
  hairStyle: { short: "Short", long: "Long", twin: "Twin tails", bob: "Bob", ponytail: "Ponytail", buns: "Buns", curly: "Curly puff", braids: "Braids" },
  outfitStyle: { hoodie: "Hoodie", dress: "Dress", dungarees: "Dungarees", tracksuit: "Tracksuit", pyjamas: "Pyjamas" },
  mood: { listening: "Listening", happy: "Happy", excited: "Excited", thinking: "Thinking", surprised: "Surprised", shy: "Shy", proud: "Proud", loving: "Loving", cheeky: "Cheeky", sad: "Sad", sleepy: "Sleepy" },
  activity: { none: "Nothing", study: "Studying", art: "Drawing", writing: "Writing", cocoa: "Cocoa break", sleepy: "Bedtime" },
  beanie: { "#E3A91C": "Yellow", "#E25C6E": "Red", "#6C8FE6": "Blue", "#7FD0C9": "Mint" },
} as const;

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** "Still Pip": starts on for people who ask for less motion. */
export function useStill() {
  return useState<boolean>(prefersStill);
}

/** Saves a picture as a PNG file. */
export async function savePng(canvas: HTMLCanvasElement, filename: string) {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("no picture");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const fileName = (name: string, fallback: string, suffix: string) =>
  `${(name || fallback).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || fallback}-${suffix}.png`;

/** A little speech bubble over the stage for a few seconds. */
export function useSay(): [string, (t: string) => void] {
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [text, (t: string) => { setText(t); clearTimeout(timer.current); timer.current = setTimeout(() => setText(""), 3500); }];
}

/** The stage: the character in 3D (or its picture when WebGL isn't there), name plate and picture menu. */
export function MakerStage({ look, still, onStage, title, say, fallback, menu, music = false }: {
  look: Look; still: boolean; onStage: (s: PipStage | null) => void; title: string; say: string; fallback: React.ReactNode; menu: React.ReactNode;
  /** My Pip, while music plays on her Mac: headphones on the stage only (not in the look or its pictures). */
  music?: boolean;
}) {
  return (
    <section className="mk-stage" aria-label={`${title} in 3D`}>
      <Pip3D look={look} still={still} onStage={onStage} music={music} label={`${title} in 3D. Drag to turn round.`} fallback={<div className="mk-fallback">{fallback}</div>} />
      {say && <div className="mk-say" role="status">{say}</div>}
      <div className="mk-name"><b>{title}</b><span>{describeLook(look)}</span></div>
      <span className="mk-hint">drag to turn · looks around by itself</span>
      {menu}
    </section>
  );
}

/** "Take a picture": profile, full body, a character card (characters only) and a see-through option. */
export function SnapMenu({ stage, name, fallbackName, card }: {
  stage: PipStage | null; name: string; fallbackName: string; card?: () => Promise<HTMLCanvasElement>;
}) {
  const [open, setOpen] = useState(false);
  const [clear, setClear] = useState(false);
  const [err, setErr] = useState("");
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const take = async (what: "portrait" | "full" | "card") => {
    if (!stage) return;
    setErr("");
    try {
      const c = what === "card" && card ? await card() : stage.snapshot(what === "card" ? "portrait" : what, 1024, clear);
      await savePng(c, fileName(name, fallbackName, what === "portrait" ? "picture" : what === "full" ? "full-body" : "card"));
      setOpen(false);
    } catch {
      setErr("Couldn’t save the picture here.");
    }
  };
  return (
    <div className="mk-snap" ref={wrap}>
      <button className="mk-snapbtn" aria-expanded={open} aria-haspopup="menu" disabled={!stage} onClick={() => setOpen(!open)}>
        <Icon name="camera" size={18} />Take a picture
      </button>
      {open && (
        <div className="mk-snapmenu" role="menu">
          <button role="menuitem" onClick={() => take("portrait")}>Profile picture (square PNG)</button>
          <button role="menuitem" onClick={() => take("full")}>Full body (PNG)</button>
          {card && <button role="menuitem" onClick={() => take("card")}>Character card (PNG)</button>}
          <label className="mk-toggle"><input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /> See-through background</label>
          {err && <span className="small" role="alert">{err}</span>}
        </div>
      )}
    </div>
  );
}

/** Tabs along the top of the panel (arrow keys move between them). */
export function MakerTabs<T extends string>({ tabs, tab, setTab, label }: { tabs: [T, string][]; tab: T; setTab: (t: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="mk-tabs" role="tablist" aria-label={label}>
      {tabs.map(([id, name], i) => (
        <button key={id} ref={(el) => { refs.current[i] = el; }} role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
          className={tab === id ? "on" : ""} onClick={() => setTab(id)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const k = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
            refs.current[k]?.focus(); setTab(tabs[k][0]);
          }}>{name}</button>
      ))}
    </div>
  );
}

const chipRow = <T extends string>(label: string, options: readonly T[], names: Record<T, string>, on: (v: T) => boolean, pick: (v: T) => void) => (
  <div className="mk-row" role="group" aria-label={label}>
    <span className="mk-lbl">{label}</span>
    <div className="chips">
      {options.map((o) => <button key={o} className={`chip ${on(o) ? "on" : ""}`} aria-pressed={on(o)} onClick={() => pick(o)}>{names[o]}</button>)}
    </div>
  </div>
);
const swatchRow = <K extends string>(label: string, map: Record<K, string>, value: K, pick: (k: K) => void, names?: Partial<Record<K, string>>) => (
  <div className="mk-row" role="group" aria-label={label}>
    <span className="mk-lbl">{label}</span>
    <div className="mk-swatches">
      {(Object.keys(map) as K[]).map((k) => (
        <button key={k} className="mk-swatch" aria-pressed={value === k} aria-label={`${label.toLowerCase()}: ${names?.[k] ?? k}`} title={names?.[k] ?? k}
          style={{ background: map[k] }} onClick={() => pick(k)} />
      ))}
    </div>
  </div>
);

/** Describe it in words: Claude picks the parts (checked first), with a few ideas to try. */
export function DescribePanel({ forWhat, look, setLook, say, companion }: {
  forWhat: MakerFor; look: Look; setLook: (l: Look) => void; say: (t: string) => void; companion: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<{ ok: string[]; miss: string[] }>({ ok: [], miss: [] });
  const [err, setErr] = useState("");
  const tries = forWhat === "pip"
    ? ["a little fox-blob with galaxy fur and a yellow beanie", "an anime wolf girl with long dark hair and amber eyes", "a sleepy bunny blob with spots"]
    : ["a chibi fox boy with short orange hair and a mint hoodie", "a shy bunny with pink hair in buns and dungarees", "a cat girl with silver hair, glasses and a scarf"];
  const make = async (words: string) => {
    if (!words.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      const r = await api<Described>("/api/pip/describe", { body: { text: words, for: forWhat, base: look } });
      if (r.refused) {
        setGot({ ok: [], miss: ["let’s keep it cosy and friendly"] });
        say(forWhat === "pip" ? "I’m your friendly AI sidekick, so let’s keep me cosy. Want to try a different look?" : "Let’s keep characters cosy and friendly. Want to try a different look?");
        return;
      }
      setLook({ ...r.look, name: look.name });
      setGot({ ok: r.understood, miss: r.notYet.map((m) => `no ${m} yet`) });
      if (!r.understood.length && !r.notYet.length) setGot({ ok: [], miss: ["try words like fox, galaxy, beanie, sleepy"] });
      say(r.notYet.length ? `I don’t have ${r.notYet.join(" or ")} yet, but how’s this?` : r.understood.length ? (forWhat === "pip" ? "Ta-da! How do I look?" : "Ta-da! How’s this?") : "Tell me a bit more about the look!");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mk-pane">
      <h2>{forWhat === "pip" ? `Describe your ${companion}` : "Describe them"}</h2>
      <p className="mk-sub">{forWhat === "pip"
        ? `Tell ${companion} how it should look. It picks from the parts, and checks everything is kind and cosy first.`
        : "Pip turns the words into the parts in Look: kind, hair, ears and tail, eyes, outfit and extras. Characters stay cosy: chibi proportions, outfits from a set list, never romantic."}</p>
      <label className="mk-lbl" htmlFor={`describe-${forWhat}`}>{forWhat === "pip" ? `HOW SHOULD ${companion.toUpperCase()} LOOK?` : "HOW DO THEY LOOK?"}</label>
      <textarea id={`describe-${forWhat}`} className="textarea" rows={3} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="chips">
        {tries.map((t) => <button key={t} className="chip" onClick={() => { setText(t); void make(t); }}>Try: {t.replace(/^(a|an) /, "").split(" with ")[0]}</button>)}
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => make(text)}>{busy ? "Making…" : forWhat === "pip" ? `Make my ${companion}` : "Make them"}</button>
        <button className="btn ghost" onClick={() => { setLook({ ...surpriseLook(look), name: look.name }); setGot({ ok: [], miss: [] }); say("Surprise! Keep it or try again?"); }}>Surprise me</button>
      </div>
      <div className="mk-understood" aria-live="polite">
        {got.ok.map((u) => <span key={u}>{u}</span>)}
        {got.miss.map((u) => <span key={u} className="miss">{u}</span>)}
      </div>
      {err && <span className="small" role="alert" style={{ color: "var(--ember)" }}>{err}</span>}
    </div>
  );
}

/** Every part, picked by hand. */
export function LookPanel({ forWhat, look, setLook, companion, name }: {
  forWhat: MakerFor; look: Look; setLook: (l: Look) => void; companion: string;
  /** A character's name lives on their sheet (it can be longer than the look's). */
  name?: { value: string; set: (v: string) => void };
}) {
  const set = (patch: Partial<Look>) => setLook({ ...look, ...patch });
  const chibi = look.kind === "chibi";
  const wearOn = (w: Look["wear"][number]) => look.wear.includes(w);
  return (
    <div className="mk-pane">
      <h2>Look</h2>
      <label className="mk-lbl" htmlFor={`name-${forWhat}`}>{forWhat === "pip" ? "NAME" : "CHARACTER NAME"}</label>
      <input id={`name-${forWhat}`} className="input" maxLength={name ? 40 : 20} value={name ? name.value : look.name}
        onChange={(e) => (name ? name.set(e.target.value) : set({ name: e.target.value }))} />
      {forWhat === "pip" && <span className="small">Pip’s real name is set in Personality; this is just for the 3D look.</span>}
      {chipRow("KIND", ["blob", "chibi"] as const, LABEL.kind, (v) => look.kind === v, (v) => set({ kind: v }))}
      {chibi ? (
        <>
          {swatchRow("HAIR", HAIR, look.hair, (k) => set({ hair: k }))}
          {chipRow("HAIRSTYLE", HAIR_STYLES, LABEL.hairStyle, (v) => look.hairStyle === v, (v) => set({ hairStyle: v }))}
          <label className="mk-toggle"><input type="checkbox" checked={look.ahoge} onChange={(e) => set({ ahoge: e.target.checked })} /> Ahoge (one cheeky strand on top)</label>
          {swatchRow("EYES", IRIS, look.eyesC, (k) => set({ eyesC: k }))}
          {swatchRow("SKIN", SKIN, look.skin, (k) => set({ skin: k }))}
          {chipRow("OUTFIT", OUTFIT_STYLES, LABEL.outfitStyle, (v) => look.outfitStyle === v, (v) => set({ outfitStyle: v }))}
          {swatchRow("OUTFIT COLOUR", OUTFIT, look.outfit, (k) => set({ outfit: k }))}
        </>
      ) : (
        <>
          {chipRow("FINISH", STYLES, LABEL.style, (v) => look.style === v, (v) => set({ style: v }))}
          <div className="mk-row" role="group" aria-label="Colour">
            <span className="mk-lbl">COLOUR</span>
            <div className="mk-swatches">
              {(Object.keys(PALETTES) as Look["palette"][]).map((k) => (
                <button key={k} className="mk-swatch" aria-pressed={look.palette === k} aria-label={`Colour: ${PALETTES[k].name}`} title={PALETTES[k].name}
                  style={{ background: `linear-gradient(135deg, ${PALETTES[k].c[0]}, ${PALETTES[k].c[1]} 55%, ${PALETTES[k].c[2]})` }} onClick={() => set({ palette: k })} />
              ))}
            </div>
          </div>
          {chipRow("PATTERN", PATTERNS, LABEL.pattern, (v) => look.pattern === v, (v) => set({ pattern: v }))}
        </>
      )}
      {chipRow(chibi ? "ANIMAL EARS AND TAIL" : "EARS", EARS, LABEL.ears, (v) => look.ears === v, (v) => set({ ears: v }))}
      {chipRow("WEARING", ["beanie", "scarf", "glasses", "headphones"] as const, LABEL.wear, wearOn, (w) => set({ wear: wearOn(w) ? look.wear.filter((x) => x !== w) : [...look.wear, w] }))}
      {wearOn("beanie") && swatchRow("BEANIE", Object.fromEntries(BEANIES.map((b) => [b, b])) as Record<Look["beanie"], string>, look.beanie, (k) => set({ beanie: k }), LABEL.beanie)}
    </div>
  );
}

/** Moods and things to do, and Still Pip. */
export function MoodPanel({ forWhat, look, setLook, still, setStill, companion }: {
  forWhat: MakerFor; look: Look; setLook: (l: Look) => void; still: boolean; setStill: (s: boolean) => void; companion: string;
}) {
  return (
    <div className="mk-pane">
      <h2>{forWhat === "pip" ? "Mood" : "Mood and pose"}</h2>
      <p className="mk-sub">{forWhat === "pip" ? `In chat, ${companion}’s mood follows the conversation. Pick one here to see how it looks.` : "Pick how they look in their pictures."}</p>
      {chipRow("MOOD", Object.keys(LABEL.mood) as Mood3D[], LABEL.mood, (v) => look.mood === v, (v) => setLook({ ...look, mood: v }))}
      {chipRow(look.kind === "chibi" ? "DOING" : "DOING (ANIME CHIBI ONLY)", Object.keys(LABEL.activity) as Activity[], LABEL.activity, (v) => look.activity === v, (v) => setLook({ ...look, activity: v }))}
      <label className="mk-toggle"><input type="checkbox" checked={still} onChange={(e) => setStill(e.target.checked)} /> Still {forWhat === "pip" ? companion : "character"} (no movement)</label>
      <p className="small">Anime chibis keep chibi proportions, wear cosy outfits from a set list and are never romantic. {companion} is still an AI and says so. No camera is used, and it doesn’t follow your pointer: it looks around on its own.</p>
    </div>
  );
}
