import { useEffect, useState } from "react";
import { api, type Me } from "../api";
import { Markdown } from "../components/bits";
import { Icon } from "../components/Icons";

export interface ThreadRow { id: number; title: string; from_text: string | null; messages: number; last: string | null; updated: number; lang?: string | null }
/** A language she can chat in (approved by her grown-up and switched on). */
export interface ChatLang { code: string; name: string; native: string; badge: string; voice: string }
interface HistoryFile { file: string; thread: number; from: string; title: string }

/** The slide-out for switching between the main chat and side chats, and reading archived chats. */
export function SideChats({ me, open, current, onClose, onPick, docked = false }: { me: Me; open: boolean; current: number; onClose: () => void; onPick: (id: number) => void; docked?: boolean }) {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [history, setHistory] = useState<HistoryFile[]>([]);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [reading, setReading] = useState<{ title: string; md: string } | null>(null);
  const [langs, setLangs] = useState<ChatLang[]>([]);
  const load = () => {
    api<{ threads: ThreadRow[]; languages?: ChatLang[] }>("/api/threads").then((r) => { setThreads(r.threads); setLangs(r.languages ?? []); }).catch(() => undefined);
    api<{ files: HistoryFile[] }>("/api/history").then((r) => setHistory(r.files)).catch(() => undefined);
  };
  useEffect(() => { if (open) load(); }, [open, current]);
  useEffect(() => {
    if (!open || docked) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open, onClose]);

  const newChat = async (lang?: ChatLang) => {
    const t = await api<{ id: number }>("/api/threads", { body: lang ? { lang: lang.code, title: lang.native } : {} });
    onPick(t.id);
  };
  const rename = async (id: number) => {
    await api(`/api/threads/${id}`, { method: "PATCH", body: { title } });
    setRenaming(null);
    load();
  };
  const archive = async (id: number) => {
    await api(`/api/threads/${id}`, { method: "PATCH", body: { archived: true } });
    if (current === id) onPick(1);
    load();
  };
  const read = async (f: HistoryFile) => {
    const r = await api<{ md: string }>(`/api/history/file?f=${encodeURIComponent(f.file)}`);
    setReading({ title: f.title, md: r.md });
  };

  return (
    <>
      {!docked && <div className={`drawer-scrim ${open ? "open" : ""}`} onClick={onClose} />}
      <aside className={docked ? "chatsdock" : `drawer ${open ? "open" : ""}`} aria-hidden={!open} aria-label="Chats">
        <div className="spread" style={{ alignItems: "center" }}>
          <b style={{ fontFamily: "var(--serif)", fontSize: 22 }}>Chats</b>
          <button className="x" aria-label={docked ? "Close side chats" : "Close"} onClick={onClose}><Icon name="close" /></button>
        </div>
        <button className="btn primary small" onClick={() => newChat()}><Icon name="newchat" size={18} /> New side chat</button>
        {langs.length > 0 && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {langs.map((l) => <button key={l.code} className="chip" style={{ flex: "1 1 40%" }} onClick={() => newChat(l)}><span className="langdot">{l.badge}</span> In {l.native}</button>)}
          </div>
        )}
        <span className="small">Split off to talk about something else without losing your place. Tip: tap any message and choose “Side chat from here”.</span>
        <div className="stack" style={{ gap: 6 }}>
          {threads.map((t) => (
            <div key={t.id} className={`threadrow ${t.id === current ? "on" : ""}`}>
              {renaming === t.id ? (
                <form className="row" style={{ flex: 1 }} onSubmit={(e) => { e.preventDefault(); void rename(t.id); }}>
                  <input className="input" style={{ minHeight: 38 }} value={title} maxLength={60} autoFocus onChange={(e) => setTitle(e.target.value)} />
                  <button className="btn primary small" type="submit">Save</button>
                </form>
              ) : (
                <>
                  <button className="threadpick" onClick={() => onPick(t.id)}>
                    {t.lang && langs.find((l) => l.code === t.lang) ? <span className="langdot" aria-label={`In ${langs.find((l) => l.code === t.lang)!.name}`}>{langs.find((l) => l.code === t.lang)!.badge}</span> : <Icon name={t.id === 1 ? "chat" : "sidechats"} on={t.id === current} size={20} />}
                    <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                      <b style={{ display: "block", fontSize: 14 }}>{t.id === 1 ? `Main chat with ${me.profile.name}` : t.title}</b>
                      <span className="small" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.last ?? (t.from_text ? `from: ${t.from_text}` : "nothing yet")}</span>
                    </span>
                  </button>
                  {t.id !== 1 && (
                    <>
                      <button className="x" aria-label={`Rename ${t.title}`} onClick={() => { setRenaming(t.id); setTitle(t.title); }}><Icon name="pencil" size={15} /></button>
                      <button className="x" aria-label={`Put away ${t.title}`} onClick={() => archive(t.id)}><Icon name="archive" size={18} /></button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        {history.length > 0 && (
          <>
            <b style={{ marginTop: 8 }}>Older chats</b>
            <span className="small">When a chat gets long, {me.profile.name} keeps a short summary and files the rest here. {me.profile.name} only looks back at these when you ask it to remember something. Only you can read them, and they’re deleted after 30 days like chats.</span>
            {history.slice(0, 30).map((h) => (
              <button key={h.file} className="threadpick" onClick={() => read(h)}>
                <span className="hic"><Icon name="folder" size={18} /></span><span style={{ flex: 1, textAlign: "left", fontSize: 13.5 }}>{h.title}</span>
              </button>
            ))}
          </>
        )}
      </aside>
      {reading && (
        <>
          <div className="scrim" onClick={() => setReading(null)} />
          <div className="dialog" role="dialog" aria-modal="true" aria-label={reading.title}>
            <div className="bar-top"><b style={{ flex: 1, fontFamily: "var(--serif)" }}>{reading.title}</b><button className="x" aria-label="Close" onClick={() => setReading(null)}><Icon name="close" /></button></div>
            <div className="body"><Markdown text={reading.md.split("\n").slice(1).join("\n")} /></div>
          </div>
        </>
      )}
    </>
  );
}
