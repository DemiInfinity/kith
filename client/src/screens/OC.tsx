import { useCallback, useEffect, useState } from "react";
import { api, type Character, type Me, type Mood, type Sheet, type Turn, type WorldEntry } from "../api";
import { Chat } from "./Chat";
import { ItemViewer, MakeSheet, useDesk } from "./Desk";

const EMPTY: Sheet = { name: "", icon: "⭐", look: "", personality: "", powers: "", backstory: "", likes: "", dislikes: "", palette: [], themeSong: "", relationships: [] };
const REL = ["friend", "best friend", "rival", "family", "mentor", "teammate", "nemesis", "pet", "sidekick"];

function SheetEditor({ initial, onSave, onCancel }: { initial: Character | null; onSave: () => void; onCancel: () => void }) {
  const [s, setS] = useState<Sheet>(initial?.sheet ?? EMPTY);
  const [err, setErr] = useState("");
  const set = (patch: Partial<Sheet>) => setS((x) => ({ ...x, ...patch }));
  const save = async () => {
    try {
      if (initial) await api(`/api/oc/characters/${initial.id}`, { method: "PUT", body: s });
      else await api("/api/oc/characters", { body: s });
      onSave();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const field = (k: keyof Sheet, label: string, long = false) => (
    <label className="field">{label}
      {long
        ? <textarea className="textarea" value={s[k] as string} onChange={(e) => set({ [k]: e.target.value } as Partial<Sheet>)} maxLength={k === "backstory" ? 1200 : 400} />
        : <input className="input" value={s[k] as string} onChange={(e) => set({ [k]: e.target.value } as Partial<Sheet>)} maxLength={k === "name" ? 40 : 300} />}
    </label>
  );
  return (
    <div className="card" style={{ gap: 12 }}>
      <div className="row">
        <input className="input" aria-label="Icon" value={s.icon} onChange={(e) => set({ icon: e.target.value.slice(0, 4) })} style={{ width: 64, textAlign: "center", fontSize: 24 }} />
        {field("name", "Name")}
      </div>
      {field("look", "Look", true)}
      {field("personality", "Personality", true)}
      {field("powers", "Powers or skills", true)}
      {field("backstory", "Backstory", true)}
      {field("likes", "Likes")}
      {field("dislikes", "Dislikes")}
      {field("themeSong", "Theme song (an idea, or a song you love)")}
      <div className="stack">
        <b style={{ fontSize: 14 }}>Palette</b>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {s.palette.map((c, i) => (
            <span key={i} className="row" style={{ gap: 4 }}>
              <input type="color" aria-label={`Colour ${i + 1}`} value={c} onChange={(e) => set({ palette: s.palette.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)) })} style={{ width: 44, height: 44, border: 0, background: "none" }} />
              <button className="x" aria-label="Remove colour" onClick={() => set({ palette: s.palette.filter((_, j) => j !== i) })}>✕</button>
            </span>
          ))}
          {s.palette.length < 6 && <button className="btn ghost small" onClick={() => set({ palette: [...s.palette, "#D9A3E0"] })}>+ colour</button>}
        </div>
      </div>
      <div className="stack">
        <b style={{ fontSize: 14 }}>Relationships</b>
        {s.relationships.map((r, i) => (
          <div key={i} className="row">
            <select className="select" style={{ width: 140 }} value={r.kind} onChange={(e) => set({ relationships: s.relationships.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)) })}>{REL.map((k) => <option key={k}>{k}</option>)}</select>
            <span className="small">of</span>
            <input className="input" value={r.with} placeholder="who" onChange={(e) => set({ relationships: s.relationships.map((x, j) => (j === i ? { ...x, with: e.target.value } : x)) })} />
            <button className="x" aria-label="Remove" onClick={() => set({ relationships: s.relationships.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        {s.relationships.length < 12 && <button className="btn ghost small" onClick={() => set({ relationships: [...s.relationships, { with: "", kind: "friend", note: "" }] })}>+ relationship</button>}
      </div>
      {err && <span className="small" style={{ color: "var(--ember)" }}>{err}</span>}
      <div className="row"><button className="btn primary" disabled={!s.name.trim()} onClick={save}>Save</button><button className="btn ghost" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

/** OC workshop: character sheets, their world, a gallery from the desk, and building them with the companion. */
export function OC({ me, onTurn, onMood, openHelp, go }: { me: Me; onTurn: (t: Turn) => void; onMood: (m: Mood) => void; openHelp: () => void; go: (to: string) => void }) {
  const [tab, setTab] = useState<"characters" | "workshop" | "world">("characters");
  const [chars, setChars] = useState<Character[]>([]);
  const [world, setWorld] = useState<WorldEntry[]>([]);
  const [editing, setEditing] = useState<Character | "new" | null>(null);
  const [making, setMaking] = useState<number[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [place, setPlace] = useState({ kind: "place", name: "", note: "", when: "" });
  const { desk, reload } = useDesk(10000);
  const load = useCallback(() => api<{ characters: Character[]; world: WorldEntry[] }>("/api/oc").then((r) => { setChars(r.characters); setWorld(r.world); }).catch(() => undefined), []);
  useEffect(() => { void load(); }, [load, tab]);
  const name = me.profile.name;
  const gallery = (desk?.items ?? []).filter((i) => i.characterIds.length > 0);

  const addWorld = async () => {
    if (!place.name.trim()) return;
    await api("/api/oc/world", { body: place }).catch((e) => alert((e as Error).message));
    setPlace({ kind: place.kind, name: "", note: "", when: "" });
    void load();
  };

  const tabs = (
    <div className="chips" role="tablist" style={{ padding: "10px 18px 0" }}>
      {(["characters", "workshop", "world"] as const).map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} className={`chip ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
          {t === "characters" ? "⭐ Characters" : t === "workshop" ? `💬 Build with ${name}` : "🗺️ World"}
        </button>
      ))}
    </div>
  );

  if (tab === "workshop") {
    return (
      <>
        <div style={{ padding: "calc(10px + var(--safe-top)) 18px 0" }}><span className="hand">your characters, your world</span><h2 className="screen-title" style={{ marginTop: 0 }}>OC workshop</h2></div>
        {tabs}
        <Chat me={me} mode="oc" onTurn={(t) => { onTurn(t); if (t.effects.characters.length) void load(); }} onMood={onMood} openHelp={openHelp} go={go} />
      </>
    );
  }

  return (
    <div className="screen narrow" style={{ paddingTop: 0 }}>
      <div style={{ paddingTop: "calc(10px + var(--safe-top))" }}><span className="hand">your characters, your world</span><h2 className="screen-title" style={{ marginTop: 0 }}>OC workshop</h2></div>
      <div style={{ margin: "0 -18px" }}>{tabs}</div>

      {tab === "characters" && (
        <>
          {editing ? (
            <SheetEditor initial={editing === "new" ? null : editing} onSave={() => { setEditing(null); void load(); }} onCancel={() => setEditing(null)} />
          ) : (
            <div className="row"><button className="btn primary small" onClick={() => setEditing("new")}>+ New character</button><button className="btn ghost small" onClick={() => setTab("workshop")}>Build one with {name}</button></div>
          )}
          {chars.length === 0 && !editing && <span className="small">No characters yet. Start one yourself, or let {name} ask you good questions.</span>}
          {chars.map((c) => (
            <div key={c.id} className="card">
              <div className="spread">
                <b style={{ fontFamily: "var(--serif)", fontSize: 19 }}>{c.sheet.icon} {c.sheet.name}</b>
                <span className="row" style={{ gap: 4 }}>{c.sheet.palette.map((p) => <span key={p} style={{ width: 16, height: 16, borderRadius: 5, background: p, display: "inline-block" }} />)}</span>
              </div>
              {c.sheet.personality && <span style={{ fontSize: 14, color: "var(--text-3)" }}>{c.sheet.personality}</span>}
              {c.sheet.powers && <span style={{ fontSize: 13.5 }}><b>Powers:</b> {c.sheet.powers}</span>}
              {c.sheet.relationships.length > 0 && <span style={{ fontSize: 13.5 }}>{c.sheet.relationships.map((r) => `${r.kind} of ${r.with}`).join(" · ")}</span>}
              <div className="row" style={{ flexWrap: "wrap" }}>
                <button className="btn ghost small" onClick={() => setEditing(c)}>Edit</button>
                <button className="btn ghost small" onClick={() => setMaking([c.id])}>Make something with {c.sheet.name}</button>
                <button className="btn ghost small" onClick={async () => { if (confirm(`Delete ${c.sheet.name}?`)) { await api(`/api/oc/characters/${c.id}`, { method: "DELETE" }); void load(); } }}>Delete</button>
              </div>
            </div>
          ))}
          <b>Gallery</b>
          {gallery.length === 0 && <span className="small">Sketches, palettes, comics and stories starring your OCs will show up here (and on {name}’s desk).</span>}
          <div className="grid2">
            {gallery.map((it) => <button key={it.id} className="made" onClick={() => setOpen(it.id)}><span className="ic">{it.icon}</span><b>{it.title}</b><span>{it.summary}</span></button>)}
          </div>
          <span className="small">Friendships, rivalries and adventures: yes. Romance: not here. Uploading your own drawings isn’t switched on yet; it needs an extra safety check first.</span>
        </>
      )}

      {tab === "world" && (
        <>
          <div className="card" style={{ gap: 8 }}>
            <div className="chips">{["place", "event", "group"].map((k) => <button key={k} className={`chip ${place.kind === k ? "on" : ""}`} onClick={() => setPlace({ ...place, kind: k })}>{k}</button>)}</div>
            <input className="input" placeholder="Name" value={place.name} onChange={(e) => setPlace({ ...place, name: e.target.value })} maxLength={60} />
            {place.kind === "event" && <input className="input" placeholder="When (e.g. Year 3 of the Ember Age)" value={place.when} onChange={(e) => setPlace({ ...place, when: e.target.value })} maxLength={40} />}
            <textarea className="textarea" placeholder="What’s it like?" value={place.note} onChange={(e) => setPlace({ ...place, note: e.target.value })} maxLength={400} />
            <button className="btn primary small" onClick={addWorld} disabled={!place.name.trim()}>Add</button>
          </div>
          {world.map((w) => (
            <div key={w.id} className="memrow">
              <span>{w.kind === "place" ? "📍" : w.kind === "event" ? "📜" : "🛡️"}</span>
              <span className="t"><b>{w.name}</b>{w.when ? ` · ${w.when}` : ""}{w.note ? ` · ${w.note}` : ""}</span>
              <button className="x" aria-label={`Remove ${w.name}`} onClick={async () => { await api(`/api/oc/world/${w.id}`, { method: "DELETE" }); void load(); }}>✕</button>
            </div>
          ))}
          {world.length > 0 && (
            <div className="row"><button className="btn ghost small" onClick={() => setMaking(chars.map((c) => c.id).slice(0, 6))}>Make a map or timeline</button></div>
          )}
        </>
      )}
      {making && <MakeSheet me={me} characterIds={making} onClose={() => setMaking(null)} onStarted={reload} />}
      {open && <ItemViewer id={open} canEdit onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}
