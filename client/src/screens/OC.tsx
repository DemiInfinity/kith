import { Icon, IL } from "../components/Icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pip3D, prefersStill } from "../pip3d/Stage";
import { api, OC_TRAITS, type Character, type Me, type Mood, type Sheet, type Turn } from "../api";
import { ItemViewer, MakeSheet, useDesk } from "./Desk";
import { action } from "../lib/action";
import type { PipStage } from "../pip3d/engine";
import { describeLook, NEW_CHARACTER, normaliseLook, speciesGuess, type Look } from "../pip3d/look";
import { ago, DescribePanel, fileName, LookPanel, MakerStage, MakerTabs, MoodPanel, savePng, SnapMenu, useSay, useStill } from "../pip3d/Maker";
import { characterCard } from "../pip3d/card";
import { ensureThumb } from "../pip3d/thumbs";
import { refreshCharacters } from "../lib/characters";

const EMPTY: Sheet = { name: "", icon: "⭐", look: "", personality: "", powers: "", backstory: "", likes: "", dislikes: "", palette: [], themeSong: "", relationships: [] };
const REL = ["friend", "best friend", "rival", "family", "mentor", "teammate", "nemesis", "pet", "sidekick"];

// "Open in the workshop" from a character card in chat: the workshop opens with them selected.
let pending: number | null = null;
export function openInWorkshop(id: number, go: (to: string) => void) {
  pending = id;
  go("/oc");
}
function takePending(): number | null {
  const fromUrl = Number(new URLSearchParams(location.search).get("c")) || null;
  const id = pending ?? fromUrl;
  pending = null;
  return id;
}

type MakerTab = "story" | "describe" | "look" | "mood";
const thumbOk = (u?: string) => typeof u === "string" && u.startsWith("data:image/png;base64,");

/** A round picture of a character: their saved thumbnail, or their icon until one is made. */
export function CharacterThumb({ c, size = 44, thumb }: { c: Character; size?: number; thumb?: string | null }) {
  const src = thumb ?? c.sheet.thumb;
  return thumbOk(src ?? undefined)
    ? <img className="oc-thumb" src={src!} alt="" width={size} height={size} />
    : <span className="oc-thumb ph" style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden>{c.sheet.icon}</span>;
}

/** "wolf girl · she/her" */
export const kindLine = (c: Character) =>
  [c.sheet.species || speciesGuess(normaliseLook(c.sheet.model ?? NEW_CHARACTER)), c.sheet.pronouns].filter(Boolean).join(" · ");

/** One character in the 3D maker: Story, Describe, Look and Mood, then Save character. */
function CharacterMaker({ me, initial, onSaved, onDeleted, onMake }: {
  me: Me; initial: Character | null; onSaved: (c: Character) => void; onDeleted: () => void; onMake: (id: number) => void;
}) {
  const companion = me.profile.name;
  const [sheet, setSheet] = useState<Sheet>(() => ({ ...EMPTY, ...(initial?.sheet ?? {}) }));
  const [look, setLookRaw] = useState<Look>(() => normaliseLook(initial?.sheet.model ?? { ...NEW_CHARACTER, name: initial?.sheet.name.slice(0, 20) ?? "" }));
  // A new character starts on Describe, so Pip can help straight away.
  const [tab, setTab] = useState<MakerTab>(initial ? "story" : "describe");
  const [still, setStill] = useStill();
  const [stage, setStage] = useState<PipStage | null>(null);
  const [say, setSay] = useSay();
  const [dirty, setDirty] = useState(!initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [writing, setWriting] = useState(false);
  const [before, setBefore] = useState<string | null>(null);
  const set = (patch: Partial<Sheet>) => { setSheet((s) => ({ ...s, ...patch })); setDirty(true); };
  const setLook = (l: Look) => { setLookRaw(l); setDirty(true); };
  const title = sheet.name.trim() || "New character";

  useEffect(() => { setSay(initial ? `Hi! I’m ${initial.sheet.name}.` : `Tell me how they look, and I’ll make them!`); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!sheet.name.trim()) { setErr("Give them a name first (it’s in Look)."); setTab("look"); return; }
    setBusy(true); setErr("");
    try {
      const model: Look = { ...look, name: sheet.name.trim().slice(0, 20) };
      let thumb: string | undefined;
      if (stage) {
        for (const px of [200, 160, 128]) { const u = stage.snapshot("portrait", px, false).toDataURL("image/png"); if (u.length <= 155_000) { thumb = u; break; } }
      }
      const body = { ...sheet, model, ...(thumb ? { thumb } : {}) };
      const c = initial
        ? await api<Character>(`/api/oc/characters/${initial.id}`, { method: "PUT", body })
        : await api<Character>("/api/oc/characters", { body });
      setDirty(false);
      onSaved(c);
      setSay(`Saved ${c.sheet.name}!`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const helpWrite = async () => {
    setWriting(true); setErr("");
    const was = sheet.backstory;
    try {
      const r = await api<{ text: string }>("/api/oc/backstory", {
        body: {
          name: sheet.name, looks: describeLook(look), species: sheet.species ?? "", pronouns: sheet.pronouns ?? "", age: sheet.age ?? "",
          traits: sheet.traits ?? [], likes: sheet.likes, dislikes: sheet.dislikes, catchphrase: sheet.catchphrase ?? "", notes: was,
        },
      });
      setBefore(was);
      set({ backstory: r.text.slice(0, 1200) });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setWriting(false);
    }
  };

  const card = stage ? () => characterCard(stage, look, sheet.name, { ...sheet, traits: sheet.traits }) : undefined;
  const text = (k: "pronouns" | "age" | "species" | "catchphrase" | "likes" | "dislikes", label: string, max: number, placeholder: string) => (
    <label className="field">{label}
      <input className="input" value={(sheet[k] as string | undefined) ?? ""} maxLength={max} placeholder={placeholder} onChange={(e) => set({ [k]: e.target.value } as Partial<Sheet>)} />
    </label>
  );
  const long = (k: "look" | "personality" | "powers", label: string, placeholder: string) => (
    <label className="field">{label}
      <textarea className="textarea" value={sheet[k]} maxLength={400} placeholder={placeholder} onChange={(e) => set({ [k]: e.target.value } as Partial<Sheet>)} />
    </label>
  );
  const traits = sheet.traits ?? [];

  return (
    <div className="maker">
      <MakerStage look={look} still={still} onStage={setStage} title={title} say={say}
        fallback={initial && thumbOk(initial.sheet.thumb) ? <img src={initial.sheet.thumb} alt={`${title}’s picture`} /> : <span className="oc-thumb ph" style={{ width: 160, height: 160, fontSize: 72 }}>{sheet.icon}</span>}
        menu={<SnapMenu stage={stage} name={sheet.name} fallbackName="character" card={card} />} />
      <section className="mk-panel" aria-label={`${title}’s details`}>
        <MakerTabs label="Character sections" tab={tab} setTab={setTab}
          tabs={[["story", "Story"], ["describe", "Describe"], ["look", "Look"], ["mood", "Mood"]]} />
        <div className="mk-body" role="tabpanel">
          {tab === "story" && (
            <div className="mk-pane">
              <div className="mk-fields">
                {text("pronouns", "PRONOUNS", 40, "she/her, he/him, they/them…")}
                {text("age", "AGE", 40, "14, or 300 for a forest spirit")}
                {text("species", "SPECIES OR KIND", 60, speciesGuess(look))}
                {text("catchphrase", "CATCHPHRASE", 80, "Something they always say")}
                {text("likes", "LIKES", 300, "rainy days, drawing, ramen")}
                {text("dislikes", "DISLIKES", 300, "loud noises, mornings")}
              </div>
              <span className="mk-lbl">PERSONALITY</span>
              <div className="chips" role="group" aria-label="Personality">
                {OC_TRAITS.map((t) => {
                  const on = traits.includes(t);
                  return <button key={t} className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => set({ traits: on ? traits.filter((x) => x !== t) : [...traits, t] })}>{t}</button>;
                })}
              </div>
              <label className="field">BACKSTORY
                <textarea className="textarea" rows={6} value={sheet.backstory} maxLength={1200} placeholder="Where do they come from? What happened to them? What do they want?"
                  onChange={(e) => set({ backstory: e.target.value })} />
              </label>
              <div className="row" style={{ flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn ghost small" disabled={writing} onClick={helpWrite}><Icon name="sparkle" size={16} /> {writing ? "Writing…" : `Help me write it with ${companion}`}</button>
                {before !== null && !writing && <button className="btn ghost small" onClick={() => { set({ backstory: before }); setBefore(null); }}>Put back what I had</button>}
                <span className="small">{companion} suggests, you edit. It keeps stories kind.</span>
              </div>
              {long("powers", "POWERS OR TALENTS", "What can they do?")}
              {long("personality", "PERSONALITY, IN YOUR WORDS", "What are they like?")}
              {long("look", "LOOK NOTES", "Anything about how they look that the 3D parts can’t show")}
              <label className="field">THEME SONG
                <input className="input" value={sheet.themeSong} maxLength={200} placeholder="An idea, or a song you love" onChange={(e) => set({ themeSong: e.target.value })} />
              </label>
              <div className="stack">
                <span className="mk-lbl">PALETTE</span>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {sheet.palette.map((c, i) => (
                    <span key={i} className="row" style={{ gap: 4 }}>
                      <input type="color" aria-label={`Colour ${i + 1}`} value={c} onChange={(e) => set({ palette: sheet.palette.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)) })} style={{ width: 44, height: 44, border: 0, background: "none" }} />
                      <button className="x" aria-label="Remove colour" onClick={() => set({ palette: sheet.palette.filter((_, j) => j !== i) })}><Icon name="close" size={16} /></button>
                    </span>
                  ))}
                  {sheet.palette.length < 6 && <button className="btn ghost small" onClick={() => set({ palette: [...sheet.palette, "#D9A3E0"] })}><IL i="plus">colour</IL></button>}
                </div>
              </div>
              <div className="stack">
                <span className="mk-lbl">RELATIONSHIPS</span>
                {sheet.relationships.map((r, i) => (
                  <div key={i} className="row">
                    <select className="select" style={{ width: 140 }} value={r.kind} onChange={(e) => set({ relationships: sheet.relationships.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)) })}>{REL.map((k) => <option key={k}>{k}</option>)}</select>
                    <span className="small">of</span>
                    <input className="input" value={r.with} placeholder="who" onChange={(e) => set({ relationships: sheet.relationships.map((x, j) => (j === i ? { ...x, with: e.target.value } : x)) })} />
                    <button className="x" aria-label="Remove" onClick={() => set({ relationships: sheet.relationships.filter((_, j) => j !== i) })}><Icon name="close" size={16} /></button>
                  </div>
                ))}
                {sheet.relationships.length < 12 && <button className="btn ghost small" onClick={() => set({ relationships: [...sheet.relationships, { with: "", kind: "friend", note: "" }] })}><IL i="plus">relationship</IL></button>}
              </div>
              <div className="row">
                <input className="input" aria-label="Icon" value={sheet.icon} onChange={(e) => set({ icon: e.target.value.slice(0, 4) })} style={{ width: 64, textAlign: "center", fontSize: "1.5rem" }} />
                <span className="small">Their icon, for lists and the desk</span>
              </div>
              {initial && (
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <button className="btn ghost small" onClick={() => onMake(initial.id)}>Make something with {initial.sheet.name}</button>
                  <button className="btn ghost small" onClick={action(async () => { if (confirm(`Delete ${initial.sheet.name}?`)) { await api(`/api/oc/characters/${initial.id}`, { method: "DELETE" }); onDeleted(); } }, "delete that character")}>Delete</button>
                </div>
              )}
            </div>
          )}
          {tab === "describe" && <DescribePanel forWhat="oc" look={look} setLook={setLook} say={setSay} companion={companion} />}
          {tab === "look" && <LookPanel forWhat="oc" look={look} setLook={setLook} companion={companion} name={{ value: sheet.name, set: (v) => set({ name: v }) }} />}
          {tab === "mood" && <MoodPanel forWhat="oc" look={look} setLook={setLook} still={still} setStill={setStill} companion={companion} />}
        </div>
        {err && <span className="small mk-err" role="alert">{err}</span>}
        <div className="mk-foot">
          <span className="mk-status" role="status">{dirty ? "Not saved yet" : initial ? `Saved · ${ago(initial.updated)}` : ""}</span>
          {card && <button className="btn ghost" onClick={action(async () => savePng(await card(), fileName(sheet.name, "character", "card")), "make the card")}>Character card</button>}
          <button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save character"}</button>
        </div>
      </section>
    </div>
  );
}

/**
 * OC workshop: her characters as cards; picking one (or building a new one with the companion)
 * opens the 3D maker with their whole story. The world list isn't shown any more (its data is kept).
 */
export function OC({ me, go }: { me: Me; onTurn: (t: Turn) => void; onMood: (m: Mood) => void; openHelp: () => void; go: (to: string) => void }) {
  const [chars, setChars] = useState<Character[] | null>(null);
  const [picked, setPicked] = useState<number | "new" | null>(() => takePending());
  const [making, setMaking] = useState<number[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const { desk, reload } = useDesk(10000);
  const load = useCallback(() => api<{ characters: Character[] }>("/api/oc").then((r) => { setChars(r.characters); }).catch(() => { setChars((c) => c ?? []); }), []);
  useEffect(() => { void load(); }, [load]);
  const name = me.profile.name;
  const gallery = (desk?.items ?? []).filter((i) => i.characterIds.length > 0);

  // Characters made in chat have no picture yet: draw each one once, here.
  useEffect(() => {
    let gone = false;
    (async () => {
      for (const c of chars ?? []) {
        if (c.sheet.thumb || gone) continue;
        const t = await ensureThumb(c);
        if (t && !gone) setThumbs((x) => ({ ...x, [c.id]: t }));
      }
    })();
    return () => { gone = true; };
  }, [chars]);

  // The grid's cards are still pictures; the one under the pointer (or pressed, or focused) comes
  // alive. One shared 3D view moves between cards; the engine loads on the first hover. Reduced
  // motion: always still.
  const gridRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [live, setLive] = useState<{ look: Look; x: number; y: number } | null>(null);
  const reduced = useMemo(prefersStill, []);
  const wake = (c: Character, card: HTMLElement) => {
    if (reduced || !gridRef.current) return;
    const thumb = card.querySelector(".oc-thumb");
    if (!thumb) return;
    const g = gridRef.current.getBoundingClientRect(), t = thumb.getBoundingClientRect();
    setLive({ look: normaliseLook(c.sheet.model ?? { ...NEW_CHARACTER, name: c.sheet.name.slice(0, 20) }), x: t.left - g.left, y: t.top - g.top });
    setHover(c.id);
  };
  const sleep = (id: number) => setHover((h) => (h === id ? null : h));

  const current = useMemo(() => (typeof picked === "number" ? chars?.find((c) => c.id === picked) ?? null : null), [chars, picked]);
  const inMaker = picked === "new" || !!current;
  const head = (
    <div className="mk-head">
      <h2 className="screen-title">OC workshop</h2>
      <span className="hand">your characters in 3D, with their whole story. {name} isn’t one of them.</span>
    </div>
  );

  if (inMaker) {
    return (
      <div className="screen oc-screen">
        {head}
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className="btn ghost small" onClick={() => setPicked(null)}><Icon name="back" size={16} /> My characters</button>
        </div>
        <CharacterMaker key={picked === "new" ? "new" : current!.id} me={me} initial={picked === "new" ? null : current}
          onSaved={(c) => { void load(); setPicked(c.id); refreshCharacters(); }}
          onDeleted={() => { setPicked(null); void load(); refreshCharacters(); }}
          onMake={(id) => setMaking([id])} />
        {making && <MakeSheet me={me} characterIds={making} onClose={() => setMaking(null)} onStarted={reload} />}
      </div>
    );
  }

  return (
    <div className="screen oc-screen">
      {head}
      <span className="mk-lbl">MY CHARACTERS</span>
      <div className="oc-grid" role="list" ref={gridRef}>
        {(chars ?? []).map((c) => (
          <button key={c.id} role="listitem" className="oc-card" onClick={() => setPicked(c.id)} aria-label={`Open ${c.sheet.name}`}
            onPointerEnter={(e) => wake(c, e.currentTarget)} onPointerDown={(e) => wake(c, e.currentTarget)} onFocus={(e) => wake(c, e.currentTarget)}
            onPointerLeave={() => sleep(c.id)} onBlur={() => sleep(c.id)}>
            <CharacterThumb c={c} size={88} thumb={thumbs[c.id]} />
            <b>{c.sheet.name}</b>
            <span>{kindLine(c)}</span>
          </button>
        ))}
        {/* One live 3D view for the whole grid, laid over the card being hovered, pressed or focused. */}
        {live && (
          <div className="oc-live" aria-hidden style={{ left: live.x, top: live.y, visibility: hover !== null ? "visible" : "hidden" }}>
            <Pip3D look={live.look} still={false} active={hover !== null} framing="portrait" label="" fallback={null} />
          </div>
        )}
        <button role="listitem" className="oc-card new" onClick={() => setPicked("new")}>
          <span className="oc-thumb ph" style={{ width: 88, height: 88 }} aria-hidden><Icon name="plus" size={30} /></span>
          <b>New character</b>
          <span>{name} helps you make them</span>
        </button>
      </div>
      {chars !== null && chars.length === 0 && <span className="small">No characters yet. Tap New character: describe them, pick their look and write their story, with {name} helping.</span>}
      <b>Gallery</b>
      {gallery.length === 0 && <span className="small">Sketches, palettes, comics and stories starring your OCs will show up here (and on {name}’s desk).</span>}
      <div className="grid2">
        {gallery.map((it) => <button key={it.id} className="made" onClick={() => setOpen(it.id)}><span className="ic">{it.icon}</span><b>{it.title}</b><span>{it.summary}</span></button>)}
      </div>
      <span className="small">Friendships, rivalries and adventures: yes. Romance: not here. Pictures you take download to this device; uploading your own drawings isn’t switched on yet, as it needs an extra safety check first.</span>
      {open && <ItemViewer id={open} canEdit onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}
