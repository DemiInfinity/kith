import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Toggle } from "../components/bits";
import { Icon, IL } from "../components/Icons";

interface Skill { id: number; name: string; description: string; command: string | null; body: string; enabled: number }
interface Draft { name: string; description: string; command: string; body: string; enabled: boolean }
const BLANK: Draft = { name: "", description: "", command: "", body: "", enabled: true };

function Editor({ initial, onSave, onCancel }: { initial: Draft; onSave: (d: Draft) => Promise<void>; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const [err, setErr] = useState("");
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  return (
    <div className="card psec pskill-edit">
      <div className="grid2">
        <label className="field">Name<input className="input" value={d.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Maths, step by step" /></label>
        <label className="field">Command (optional)
          <span className="pcmd-input"><span>/</span><input className="input" value={d.command} maxLength={20} onChange={(e) => set({ command: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} placeholder="maths" /></span>
        </label>
      </div>
      <label className="field">When to use it<input className="input" value={d.description} maxLength={300} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. When they're stuck on maths homework." /></label>
      <label className="field">How to do it
        <textarea className="textarea" style={{ minHeight: 180, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13.5 }} maxLength={8000} value={d.body} onChange={(e) => set({ body: e.target.value })}
          placeholder={"Write it like you'd explain it to a tutor. Steps, tone, things to avoid.\n\n1. Ask what they've tried.\n2. One hint at a time…"} /></label>
      <Toggle label="Switched on" checked={d.enabled} onChange={(v) => set({ enabled: v })} />
      {err && <span className="small" style={{ color: "var(--ember)" }}>{err}</span>}
      <div className="row"><button className="btn primary small" onClick={async () => { try { setErr(""); await onSave(d); } catch (e) { setErr((e as Error).message); } }}>Save skill</button><button className="btn ghost small" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

/** Skills: how-tos the parent writes. The companion sees each one's name and when to use it, and loads the rest only when it's needed. */
export function ParentSkills({ companion, childName }: { companion: string; childName: string }) {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [examples, setExamples] = useState<(Omit<Draft, "command"> & { command: string | null })[]>([]);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const load = useCallback(() => api<{ skills: Skill[]; examples: typeof examples }>("/api/parent/skills").then((r) => { setSkills(r.skills); setExamples(r.examples); }).catch(() => setSkills([])), []);
  useEffect(() => { void load(); }, [load]);
  const save = async (d: Draft, id?: number) => {
    const body = { ...d, command: d.command || null };
    await api(id ? `/api/parent/skills/${id}` : "/api/parent/skills", { method: id ? "PUT" : "POST", body });
    setEditing(null);
    await load();
  };
  const toggle = async (k: Skill, on: boolean) => { await save({ name: k.name, description: k.description, command: k.command ?? "", body: k.body, enabled: on }, k.id); };
  const remove = async (k: Skill) => { if (!confirm(`Delete “${k.name}”?`)) return; await api(`/api/parent/skills/${k.id}`, { method: "DELETE" }); await load(); };
  const unusedExamples = examples.filter((e) => !(skills ?? []).some((k) => k.name === e.name));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="pintro">
        <span className="small">Skills are how-tos you write for {companion}: how to help with maths the way {childName}’s teacher does, how to run a quiz, your rules for game nights. {companion} sees each skill’s name and when to use it, and only reads the rest when it’s needed, so skills cost almost nothing until they’re used. Give one a <b>/command</b> and {childName} can type it in chat to use it straight away. Your safeguards always come first, whatever a skill says.</span>
        <span className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button className="btn primary small" onClick={() => { setDraft(BLANK); setEditing("new"); }}><IL i="plus">New skill</IL></button>
          {unusedExamples.length > 0 && <span className="small" style={{ fontWeight: 800 }}>or start from:</span>}
          {unusedExamples.map((e) => (
            <button key={e.name} className="btn ghost small" onClick={() => { setDraft({ ...e, command: e.command ?? "" }); setEditing("new"); }}><IL i="bulb">{e.name}</IL></button>
          ))}
        </span>
      </div>
      {editing === "new" && <Editor initial={draft} onSave={(d) => save(d)} onCancel={() => setEditing(null)} />}
      {skills?.length === 0 && editing !== "new" && <div className="pempty-state"><Icon name="bulb" size={22} /><span>No skills yet. Start from an example above, or write your own.</span></div>}
      <div className="pconns">
        {skills?.map((k) => editing === k.id ? (
          <Editor key={k.id} initial={{ name: k.name, description: k.description, command: k.command ?? "", body: k.body, enabled: !!k.enabled }} onSave={(d) => save(d, k.id)} onCancel={() => setEditing(null)} />
        ) : (
          <div key={k.id} className={`card pconn ${k.enabled ? "on" : ""}`}>
            <div className="pconn-head">
              <span className="psec-ic"><Icon name="bulb" size={18} /></span>
              <b style={{ flex: 1, fontFamily: "var(--serif)", fontSize: 18 }}>{k.name}</b>
              <Toggle label="" checked={!!k.enabled} onChange={(v) => void toggle(k, v)} />
            </div>
            {k.command && <span className="pcmd">/{k.command}</span>}
            <span className="small">{k.description}</span>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost small" onClick={() => setEditing(k.id)}><IL i="pencil">Edit</IL></button>
              <button className="btn ghost small" onClick={() => remove(k)}><IL i="trash">Delete</IL></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
