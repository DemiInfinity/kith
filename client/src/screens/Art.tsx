import { Icon } from "../components/Icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Me, type Mood, type Turn } from "../api";
import { Toggle } from "../components/bits";
import { action } from "../lib/action";

interface Sketch { id: number; ts: number; title: string; medium: string; minutes: number; notes: string; forCoursework: boolean; tags: string[] }
interface MoodItem { id: number; kind: "colour" | "word" | "reference" | "note"; value: string; note: string }
interface ArtView { challenge: string; sketchbook: Sketch[]; mood: MoodItem[]; uploads: { enabled: boolean; reason: string } }

/** The art companion: challenges, a sketchbook log, a mood board, and feedback on work they describe. */
export function Art({ me, onTurn, onMood, openHelp, go }: { me: Me; onTurn: (t: Turn) => void; onMood: (m: Mood) => void; openHelp: () => void; go: (to: string) => void }) {
  const [v, setV] = useState<ArtView | null>(null);
  const [tab, setTab] = useState<"today" | "sketchbook" | "mood" | "talk">("today");
  const [entry, setEntry] = useState({ title: "", medium: "", minutes: 20, notes: "", forCoursework: false });
  const [item, setItem] = useState<{ kind: MoodItem["kind"]; value: string }>({ kind: "colour", value: "#D9A3E0" });
  const [coursework, setCoursework] = useState(false);
  const load = useCallback(() => api<ArtView>("/api/art").then(setV).catch(() => undefined), []);
  // Removing a sketchbook entry waits a few seconds, with Undo, before it's really deleted.
  const [removing, setRemoving] = useState<{ id: number; title: string } | null>(null);
  const pending = useRef<{ id: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const reallyRemove = useCallback((id: number) => {
    pending.current = null;
    setRemoving((r) => (r?.id === id ? null : r));
    action(async () => { await api(`/api/art/sketchbook/${id}`, { method: "DELETE" }); void load(); }, "remove it")();
  }, [load]);
  const remove = (s: { id: number; title: string }) => {
    if (pending.current) { clearTimeout(pending.current.timer); reallyRemove(pending.current.id); }
    setRemoving({ id: s.id, title: s.title });
    pending.current = { id: s.id, timer: setTimeout(() => reallyRemove(s.id), 6000) };
  };
  const undoRemove = () => { if (pending.current) clearTimeout(pending.current.timer); pending.current = null; setRemoving(null); };
  // Leaving the screen finishes a removal that's waiting.
  useEffect(() => () => { const p = pending.current; if (p) { clearTimeout(p.timer); void api(`/api/art/sketchbook/${p.id}`, { method: "DELETE" }).catch(() => undefined); } }, []);
  useEffect(() => { void load(); }, [load]);
  const name = me.profile.name;

  const tabs = (
    <div className="chips" role="tablist">
      {([["today", "Today"], ["sketchbook", "Sketchbook"], ["mood", "Mood board"], ["talk", `Talk art with ${name}`]] as const).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={tab === k} className={`chip ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>
      ))}
    </div>
  );
  const head = <div><span className="hand">make something today</span><h2 className="screen-title" style={{ marginTop: 0 }}>Art</h2></div>;

  const askInChat = () => go(`/?mode=art${coursework ? "&coursework=1" : ""}&label=${encodeURIComponent(`Art${coursework ? " · coursework" : ""}`)}`);

  return (
    <div className="screen narrow dgrid">
      {head}{tabs}
      {tab === "talk" && (
        <div className="card full" style={{ gap: 10, maxWidth: 640 }}>
          <b>Talk art with {name}</b>
          <span className="small">Opens your chat with {name}, set up for art: prompts, techniques, artists, and feedback on what you describe.</span>
          <Toggle label="This is for my art coursework (portfolio or set task)" checked={coursework} onChange={setCoursework} />
          {coursework && <span className="small" style={{ color: "var(--ember)" }}>Coursework: {name} gives feedback and asks questions, but won’t design or draw anything for it.</span>}
          <button className="btn primary" onClick={askInChat}>Talk to {name} →</button>
        </div>
      )}
      {v && tab === "today" && (
        <>
          <div className="card glow"><span className="eyebrow">Today’s challenge</span><span style={{ fontSize: "1.0625rem", lineHeight: 1.45 }}>{v.challenge}</span></div>
          <div className="card">
            <b>Show {name} your work</b>
            <button className="btn ghost small" disabled title={v.uploads.reason}><Icon name="camera" size={16} /> Add a photo (coming later)</button>
            <span className="small">{v.uploads.reason}</span>
            <button className="btn primary small" onClick={() => go(`/?mode=art&label=${encodeURIComponent("Art")}`)}>Describe it to {name}</button>
          </div>
          <button className="card" style={{ flexDirection: "row", alignItems: "center", gap: 12, textAlign: "left" }} onClick={() => go("/oc")}>
            <span style={{ display: "inline-flex", color: "var(--lilac)" }}><Icon name="oc" size={26} /></span><span><b>OC workshop</b><br /><span className="small">Your characters, their world and the gallery</span></span>
          </button>
        </>
      )}
      {v && tab === "sketchbook" && (
        <>
          <div className="card">
            <b>Log a piece</b>
            <input className="input" placeholder="What did you make?" value={entry.title} onChange={(e) => setEntry({ ...entry, title: e.target.value })} maxLength={80} />
            <div className="grid2">
              <input className="input" placeholder="Medium (pencil, gouache…)" value={entry.medium} onChange={(e) => setEntry({ ...entry, medium: e.target.value })} maxLength={60} />
              <input className="input" type="number" min={0} aria-label="Minutes" value={entry.minutes} onChange={(e) => setEntry({ ...entry, minutes: Number(e.target.value) })} />
            </div>
            <textarea className="textarea" placeholder="Notes: what went well, what you'd try next" value={entry.notes} onChange={(e) => setEntry({ ...entry, notes: e.target.value })} maxLength={1000} />
            <Toggle label="For coursework" checked={entry.forCoursework} onChange={(x) => setEntry({ ...entry, forCoursework: x })} />
            <button className="btn primary small" disabled={!entry.title.trim()} onClick={action(async () => { await api("/api/art/sketchbook", { body: entry }); setEntry({ title: "", medium: "", minutes: 20, notes: "", forCoursework: false }); void load(); }, "add it")}>Add to sketchbook</button>
          </div>
          {removing && <div className="notice" role="status" style={{ display: "flex", gap: 10, alignItems: "center" }}><span>Removed “{removing.title}”.</span><button className="btn ghost small" onClick={undoRemove}>Undo</button></div>}
          {v.sketchbook.filter((s) => s.id !== removing?.id).map((s) => (
            <div key={s.id} className="card">
              <span className="spread"><b>{s.title}</b><span className="small">{new Date(s.ts).toLocaleDateString("en-GB")}</span></span>
              <span className="small">{[s.medium, s.minutes ? `${s.minutes} min` : "", s.forCoursework ? "coursework" : ""].filter(Boolean).join(" · ")}</span>
              {s.notes && <span style={{ fontSize: "0.875rem" }}>{s.notes}</span>}
              <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => remove(s)}>Remove</button>
            </div>
          ))}
        </>
      )}
      {v && tab === "mood" && (
        <>
          <div className="card">
            <div className="chips">{(["colour", "word", "reference", "note"] as const).map((k) => <button key={k} className={`chip ${item.kind === k ? "on" : ""}`} onClick={() => setItem({ kind: k, value: k === "colour" ? "#D9A3E0" : "" })}>{k}</button>)}</div>
            {item.kind === "colour"
              ? <input type="color" aria-label="Colour" value={item.value} onChange={(e) => setItem({ ...item, value: e.target.value.toUpperCase() })} style={{ width: 64, height: 48, border: 0, background: "none" }} />
              : <input className="input" placeholder={item.kind === "reference" ? "An artist, movement or piece (e.g. Hokusai, Art Nouveau)" : item.kind === "word" ? "A mood word (e.g. misty)" : "A note"} value={item.value} onChange={(e) => setItem({ ...item, value: e.target.value })} maxLength={200} />}
            <button className="btn primary small" disabled={!item.value.trim()} onClick={action(async () => { await api("/api/art/mood", { body: item }); void load(); }, "pin it")}>Pin it</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {v.mood.map((m) => (
              <button key={m.id} className="card" style={{ padding: 10, minWidth: 90, alignItems: "center", background: m.kind === "colour" ? m.value : undefined, color: m.kind === "colour" ? "#2A1D3A" : undefined }}
                title="Tap to remove" onClick={action(async () => { if (confirm("Unpin this?")) { await api(`/api/art/mood/${m.id}`, { method: "DELETE" }); void load(); } }, "unpin it")}>
                <span style={{ fontWeight: 800, fontSize: "0.875rem" }}>{m.kind === "reference" ? <Icon name="landmark" size={14} style={{ verticalAlign: -2, marginRight: 4 }} /> : m.kind === "word" ? "“" : ""}{m.value}{m.kind === "word" ? "”" : ""}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
