import { useCallback, useEffect, useState } from "react";
import { api, type Character, type CloudLink, type DeskItem, type DeskView, type Energy, type Me } from "../api";
import { EnergyCard, Markdown } from "../components/bits";

const KIND_LABEL: Record<string, string> = {
  story: "📖 Story", adventure: "🧭 Choose-your-own adventure", comic: "💬 Comic", slides: "🖼️ Slides", flashcards: "🗂️ Flashcards",
  quiz: "✅ Quiz that marks itself", timer: "⏱️ Revision timer", game: "🎮 Mini game", poster: "🪧 Poster", card: "💌 Card",
  sketch: "✏️ Sketch", palette: "🎨 Palette", map: "🗺️ Map", timeline: "📜 Timeline", playlist: "🎵 Playlist idea", notes: "📝 Notes",
};

export function useDesk(poll = 8000) {
  const [desk, setDesk] = useState<DeskView | null>(null);
  const load = useCallback(() => api<DeskView>("/api/desk").then(setDesk).catch(() => undefined), []);
  useEffect(() => {
    void load();
    const t = setInterval(load, poll);
    return () => clearInterval(t);
  }, [load, poll]);
  return { desk, reload: load };
}

function subtitle(it: DeskItem) {
  return it.summary || KIND_LABEL[it.kind]?.split(" ").slice(1).join(" ").toLowerCase() || it.kind;
}

/** A desk item, opened. Interactive things run in a locked sandbox: no network, no storage, no access to the app. */
export function ItemViewer({ id, canEdit, onClose, onChanged, links = [] }: { id: string; canEdit: boolean; onClose: () => void; onChanged: () => void; links?: CloudLink[] }) {
  const [item, setItem] = useState<{ meta: DeskItem; content: string; versions: number[] } | null>(null);
  const [v, setV] = useState<number | undefined>();
  const [change, setChange] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api<{ meta: DeskItem; content: string; versions: number[] }>(`/api/desk/items/${encodeURIComponent(id)}${v ? `?v=${v}` : ""}`).then(setItem).catch((e) => setMsg((e as Error).message));
  }, [id, v]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);

  const fav = async () => {
    if (!item) return;
    const m = await api<DeskItem>(`/api/desk/items/${encodeURIComponent(id)}/favourite`, { method: "PUT", body: { favourite: !item.meta.favourite } });
    setItem({ ...item, meta: m });
    onChanged();
  };
  const ask = async () => {
    if (!change.trim()) return;
    try {
      await api(`/api/desk/items/${encodeURIComponent(id)}/change`, { body: { change } });
      setMsg("On it! The new version will appear here when it’s ready.");
      setChange("");
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const remove = async () => {
    if (!confirm("Move this to the desk’s bin?")) return;
    await api(`/api/desk/items/${encodeURIComponent(id)}`, { method: "DELETE" });
    onChanged();
    onClose();
  };

  const toGoogle = async () => {
    try {
      const r = await api<{ url: string }>(`/api/desk/items/${encodeURIComponent(id)}/google`, { body: {} });
      setMsg("Saved to your Google Drive ✓");
      window.open(r.url, "_blank", "noopener");
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const m = item?.meta;
  const mine = links.filter((l) => l.item_id === id);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label={m?.title ?? "Desk item"}>
        <div className="bar-top">
          <span style={{ fontSize: 22 }}>{m?.icon}</span>
          <b style={{ flex: 1, fontFamily: "var(--serif)", fontSize: 18 }}>{m?.title ?? "…"}</b>
          {item && item.versions.length > 1 && (
            <select className="select" style={{ width: "auto", minHeight: 36, padding: "0 10px" }} aria-label="Version" value={v ?? m?.version} onChange={(e) => setV(Number(e.target.value))}>
              {item.versions.map((n) => <option key={n} value={n}>v{n}</option>)}
            </select>
          )}
          {mine[0] && <a className="btn ghost small" href={mine[0].url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>Open in Google ↗</a>}
          {mine[0]?.extra && <a className="btn ghost small" href={mine[0].extra} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>Sheet ↗</a>}
          {canEdit && !mine[0] && <button className="btn ghost small" onClick={toGoogle}>Save to Google</button>}
          {canEdit && <button className="btn ghost small" onClick={fav} aria-pressed={m?.favourite}>{m?.favourite ? "★ Favourite" : "☆ Favourite"}</button>}
          <button className="x" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="body">
          {item && (m!.format === "html" || m!.format === "svg") && (
            <iframe title={m!.title} sandbox="allow-scripts" referrerPolicy="no-referrer" src={`/api/desk/items/${encodeURIComponent(id)}/frame${v ? `?v=${v}` : ""}`} />
          )}
          {item && m!.format === "md" && <Markdown text={item.content} />}
          {item && m!.format === "json" && <pre className="md" style={{ whiteSpace: "pre-wrap" }}>{item.content}</pre>}
        </div>
        {canEdit && (
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
            <textarea rows={1} placeholder="Ask for a change, e.g. “make it harder”" value={change} onChange={(e) => setChange(e.target.value)} aria-label="Ask for a change" />
            <button type="button" className="roundbtn" aria-label="Move to bin" onClick={remove}>🗑️</button>
            <button type="submit" className="roundbtn send" aria-label="Ask for change" disabled={!change.trim()}>↑</button>
          </form>
        )}
        {msg && <div className="notice" style={{ margin: 10 }}>{msg}</div>}
      </div>
    </>
  );
}

export function MakeSheet({ me, onClose, onStarted, characterIds = [] }: { me: Me; onClose: () => void; onStarted: () => void; characterIds?: number[] }) {
  const [kind, setKind] = useState("quiz");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [chapters, setChapters] = useState(1);
  const [chars, setChars] = useState<number[]>(characterIds);
  const [all, setAll] = useState<Character[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => { api<{ characters: Character[] }>("/api/oc").then((r) => setAll(r.characters)).catch(() => undefined); }, []);
  const go = async () => {
    try {
      await api("/api/desk/make", { body: { kind, title: title.trim() || KIND_LABEL[kind].split(" ").slice(1).join(" "), brief, chapters: kind === "story" ? chapters : undefined, characterIds: chars } });
      onStarted();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Make something" style={{ background: "var(--hearth)", color: "var(--text)", border: "1px solid var(--line)" }}>
        <span className="grab" />
        <h3 style={{ color: "var(--text)" }}>Make something</h3>
        <span className="small">{me.profile.name} makes it on its desk, using the desk’s own energy.</span>
        <div className="chips">
          {me.kinds.map((k) => <button key={k} className={`chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>{KIND_LABEL[k] ?? k}</button>)}
        </div>
        <label className="field">Called<input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Victorians quiz" /></label>
        <label className="field">What should it be like?<textarea className="textarea" value={brief} maxLength={2000} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. 10 questions on the Victorians for Year 9, a bit tricky" /></label>
        {kind === "story" && (
          <label className="field">Chapters
            <select className="select" value={chapters} onChange={(e) => setChapters(Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select>
          </label>
        )}
        {all.length > 0 && (
          <div className="stack"><b style={{ fontSize: 14 }}>Starring</b>
            <div className="chips">{all.map((c) => <button key={c.id} className={`chip ${chars.includes(c.id) ? "on" : ""}`} onClick={() => setChars((x) => x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id])}>{c.sheet.icon} {c.sheet.name}</button>)}</div>
          </div>
        )}
        {err && <span className="small" style={{ color: "var(--ember)" }}>{err}</span>}
        <button className="btn primary block" disabled={!brief.trim()} onClick={go}>Make it ✨</button>
        <button className="btn ghost small" onClick={onClose}>Not now</button>
      </div>
    </>
  );
}

/** The phone's desk screen. */
export function Desk({ me, energy, canEdit = true }: { me: Me; energy?: Energy; canEdit?: boolean }) {
  const { desk, reload } = useDesk();
  const [open, setOpen] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const name = me.profile.name;
  const items = [...(desk?.items ?? [])].sort((a, b) => Number(b.favourite) - Number(a.favourite) || b.updatedAt - a.updatedAt);
  const active = desk?.jobs.filter((j) => j.status === "working" || j.status === "queued") ?? [];
  const failed = desk?.jobs.filter((j) => j.status === "failed").slice(0, 2) ?? [];

  return (
    <div className="screen narrow">
      <span className="hand">what {name}’s been up to</span>
      <h2 className="screen-title">{name}’s desk</h2>
      {energy && <EnergyCard energy={energy} />}
      {active.map((j) => (
        <div key={j.id} className="card glow" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 26 }}>✍️</span>
          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <b style={{ fontSize: 15 }}>{j.kind === "edit" ? "Changing something for you" : `Making you ${j.title}`}</b>
            <span className="bar" style={{ height: 8 }}><span style={{ width: `${Math.max(j.progress, 5)}%` }} /></span>
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{j.status === "queued" ? "next up" : desk?.status.activity || "working on it"}</span>
          </span>
        </div>
      ))}
      {failed.map((j) => <div key={j.id} className="notice" style={{ alignSelf: "stretch" }}>Couldn’t finish “{j.title}”: {j.error}</div>)}
      <div className="spread"><b>Made for you</b>{canEdit && <button className="btn ghost small" onClick={() => setMaking(true)} disabled={desk ? !desk.energy.canWork : true}>+ Make something</button>}</div>
      {desk && !desk.reachable && <div className="notice">The desk isn’t reachable right now.</div>}
      {desk && desk.reachable && items.length === 0 && <span className="small">Nothing here yet. Ask {name} to make you something!</span>}
      <div className="grid2">
        {items.map((it) => (
          <button key={it.id} className="made" onClick={() => setOpen(it.id)}>
            {it.favourite && <span className="fav" aria-label="favourite">★</span>}
            <span className="ic">{it.icon}</span><b>{it.title}</b><span>{subtitle(it)}{desk?.links.some((l) => l.item_id === it.id) ? " · in Google ☁︎" : ""}</span>
          </button>
        ))}
      </div>
      {desk?.journal[0] && (
        <div className="card">
          <b style={{ fontSize: 15 }}>{name}’s journal</b>
          <span className="journal">“{desk.journal[0].text}”</span>
        </div>
      )}
      {desk && <span className="small">Desk energy today: {desk.energy.percent}% (its own slice, so it never uses up your chat energy).</span>}
      <span className="small">{name}’s desk is a little computer of its own at home. {name} can write, draw and make things there, but it can’t go on the internet by itself or touch the rest of the house. You and {me.parentLabel} can always see what’s on it.</span>
      {open && <ItemViewer id={open} canEdit={canEdit} links={desk?.links} onClose={() => setOpen(null)} onChanged={reload} />}
      {making && <MakeSheet me={me} onClose={() => setMaking(false)} onStarted={reload} />}
    </div>
  );
}

/** The Mac layout's right-hand panel: a peek at the companion's own little desktop, live from home. */
export function DeskAside({ me, go }: { me: Me; go: (to: string) => void }) {
  const { desk, reload } = useDesk(5000);
  const [sel, setSel] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; body: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const name = me.profile.name;
  const items = desk?.items.slice(0, 8) ?? [];
  const current = sel ?? items[0]?.id ?? null;

  useEffect(() => {
    if (!current) { setPreview(null); return; }
    api<{ meta: DeskItem; content: string }>(`/api/desk/items/${encodeURIComponent(current)}`).then((r) => {
      const text = r.meta.format === "md" ? r.content.replace(/[#*_>`]/g, "") : r.meta.summary || "Open it to have a go.";
      setPreview({ title: r.meta.title, body: text.slice(0, 320) });
    }).catch(() => setPreview(null));
  }, [current, desk?.items.length]);

  const working = desk?.jobs.find((j) => j.status === "working");
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const file = items.find((i) => i.id === current);

  return (
    <aside className="deskaside" aria-label={`${name}’s desk`}>
      <div className="spread"><b style={{ fontFamily: "var(--serif)", fontSize: 22, fontWeight: 600 }}>{name}’s desk</b><button className="btn ghost small" onClick={() => go("/desk")}>live from home</button></div>
      <div className="computer">
        <div className="menubar"><span>{name}’s computer</span><span>offline from the internet · {time}</span></div>
        <div className="icons">
          {items.map((it) => (
            <button key={it.id} className={`icon ${current === it.id ? "on" : ""}`} onClick={() => setSel(it.id)} onDoubleClick={() => setOpen(it.id)}>
              <span>{it.icon}</span><span>{it.title.length > 22 ? it.title.slice(0, 20) + "…" : it.title}</span>
            </button>
          ))}
          {desk && items.length === 0 && <span style={{ gridColumn: "1 / -1", fontSize: 12, color: "rgba(255,255,255,0.8)" }}>An empty desk, for now.</span>}
        </div>
        {preview && file && (
          <button className="window" onClick={() => setOpen(file.id)} aria-label={`Open ${file.title}`}>
            <div className="tb"><i style={{ background: "#FF5F57" }} /><i style={{ background: "#FEBC2E" }} /><i style={{ background: "#28C840" }} /><span style={{ flex: 1, textAlign: "center", fontSize: 10.5, fontWeight: 800 }}>{file.title}</span></div>
            <div className="content"><b style={{ display: "block", fontFamily: "var(--serif)", fontSize: 15, marginBottom: 4 }}>{preview.title}</b>{preview.body}</div>
          </button>
        )}
        <div className="status">
          <span className={`dot ${working ? "" : "idle"}`} />
          <span style={{ flex: 1 }}>{working ? `${name} is ${desk?.status.activity || `making ${working.title}`}` : `${name}’s desk is quiet`}</span>
          {working && <b>{working.progress}%</b>}
        </div>
      </div>
      {desk?.journal[0] && (
        <div className="card" style={{ background: "var(--card-2)", borderColor: "#3a2836" }}>
          <span className="journal" style={{ fontSize: 20 }}>“{desk.journal[0].text}”</span>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--faint)" }}>{name.toUpperCase()}’S JOURNAL · {desk.journal[0].day === new Date().toISOString().slice(0, 10) ? "TODAY" : desk.journal[0].day}</span>
        </div>
      )}
      <span className="small">{name}’s desk is a small sandboxed computer on the home server (a container). {name} can write, draw and build little things there in its own time. It can’t browse the internet by itself, install apps or touch the rest of the house, and you and {me.parentLabel} can always see everything on it.</span>
      {open && <ItemViewer id={open} canEdit links={desk?.links} onClose={() => setOpen(null)} onChanged={reload} />}
    </aside>
  );
}
