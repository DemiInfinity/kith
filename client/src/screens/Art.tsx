import { useCallback, useEffect, useState } from "react";
import { api, type Me, type Mood, type Turn } from "../api";
import { Toggle } from "../components/bits";
import { Chat } from "./Chat";

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
  useEffect(() => { void load(); }, [load]);
  const name = me.profile.name;

  const tabs = (
    <div className="chips" role="tablist" style={{ padding: tab === "talk" ? "10px 18px 0" : 0 }}>
      {([["today", "✨ Today"], ["sketchbook", "📓 Sketchbook"], ["mood", "🎨 Mood board"], ["talk", `💬 Talk art with ${name}`]] as const).map(([k, l]) => (
        <button key={k} role="tab" aria-selected={tab === k} className={`chip ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>
      ))}
    </div>
  );
  const head = <div style={tab === "talk" ? { padding: "calc(10px + var(--safe-top)) 18px 0" } : {}}><span className="hand">make something today</span><h2 className="screen-title" style={{ marginTop: 0 }}>Art</h2></div>;

  if (tab === "talk") {
    return (
      <>
        {head}{tabs}
        <div style={{ padding: "8px 18px 0" }}><Toggle label="This is for my art coursework (portfolio or set task)" checked={coursework} onChange={setCoursework} /></div>
        {coursework && <div className="notice" style={{ margin: "8px 18px 0" }}>Coursework: I’ll give feedback and ask questions, but I won’t design or draw anything for it. Every idea in it has to be yours. This chat is noted in your help log.</div>}
        <Chat me={me} mode="art" ctx={{ coursework }} onTurn={onTurn} onMood={onMood} openHelp={openHelp} go={go}
          placeholder="Describe what you’re working on…"
          quick={[["💡", "Give me a drawing prompt"], ["🖌️", "How do I shade skin tones?"], ["🏛️", "Who should I look at for bold colour?"], ["🗣️", "Here's what I drew today…"]]} />
      </>
    );
  }

  return (
    <div className="screen narrow">
      {head}{tabs}
      {v && tab === "today" && (
        <>
          <div className="card glow"><span className="eyebrow">Today’s challenge</span><span style={{ fontSize: 17, lineHeight: 1.45 }}>{v.challenge}</span></div>
          <div className="card">
            <b>Show {name} your work</b>
            <button className="btn ghost small" disabled title={v.uploads.reason}>📷 Add a photo (coming later)</button>
            <span className="small">{v.uploads.reason}</span>
            <button className="btn primary small" onClick={() => setTab("talk")}>Describe it to {name}</button>
          </div>
          <button className="card" style={{ flexDirection: "row", alignItems: "center", gap: 12, textAlign: "left" }} onClick={() => go("/oc")}>
            <span style={{ fontSize: 24 }}>⭐</span><span><b>OC workshop</b><br /><span className="small">Your characters, their world and the gallery</span></span>
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
            <button className="btn primary small" disabled={!entry.title.trim()} onClick={async () => { await api("/api/art/sketchbook", { body: entry }); setEntry({ title: "", medium: "", minutes: 20, notes: "", forCoursework: false }); void load(); }}>Add to sketchbook</button>
          </div>
          {v.sketchbook.map((s) => (
            <div key={s.id} className="card">
              <span className="spread"><b>{s.title}</b><span className="small">{new Date(s.ts).toLocaleDateString("en-GB")}</span></span>
              <span className="small">{[s.medium, s.minutes ? `${s.minutes} min` : "", s.forCoursework ? "coursework" : ""].filter(Boolean).join(" · ")}</span>
              {s.notes && <span style={{ fontSize: 14 }}>{s.notes}</span>}
              <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={async () => { await api(`/api/art/sketchbook/${s.id}`, { method: "DELETE" }); void load(); }}>Remove</button>
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
            <button className="btn primary small" disabled={!item.value.trim()} onClick={async () => { await api("/api/art/mood", { body: item }); void load(); }}>Pin it</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {v.mood.map((m) => (
              <button key={m.id} className="card" style={{ padding: 10, minWidth: 90, alignItems: "center", background: m.kind === "colour" ? m.value : undefined, color: m.kind === "colour" ? "#2A1D3A" : undefined }}
                title="Tap to remove" onClick={async () => { if (confirm("Unpin this?")) { await api(`/api/art/mood/${m.id}`, { method: "DELETE" }); void load(); } }}>
                <span style={{ fontWeight: 800, fontSize: 14 }}>{m.kind === "reference" ? "🏛️ " : m.kind === "word" ? "“" : ""}{m.value}{m.kind === "word" ? "”" : ""}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
