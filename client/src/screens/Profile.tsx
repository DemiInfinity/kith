import { useEffect, useState } from "react";
import { api, type AppState, type Job, type Me, type Mood } from "../api";
import { Avatar } from "../components/Avatar";
import { EnergyCard, Markdown, clock, doingText } from "../components/bits";
import { DeskComputer } from "./DeskComputer";
import { Icon, IL, type IconName } from "../components/Icons";

interface Files {
  soul: string; soulIsDefault: boolean; identity: string; identityNotes: string;
  memories: { id: number; icon: string; text: string; date: string | null }[]; summary: string;
}
interface Heartbeat { everyMinutes: number; last: { ts: number; outcome: string; note: string } | null; next: number; recent: { ts: number; outcome: string; note: string }[] }

const BEAT_WORDS: Record<string, string> = { quiet: "all quiet", "checked in": "sent you a check-in", journal: "wrote in its journal", asleep: "asleep (quiet hours)", resting: "resting", error: "couldn’t think just then" };

/** The heartbeat: always on, every 30 minutes. It can't be paused or deleted. */
export function HeartbeatCard({ beat, name }: { beat: Heartbeat | null; name: string }) {
  return (
    <div className="card hbcard">
      <div className="row" style={{ gap: 12 }}>
        <span className="hbpulse" aria-hidden><Icon name="heart" size={20} /></span>
        <span style={{ flex: 1 }}><b>Heartbeat</b><br /><span className="small">Every {beat?.everyMinutes ?? 30} minutes · always on</span></span>
        <span className="hblock" title="The heartbeat can’t be paused or deleted"><Icon name="lock" size={14} /></span>
      </div>
      <span className="small">Every half hour, {name} quietly looks at what’s coming up (reminders, exams, things it made you) and decides if anything needs doing. Usually nothing does. It never messages in quiet hours or just to chat.</span>
      {beat?.last && <span className="small"><b>Last beat {clock(beat.last.ts)}:</b> {BEAT_WORDS[beat.last.outcome] ?? beat.last.outcome}{beat.last.note && beat.last.outcome !== "asleep" && beat.last.note !== "all quiet" ? ` · ${beat.last.note}` : ""} · next about {clock(beat.next)}</span>}
      {!beat?.last && <span className="small">The first beat happens within half an hour.</span>}
    </div>
  );
}

interface Mine { id: number; title: string; kind: "reminder" | "make"; at: number; repeat: string; active: number }
interface Schedule {
  jobs: Job[];
  checkins: {
    toggles: { askHowThingsWent: boolean; morningHello: boolean; waterWhileRevising: boolean };
    quietHours: { start: string; end: string }; maxPerDay: number;
    upcoming: { date: string; text: string; icon: string }[];
    recent: { ts: number; kind: string; text: string }[];
  };
  routines: { icon: string; what: string; when: string }[];
}

type Tab = "desk" | "scheduled" | "who";

/** A section the child can read nicely, and edit. */
function Section({ icon, title, hint, text, editable, onSave, placeholder }: { icon: IconName; title: string; hint: string; text: string; editable?: boolean; onSave?: (t: string) => Promise<void>; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [err, setErr] = useState("");
  useEffect(() => setDraft(text), [text]);
  const save = async () => {
    try { await onSave!(draft); setEditing(false); setErr(""); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="mdfile">
      <div className="mdname" style={{ fontFamily: "var(--sans)", fontWeight: 900, fontSize: 13, justifyContent: "space-between" }}>
        <IL i={icon}>{title}</IL>
        {editable && !editing && <button className="btn ghost small" style={{ minHeight: 30 }} onClick={() => setEditing(true)}><IL i="pencil">Edit</IL></button>}
      </div>
      {editing ? (
        <div className="stack" style={{ padding: 14 }}>
          <textarea className="textarea" style={{ minHeight: 160 }} value={draft} placeholder={placeholder} maxLength={3000} onChange={(e) => setDraft(e.target.value)} />
          {err && <span className="small" style={{ color: "var(--ember)" }}>{err}</span>}
          <div className="row"><button className="btn primary small" onClick={save}>Save</button><button className="btn ghost small" onClick={() => { setDraft(text); setEditing(false); }}>Cancel</button></div>
        </div>
      ) : text.trim() ? <Markdown text={text} /> : <div className="md small">{placeholder}</div>}
      <div className="small" style={{ padding: "0 18px 12px" }}>{hint}</div>
    </div>
  );
}

/** The companion's profile: who it is, its desk, what's scheduled, and its files. */
export function Profile({ me, state, mood, go, initialTab = "desk", panel = false, onClose }: { me: Me; state: AppState | null; mood: Mood; go: (to: string) => void; initialTab?: Tab; panel?: boolean; onClose?: () => void }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [files, setFiles] = useState<Files | null>(null);
  const [sched, setSched] = useState<Schedule | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);
  const [beat, setBeat] = useState<Heartbeat | null>(null);
  const [form, setForm] = useState({ title: "", when: "", repeat: "none" });
  const [schedErr, setSchedErr] = useState("");
  const loadMine = () => api<{ schedules: Mine[] }>("/api/schedules").then((r) => setMine(r.schedules)).catch(() => undefined);
  const name = me.profile.name;
  useEffect(() => {
    if (tab === "who" && !files) api<Files>("/api/pip/files").then(setFiles).catch(() => undefined);
    if (tab === "scheduled") { api<Schedule>("/api/pip/schedule").then(setSched).catch(() => undefined); void loadMine(); api<Heartbeat>("/api/heartbeat").then(setBeat).catch(() => undefined); }
  }, [tab, files]);
  useEffect(() => setTab(initialTab), [initialTab]);

  const tabs: [Tab, IconName, string][] = [["desk", "desk", "Desk"], ["scheduled", "calendar", "Scheduled"], ["who", "heart", `Who ${name} is`]];
  const [newMem, setNewMem] = useState("");
  const saveSoul = async (text: string) => setFiles(await api<Files>("/api/pip/soul", { method: "PUT", body: { text } }));
  const saveNotes = async (notes: string) => setFiles(await api<Files>("/api/pip/identity", { method: "PUT", body: { notes } }));
  const reloadFiles = () => api<Files>("/api/pip/files").then(setFiles).catch(() => undefined);
  const on = (t: Tab) => (t === "desk" ? "/pip" : `/pip/${t}`);
  const c = sched?.checkins;

  return (
    <div className="screen" style={panel ? { width: "100%" } : { maxWidth: 1400, margin: "0 auto", width: "100%" }}>
      {panel && <div className="spread"><span className="hand">{name}’s profile</span><button className="x" aria-label="Close profile" onClick={onClose}><Icon name="close" /></button></div>}
      <div className="profilehead">
        <Avatar look={me.profile.look} mood={mood} size={104} variant="ring" laptop={!!state?.desk.working} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ fontSize: 32 }}>{name}</h2>
          <div className="pstatus" aria-live="polite"><span className={`dot ${state?.desk.working || state?.desk.browsing ? "" : "idle"}`} /><b>Now:</b> {doingText(state, mood)}</div>
          <span style={{ fontSize: 14, fontWeight: 800, color: "var(--lilac-soft)" }}>AI companion, not a person · {me.profile.traits.join(" · ") || "warm"}</span>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>Lives on your family’s home server · made by you {me.name ? `(${me.name})` : ""} · {me.parentLabel} is in the loop</div>
        </div>
      </div>
      <div className="chips" role="tablist">
        {tabs.map(([t, ic, l]) => <button key={t} role="tab" aria-selected={tab === t} className={`chip ${tab === t ? "on" : ""}`} onClick={() => { setTab(t); if (!panel) history.replaceState(null, "", on(t)); }}><IL i={ic}>{l}</IL></button>)}
      </div>

      {tab === "desk" && <DeskComputer me={me} go={go} />}

      {tab === "scheduled" && (
        <div className="stack" style={{ maxWidth: 760, gap: 12 }}>
          <HeartbeatCard beat={beat} name={name} />
          <div className="card">
            <b>You asked for</b>
            {mine.length === 0 && <span className="small">Nothing yet. Ask {name} in chat (“remind me at 7 to revise”, “every Sunday make me a quiz”) or add one here.</span>}
            {mine.map((m) => (
              <div key={m.id} className="row" style={{ fontSize: 14, borderTop: "1px solid var(--line-soft)", paddingTop: 6, opacity: m.active ? 1 : 0.55 }}>
                <span className="hic"><Icon name={m.kind === "reminder" ? "alarm" : "sparkle"} size={18} /></span>
                <span style={{ flex: 1 }}>{m.title}<br /><span className="small">{m.active ? new Date(m.at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "paused"}{m.repeat !== "none" ? ` · ${m.repeat}` : ""}</span></span>
                <button className="btn ghost small" onClick={async () => { await api(`/api/schedules/${m.id}`, { method: "PATCH", body: { active: !m.active } }); void loadMine(); }}>{m.active ? "Pause" : "Resume"}</button>
                <button className="x" aria-label={`Delete ${m.title}`} onClick={async () => { await api(`/api/schedules/${m.id}`, { method: "DELETE" }); void loadMine(); }}><Icon name="close" size={16} /></button>
              </div>
            ))}
            <form className="stack" style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 10 }} onSubmit={async (e) => {
              e.preventDefault();
              try { await api("/api/schedules", { body: { title: form.title, kind: "reminder", when: form.when, repeat: form.repeat } }); setForm({ title: "", when: "", repeat: "none" }); setSchedErr(""); void loadMine(); }
              catch (err) { setSchedErr((err as Error).message); }
            }}>
              <b style={{ fontSize: 14 }}>Add a reminder</b>
              <input className="input" placeholder="What? e.g. Revise fractions" value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <div className="grid2">
                <input className="input" type="datetime-local" aria-label="When" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
                <select className="select" aria-label="Repeat" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })}>
                  <option value="none">Just once</option><option value="daily">Every day</option><option value="weekdays">School days</option><option value="weekly">Every week</option>
                </select>
              </div>
              {schedErr && <span className="small" style={{ color: "var(--ember)" }}>{schedErr}</span>}
              <button className="btn primary small" type="submit" disabled={!form.title.trim() || !form.when}>Add</button>
            </form>
          </div>
          <div className="card">
            <b>On the desk</b>
            {sched?.jobs.length === 0 && <span className="small">Nothing queued. Ask {name} to make something!</span>}
            {sched?.jobs.map((j) => (
              <div key={j.id} className="row" style={{ fontSize: 14, borderTop: "1px solid var(--line-soft)", paddingTop: 6 }}>
                <span className="hic"><Icon name={j.status === "done" ? "check" : j.status === "working" ? "hourglass" : j.status === "failed" ? "warn" : "clock"} size={18} /></span>
                <span style={{ flex: 1 }}>{j.title}</span>
                <span className="small">{j.status === "working" ? `${j.progress}%` : j.status} · {clock(j.ts)}</span>
              </div>
            ))}
          </div>
          <div className="card">
            <b>Check-ins</b>
            {c && (
              <>
                <span style={{ fontSize: 14 }}>{[c.toggles.askHowThingsWent && "Asks how big things went", c.toggles.morningHello && "A morning hello on school days", c.toggles.waterWhileRevising && "Water reminders while revising"].filter(Boolean).join(" · ") || "All check-ins are off."}</span>
                <span className="small">At most {Math.min(2, c.maxPerDay)} a day · never {c.quietHours.start}–{c.quietHours.end} · never guilt-tripping · {name} never calls you</span>
                {c.upcoming.length > 0 && <b style={{ fontSize: 14, marginTop: 4 }}>Coming up</b>}
                {c.upcoming.map((u) => <span key={u.date + u.text} style={{ fontSize: 14 }}>{u.icon} {u.text} · {u.date} <span className="small">(I’ll ask how it went, after school)</span></span>)}
                {c.recent.length > 0 && <b style={{ fontSize: 14, marginTop: 4 }}>Recent</b>}
                {c.recent.map((r) => <span key={r.ts} className="small">{new Date(r.ts).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })} · {r.text}</span>)}
              </>
            )}
            <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => go("/memory")}>Change check-ins</button>
          </div>
          <div className="card">
            <b>Every day and week</b>
            {sched?.routines.map((r) => <div key={r.what} className="row" style={{ fontSize: 14 }}><span>{r.icon}</span><span style={{ flex: 1 }}>{r.what}</span><span className="small">{r.when}</span></div>)}
          </div>
        </div>
      )}

      {tab === "who" && (files ? (
        <div className="stack" style={{ maxWidth: 820, gap: 14 }}>
          <span className="small">This is {name}, the way you’ve made it. You can change any of it. (Safety rules sit underneath all of this and don’t change, whatever’s written here.)</span>
          <Section icon="sparkle" title="Soul" text={files.soul} editable onSave={saveSoul}
            hint={files.soulIsDefault ? `This is a starting point. Rewrite it however you like: who ${name} is, what it cares about, how it sees the world.` : `Written by you.`}
            placeholder={`Who is ${name}? What does it care about?`} />
          <div className="mdfile">
            <div className="mdname" style={{ fontFamily: "var(--sans)", fontWeight: 900, fontSize: 13, justifyContent: "space-between" }}>
              <IL i="mask">Personality</IL><button className="btn ghost small" style={{ minHeight: 30 }} onClick={() => go("/me")}>Change look, traits & voice</button>
            </div>
            <Markdown text={files.identity} />
          </div>
          <Section icon="note" title="More about its personality" text={files.identityNotes} editable onSave={saveNotes}
            hint="Catchphrases, favourite things, how it talks… anything that makes it feel like yours."
            placeholder={`e.g. ${name} says “brilliant!” a lot, loves rainy days and thinks owls are underrated.`} />
          <div className="mdfile">
            <div className="mdname" style={{ fontFamily: "var(--sans)", fontWeight: 900, fontSize: 13 }}><IL i="brain">Memory</IL></div>
            <div className="stack" style={{ padding: 14 }}>
              {files.memories.length === 0 && <span className="small">Nothing yet.</span>}
              {files.memories.map((m) => (
                <div key={m.id} className="memrow">
                  <span>{m.icon}</span><span className="t">{m.text}{m.date ? <span className="small"> · {m.date}</span> : null}</span>
                  <button className="x" aria-label={`Forget “${m.text}”`} onClick={async () => { await api(`/api/memories/${m.id}`, { method: "DELETE" }); void reloadFiles(); }}><Icon name="close" size={16} /></button>
                </div>
              ))}
              <form className="row" onSubmit={async (e) => { e.preventDefault(); if (!newMem.trim()) return; try { await api("/api/memories", { body: { text: newMem } }); setNewMem(""); void reloadFiles(); } catch (err) { alert((err as Error).message); } }}>
                <input className="input" value={newMem} maxLength={140} placeholder={`Tell ${name} something to remember`} onChange={(e) => setNewMem(e.target.value)} />
                <button className="btn primary small" type="submit" disabled={!newMem.trim()}>Add</button>
              </form>
              {files.summary && <><b style={{ fontSize: 14, marginTop: 6 }}>Our recent chats, in short</b><span style={{ fontSize: 14, color: "var(--text-3)" }}>{files.summary}</span></>}
              <span className="small">You’re in charge: {name} never keeps personal details like your address or school.</span>
            </div>
          </div>
        </div>
      ) : <span className="small">…</span>)}
    </div>
  );
}

/** Settings: everything about you and the companion, including usage (energy). */
export function Settings({ me, go, state }: { me: Me; go: (to: string) => void; state: AppState | null }) {
  const name = me.profile.name;
  const logout = async () => { const r = await api<{ redirect?: string | null }>("/auth/logout", { body: {} }).catch(() => ({ redirect: null })); location.href = r.redirect || "/"; };
  const rows: [string, IconName, string, string][] = [
    ["/pip", "idcard", `${name}’s profile`, `Its desk, what’s scheduled, and who ${name} is (soul, personality, memory)`],
    ["/me", "pencil", `Edit ${name}`, "Name, look, personality and voice"],
    ["/notifications", "bell", "Notifications", "Turn on, test, and choose what reaches your phone"],
    ["/memory", "brain", `What ${name} remembers`, "See and delete memories; check-ins"],
    ["/shared", "eye", `What ${me.parentLabel} sees`, "Nothing secret here"],
    ["/connectors", "sparkle", "Connectors and skills", `What ${me.parentLabel} has connected ${name} to, and its /commands`],
    ["/google", "cloud", "Google Drive", "Save what you make to your own Drive"],
    ["/help", "question", "Help", `Answers about ${name}, privacy, energy and more`],
  ];
  return (
    <div className="screen narrow dgrid">
      <span className="hand">yours</span>
      <h2 className="screen-title">Settings</h2>
      <b>Usage</b>
      {state && <EnergyCard energy={state.energy} />}
      {state && <span className="small">{name}’s desk has its own energy for today: {state.desk.percent}%, so making things never uses up your chats.</span>}
      <b style={{ marginTop: 6 }}>You and {name}</b>
      {rows.map(([to, ic, t, d]) => (
        <button key={to} className="card" style={{ flexDirection: "row", alignItems: "center", gap: 12, textAlign: "left" }} onClick={() => go(to)}>
          <span className="hic" style={{ color: "var(--lilac)" }}><Icon name={ic} size={26} /></span><span><b>{t}</b><br /><span className="small">{d}</span></span>
        </button>
      ))}
      <button className="btn ghost small" onClick={logout}>Sign out</button>
      <span className="small">{name} is an AI, not a person. It lives on your family’s home server.</span>
    </div>
  );
}


/** On a computer: the companion's profile (the same one as on a phone), in a panel beside the chat. */
export function ProfilePanel({ open, tab = "desk", me, state, mood, go, onClose }: { open: boolean; tab?: Tab; me: Me; state: AppState | null; mood: Mood; go: (to: string) => void; onClose: () => void }) {
  // Stays mounted so it can slide in and out smoothly; its contents load the first time it opens.
  const [seen, setSeen] = useState(open);
  useEffect(() => { if (open) setSeen(true); }, [open]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open, onClose]);
  return (
    <aside className={`profilepanel ${open ? "open" : ""}`} role="dialog" aria-label={`${me.profile.name}’s profile`} aria-hidden={!open} inert={!open}>
      <div className="pp-inner">{seen && <Profile me={me} state={state} mood={mood} go={go} panel onClose={onClose} initialTab={tab} />}</div>
    </aside>
  );
}
