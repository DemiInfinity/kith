import { IL } from "../components/Icons";
import { useCallback, useEffect, useState } from "react";
import { api, type Me } from "../api";
import { pickGoogleDoc, type GoogleStatus } from "./Google";

interface Story { id: number; ts: number; title: string; friendLabel: string; voice: "light" | "medium"; bible: string }
interface Passage { id: number; author: "child" | "friend" | "pip"; text: string; status: "accepted" | "suggested" | "rejected"; kind: "passage" | "edit"; replaces: number | null }

function StoryView({ me, id, onBack }: { me: Me; id: number; onBack: () => void }) {
  const [s, setS] = useState<Story | null>(null);
  const [ps, setPs] = useState<Passage[]>([]);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState<"child" | "friend">("child");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const load = useCallback(() => api<{ story: Story; passages: Passage[] }>(`/api/stories/${id}`).then((r) => { setS(r.story); setPs(r.passages); }), [id]);
  useEffect(() => { void load(); api<GoogleStatus>("/api/google").then(setGoogle).catch(() => undefined); }, [load]);
  const name = me.profile.name;
  if (!s) return <div className="screen narrow"><span className="small">…</span></div>;
  const who = (a: Passage["author"]) => (a === "child" ? me.name || "Me" : a === "friend" ? s.friendLabel : name);

  const add = async () => {
    try { await api(`/api/stories/${id}/passages`, { body: { author, text } }); setText(""); setMsg(""); void load(); } catch (e) { setMsg((e as Error).message); }
  };
  const suggest = async (kind: "continue" | "idea" | "edit", passageId?: number) => {
    setBusy(kind);
    try { await api(`/api/stories/${id}/suggest`, { body: { kind, passageId } }); void load(); } catch (e) { setMsg((e as Error).message); }
    setBusy("");
  };
  const decide = async (pid: number, accept: boolean) => { await api(`/api/stories/${id}/passages/${pid}/decide`, { body: { accept } }); void load(); };
  const fromGoogle = async () => {
    try {
      const picked = await pickGoogleDoc();
      if (!picked) return;
      await api(`/api/stories/${id}/passages`, { body: { author: "friend", text: picked.text } });
      setMsg(`Added ${s.friendLabel}’s part from “${picked.name}”.`);
      void load();
    } catch (e) { setMsg((e as Error).message); }
  };
  const exportDoc = async () => {
    try { const r = await api<{ url: string }>(`/api/stories/${id}/google`, { body: {} }); window.open(r.url, "_blank", "noopener"); setMsg("Saved to Kith/Stories in your Drive. Share it with your friend from Google Drive if you want to."); }
    catch (e) { setMsg((e as Error).message); }
  };
  const bible = async () => { setBusy("bible"); try { const r = await api<Story>(`/api/stories/${id}/bible`, { body: {} }); setS(r); } catch (e) { setMsg((e as Error).message); } setBusy(""); };
  const setVoice = async (voice: Story["voice"]) => setS(await api<Story>(`/api/stories/${id}`, { method: "PUT", body: { voice } }));

  const shown = ps.filter((p) => p.status !== "rejected");
  return (
    <div className="screen narrow">
      <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={onBack}>← All stories</button>
      <h2 className="screen-title">{s.title}</h2>
      <span className="small">with {s.friendLabel} · every part is credited · only what you accept goes in</span>
      <div className="row"><span className="small">Edits from {name}:</span>
        <div className="chips">{(["light", "medium"] as const).map((v) => <button key={v} className={`chip ${s.voice === v ? "on" : ""}`} onClick={() => setVoice(v)}>{v === "light" ? "Very light (your voice)" : "A bit smoother"}</button>)}</div>
      </div>
      {shown.map((p) => (
        <div key={p.id} className="card" style={p.status === "suggested" ? { borderStyle: "dashed", borderColor: "var(--lilac)" } : {}}>
          <span className="spread"><span className="eyebrow">{p.status === "suggested" ? `${name} suggests${p.kind === "edit" ? " an edit" : ""}` : who(p.author)}</span>
            {p.status === "accepted" && <button className="btn ghost small" disabled={!!busy} onClick={() => suggest("edit", p.id)}>Suggest light edit</button>}</span>
          <span style={{ fontSize: 15, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{p.text}</span>
          {p.status === "suggested" && <div className="row"><button className="btn primary small" onClick={() => decide(p.id, true)}>Use it</button><button className="btn ghost small" onClick={() => decide(p.id, false)}>No thanks</button></div>}
        </div>
      ))}
      <div className="card">
        <div className="chips">
          <button className={`chip ${author === "child" ? "on" : ""}`} onClick={() => setAuthor("child")}>My part</button>
          <button className={`chip ${author === "friend" ? "on" : ""}`} onClick={() => setAuthor("friend")}>{s.friendLabel}’s part (paste)</button>
        </div>
        <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder={author === "child" ? "Write the next bit…" : `Paste ${s.friendLabel}’s part here`} />
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className="btn primary small" disabled={!text.trim()} onClick={add}>Add</button>
          {google?.picker && google.connected && <button className="btn ghost small" onClick={fromGoogle}>From a Google Doc…</button>}
        </div>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn ghost small" disabled={!!busy} onClick={() => suggest("idea")}>{busy === "idea" ? "Thinking…" : <IL i="bulb">Ideas for what’s next</IL>}</button>
        <button className="btn ghost small" disabled={!!busy} onClick={() => suggest("continue")}>{busy === "continue" ? "Writing…" : <IL i="pencil">Suggest a next bit</IL>}</button>
        <button className="btn ghost small" disabled={!!busy} onClick={bible}>{busy === "bible" ? "Updating…" : <IL i="stories">Update story bible</IL>}</button>
        {google?.connected && google.enabled && <button className="btn ghost small" onClick={exportDoc}>Save to Google Docs</button>}
      </div>
      {s.bible && <div className="card"><b>Story bible</b><span style={{ fontSize: 14, whiteSpace: "pre-wrap", color: "var(--text-3)" }}>{s.bible}</span></div>}
      {msg && <div className="notice" style={{ alignSelf: "stretch" }}>{msg}</div>}
      <span className="small">{name} never contacts {s.friendLabel}, doesn’t keep anything about them, and only uses their writing for this story. Sharing the story is up to you.</span>
    </div>
  );
}

/** Stories written with a friend. */
export function Stories({ me }: { me: Me }) {
  const [list, setList] = useState<Story[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [friend, setFriend] = useState("");
  const load = () => api<{ stories: Story[] }>("/api/stories").then((r) => setList(r.stories)).catch(() => undefined);
  useEffect(() => { void load(); }, [open]);
  if (open) return <StoryView me={me} id={open} onBack={() => setOpen(null)} />;
  return (
    <div className="screen narrow dgrid">
      <span className="hand">two writers, one story</span>
      <h2 className="screen-title">Stories with a friend</h2>
      <div className="card">
        <b>Start a story</b>
        <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        <input className="input" placeholder="What do you call your co-writer? (first name or nickname)" value={friend} onChange={(e) => setFriend(e.target.value)} maxLength={30} />
        <button className="btn primary small" disabled={!title.trim()} onClick={async () => { const s = await api<Story>("/api/stories", { body: { title, friendLabel: friend.trim() || "my friend" } }); setTitle(""); setFriend(""); setOpen(s.id); }}>Start</button>
      </div>
      {list.map((s) => (
        <button key={s.id} className="card" style={{ textAlign: "left" }} onClick={() => setOpen(s.id)}>
          <b style={{ fontFamily: "var(--serif)", fontSize: 18 }}>{s.title}</b><span className="small">with {s.friendLabel}</span>
        </button>
      ))}
    </div>
  );
}
