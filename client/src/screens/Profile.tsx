import { lazy, Suspense, useEffect, useState } from "react";
import { api, type AppState, type Job, type Me, type Mood } from "../api";
import { CompanionPic } from "../components/CompanionPic";
import { Markdown, Toggle, UsageLimits, clock, doingText } from "../components/bits";
import { Icon, IL, type IconName } from "../components/Icons";
import { DeskRules, TodayList, useDeskToday } from "../components/DeskBits";
import { action } from "../lib/action";
import { setSongsAllowed, songsAllowed, useMusic } from "../lib/music";
import { isChildMacApp } from "../lib/macVoice";

// The desk is big (a whole little computer), so it loads the first time it's opened.
const DeskComputer = lazy(() => import("./DeskComputer").then((m) => ({ default: m.DeskComputer })));

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

type Tab = "desk" | "today" | "scheduled" | "who";

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
      <div className="mdname" style={{ fontFamily: "var(--sans)", fontWeight: 900, fontSize: "0.8125rem", justifyContent: "space-between" }}>
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
export function Profile({ me, state, mood, go, initialTab = "desk", panel = false, onClose, live = true }: { me: Me; state: AppState | null; mood: Mood; go: (to: string) => void; initialTab?: Tab; panel?: boolean; onClose?: () => void; live?: boolean }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const music = useMusic();
  const [files, setFiles] = useState<Files | null>(null);
  const [sched, setSched] = useState<Schedule | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);
  const [beat, setBeat] = useState<Heartbeat | null>(null);
  const loadMine = () => api<{ schedules: Mine[] }>("/api/schedules").then((r) => setMine(r.schedules)).catch(() => undefined);
  const name = me.profile.name;
  useEffect(() => {
    if (tab === "who" && !files) api<Files>("/api/pip/files").then(setFiles).catch(() => undefined);
    if (tab === "scheduled") { api<Schedule>("/api/pip/schedule").then(setSched).catch(() => undefined); void loadMine(); api<Heartbeat>("/api/heartbeat").then(setBeat).catch(() => undefined); }
  }, [tab, files]);
  useEffect(() => setTab(initialTab), [initialTab]);

  const tabs: [Tab, IconName, string][] = [["desk", "desk", "Desk"], ["today", "clock", "Today"], ["scheduled", "calendar", "Scheduled"], ["who", "heart", `Who ${name} is`]];
  const [newMem, setNewMem] = useState("");
  const saveSoul = async (text: string) => setFiles(await api<Files>("/api/pip/soul", { method: "PUT", body: { text } }));
  const saveNotes = async (notes: string) => setFiles(await api<Files>("/api/pip/identity", { method: "PUT", body: { notes } }));
  const reloadFiles = () => api<Files>("/api/pip/files").then(setFiles).catch(() => undefined);
  const on = (t: Tab) => (t === "desk" ? "/pip" : `/pip/${t}`);
  const c = sched?.checkins;
  type Item = { key: string; t: number; icon: IconName; title: string; when: string; dim?: boolean; mine?: Mine };
  const REPEAT: Record<string, string> = { daily: "every day", weekdays: "school days", weekly: "every week" };
  const when = (t: number) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const LATER = Number.MAX_SAFE_INTEGER; // repeating things without one set time go after the dated ones
  const items: Item[] = [
    ...mine.map((m): Item => ({ key: `m${m.id}`, t: m.active ? m.at : LATER, icon: m.kind === "reminder" ? "alarm" : "sparkle", title: m.title, dim: !m.active, mine: m,
      when: (m.active ? when(m.at) : "paused") + (m.repeat !== "none" ? ` · ${REPEAT[m.repeat] ?? m.repeat}` : "") })),
    ...(sched?.jobs ?? []).filter((j) => j.status !== "done" && j.status !== "failed").map((j): Item => ({ key: `j${j.id}`, t: j.ts, icon: j.status === "working" ? "hourglass" : "clock", title: j.title,
      when: j.status === "working" ? `${name} is making it · ${j.progress}%` : `${name} will make it · ${clock(j.ts)}` })),
    ...(c?.upcoming ?? []).map((u): Item => ({ key: `u${u.date}${u.text}`, t: Date.parse(u.date) || LATER - 1, icon: "chat", title: `Ask how ${u.text} went`, when: `${u.date} · after school` })),
    ...(c?.toggles.morningHello ? [{ key: "hello", t: LATER, icon: "bell" as IconName, title: "A morning hello", when: "school days" }] : []),
    ...(c?.toggles.waterWhileRevising ? [{ key: "water", t: LATER, icon: "bell" as IconName, title: "Water reminders", when: "while you revise" }] : []),
    ...(sched?.routines ?? []).map((r, i): Item => ({ key: `r${i}`, t: LATER, icon: "sparkle", title: r.what, when: r.when })),
  ];
  const sorted = items.sort((x, y) => x.t - y.t);

  return (
    <div className="screen" style={panel ? { width: "100%" } : { maxWidth: 1400, margin: "0 auto", width: "100%" }}>
      {panel && <div className="spread"><span className="hand">{name}’s profile</span><button className="x" aria-label="Close profile" onClick={onClose}><Icon name="close" /></button></div>}
      <div className="profilehead">
        <CompanionPic look={me.profile.look} mood={mood} size={104} variant="ring" laptop={!!state?.desk.working} live={live ? "on" : "off"} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ fontSize: "2rem" }}>{name}</h2>
          <div className="pstatus" aria-live="polite"><span className={`dot ${state?.desk.working || state?.desk.browsing ? "" : "idle"}`} /><b>Now:</b> {doingText(state, mood, music)}</div>
          <span style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--lilac-soft)" }}>AI companion, not a person · {me.profile.traits.join(" · ") || "warm"}</span>
          <div style={{ fontSize: "0.8125rem", color: "var(--muted)", marginTop: 4 }}>Lives on your family’s home server · made by you {me.name ? `(${me.name})` : ""} · {me.parentLabel} is in the loop</div>
        </div>
      </div>
      <div className="chips" role="tablist">
        {tabs.map(([t, ic, l]) => <button key={t} role="tab" aria-selected={tab === t} className={`chip ${tab === t ? "on" : ""}`} onClick={() => { setTab(t); if (!panel) history.replaceState(null, "", on(t)); }}><IL i={ic}>{l}</IL></button>)}
      </div>

      {tab === "desk" && <Suspense fallback={<span className="small">Opening the desk…</span>}><DeskComputer me={me} go={go} /></Suspense>}

      {tab === "today" && <TodayTab name={name} parentLabel={me.parentLabel} />}
      {tab === "scheduled" && (
        <div className="stack" style={{ maxWidth: 760, gap: 12 }}>
          <HeartbeatCard beat={beat} name={name} />
          {/* One list of everything coming up (her reminders, desk jobs, check-ins, routines), soonest first.
              Things are added or changed by asking in chat; here she can only pause or delete her own. */}
          <div className="card">
            <b>Coming up</b>
            {sorted.length === 0 && <span className="small">Nothing yet. Ask {name} in chat: “remind me at 7 to revise”, or “every Sunday make me a quiz”.</span>}
            {sorted.map((it) => (
              <div key={it.key} className="row" style={{ fontSize: "0.875rem", borderTop: "1px solid var(--line-soft)", paddingTop: 6, opacity: it.dim ? 0.55 : 1 }}>
                <span className="hic"><Icon name={it.icon} size={18} /></span>
                <span style={{ flex: 1 }}>{it.title}<br /><span className="small">{it.when}</span></span>
                {it.mine && <>
                  <button className="btn ghost small" onClick={action(async () => { await api(`/api/schedules/${it.mine!.id}`, { method: "PATCH", body: { active: !it.mine!.active } }); void loadMine(); }, "change that")}>{it.mine.active ? "Pause" : "Resume"}</button>
                  <button className="x" aria-label={`Delete ${it.title}`} onClick={action(async () => { await api(`/api/schedules/${it.mine!.id}`, { method: "DELETE" }); void loadMine(); }, "delete that")}><Icon name="close" size={16} /></button>
                </>}
              </div>
            ))}
            {c && <span className="small" style={{ marginTop: 6 }}>Check-ins: at most {Math.min(2, c.maxPerDay)} a day, never {c.quietHours.start}–{c.quietHours.end}, never guilt-tripping, and {name} never calls you. To add or change anything here, just ask {name} in chat.</span>}
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
            <div className="mdname" style={{ fontFamily: "var(--sans)", fontWeight: 900, fontSize: "0.8125rem", justifyContent: "space-between" }}>
              <IL i="mask">Personality</IL><button className="btn ghost small" style={{ minHeight: 30 }} onClick={() => go("/me")}>Change look, traits & voice</button>
            </div>
            <Markdown text={files.identity} />
          </div>
          <Section icon="note" title="More about its personality" text={files.identityNotes} editable onSave={saveNotes}
            hint="Catchphrases, favourite things, how it talks… anything that makes it feel like yours."
            placeholder={`e.g. ${name} says “brilliant!” a lot, loves rainy days and thinks owls are underrated.`} />
          <div className="mdfile">
            <div className="mdname" style={{ fontFamily: "var(--sans)", fontWeight: 900, fontSize: "0.8125rem" }}><IL i="brain">Memory</IL></div>
            <div className="stack" style={{ padding: 14 }}>
              {files.memories.length === 0 && <span className="small">Nothing yet.</span>}
              {files.memories.map((m) => (
                <div key={m.id} className="memrow">
                  <span>{m.icon}</span><span className="t">{m.text}{m.date ? <span className="small"> · {m.date}</span> : null}</span>
                  <button className="x" aria-label={`Forget “${m.text}”`} onClick={action(async () => { await api(`/api/memories/${m.id}`, { method: "DELETE" }); void reloadFiles(); }, "forget that")}><Icon name="close" size={16} /></button>
                </div>
              ))}
              <form className="row" onSubmit={async (e) => { e.preventDefault(); if (!newMem.trim()) return; try { await api("/api/memories", { body: { text: newMem } }); setNewMem(""); void reloadFiles(); } catch (err) { alert((err as Error).message); } }}>
                <input className="input" value={newMem} maxLength={140} placeholder={`Tell ${name} something to remember`} onChange={(e) => setNewMem(e.target.value)} />
                <button className="btn primary small" type="submit" disabled={!newMem.trim()}>Add</button>
              </form>
              {files.summary && <><b style={{ fontSize: "0.875rem", marginTop: 6 }}>Our recent chats, in short</b><span style={{ fontSize: "0.875rem", color: "var(--text-3)" }}>{files.summary}</span></>}
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
  const deskToday = useDeskToday();
  const logout = async () => { const r = await api<{ redirect?: string | null }>("/auth/logout", { body: {} }).catch(() => ({ redirect: null })); location.href = r.redirect || "/"; };
  const rows: [string, IconName, string, string][] = [
    ["/pip", "idcard", `${name}’s profile`, `Its desk, today, what’s scheduled, and who ${name} is (soul, personality, memory)`],
    ["/me", "pencil", `Edit ${name}`, "Name, look, personality and voice"],
    ["/notifications", "bell", "Notifications", "Turn on, test, and choose what reaches your phone"],
    ["/memory", "brain", `What ${name} remembers`, "See and delete memories; see check-ins"],
    ["/shared", "eye", `What ${me.parentLabel} sees`, "Nothing secret here"],
    ["/connectors", "sparkle", "Connectors and skills", `What ${me.parentLabel} has connected ${name} to, and its /commands`],
    ["/google", "cloud", "Google", "Connect your Google account: Drive, and more if your grown-up switches it on"],
    ["/help", "question", "Help", `Answers about ${name}, privacy, energy and more`],
  ];
  return (
    <div className="screen narrow dgrid">
      <h2 className="screen-title">Settings</h2>
      <span className="hand sub">yours</span>
      <b>Usage</b>
      {state && <UsageLimits energy={state.energy} deskPercent={deskToday?.budget.percent ?? state.desk.percent} name={name} />}
      <b style={{ marginTop: 6 }}>{name}’s desk</b>
      <DeskRules name={name} />
      <b style={{ marginTop: 6 }}>You and {name}</b>
      {rows.map(([to, ic, t, d]) => (
        <button key={to} className="card setrow" onClick={() => go(to)}>
          <span className="hic" style={{ color: "var(--lilac)" }}><Icon name={ic} size={26} /></span>
          <span className="setrow-t"><b>{t}</b><span className="small">{d}</span></span>
          <Icon name="arrow" size={18} />
        </button>
      ))}
      {isChildMacApp() && <MusicSetting name={name} />}
      <button className="btn ghost small" onClick={logout}>Sign out</button>
      <span className="small">{name} is an AI, not a person. It lives on your family’s home server.</span>
    </div>
  );
}


/** The Mac app only: Pip listens along when Apple Music or Spotify plays. Song names are off to start with. */
function MusicSetting({ name }: { name: string }) {
  const [songs, setSongs] = useState(songsAllowed);
  return (
    <>
      <b style={{ marginTop: 6 }}>Music</b>
      <div className="card" style={{ gap: 4 }}>
        <span className="small">When Apple Music or Spotify is playing on this Mac, {name} pops on its headphones and listens along.</span>
        <Toggle label={`Let ${name} know what song is playing`} checked={songs} onChange={(v) => { setSongs(v); setSongsAllowed(v); }} />
        <span className="small">{songs ? `${name} can see the song and who it’s by, while it plays. It isn’t saved.` : `Off: ${name} only knows that music is on, not what it is.`}</span>
      </div>
    </>
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
      <div className="pp-inner">{seen && <Profile me={me} state={state} mood={mood} go={go} panel onClose={onClose} initialTab={tab} live={open} />}</div>
    </aside>
  );
}

/** The Today tab: what the companion did today (the parent sees this too). */
function TodayTab({ name, parentLabel }: { name: string; parentLabel: string }) {
  const today = useDeskToday();
  return <div className="stack" style={{ maxWidth: 760, gap: 12 }}><TodayList today={today} name={name} parentLabel={parentLabel} /></div>;
}
