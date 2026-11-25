import { useEffect, useState } from "react";
import { api, type AppState, type Job, type Me, type Mood } from "../api";
import { Avatar } from "../components/Avatar";
import { EnergyCard, Markdown, clock } from "../components/bits";
import { DeskComputer } from "./DeskComputer";

interface Files { soul: string; personality: string; memory: string }
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

type Tab = "desk" | "scheduled" | "soul" | "personality" | "memory";

function MdFile({ name, text }: { name: string; text: string }) {
  return (
    <div className="mdfile">
      <div className="mdname">📄 {name}</div>
      <Markdown text={text} />
    </div>
  );
}

/** The companion's profile: who it is, its desk, what's scheduled, and its files. */
export function Profile({ me, state, mood, go, initialTab = "desk" }: { me: Me; state: AppState | null; mood: Mood; go: (to: string) => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [files, setFiles] = useState<Files | null>(null);
  const [sched, setSched] = useState<Schedule | null>(null);
  const name = me.profile.name;
  useEffect(() => {
    if (["soul", "personality", "memory"].includes(tab) && !files) api<Files>("/api/pip/files").then(setFiles).catch(() => undefined);
    if (tab === "scheduled") api<Schedule>("/api/pip/schedule").then(setSched).catch(() => undefined);
  }, [tab, files]);
  useEffect(() => setTab(initialTab), [initialTab]);

  const tabs: [Tab, string][] = [["desk", "🖥️ Desk"], ["scheduled", "🗓️ Scheduled"], ["soul", "soul.md"], ["personality", "personality.md"], ["memory", "memory.md"]];
  const on = (t: Tab) => (t === "desk" ? "/pip" : `/pip/${t}`);
  const c = sched?.checkins;

  return (
    <div className="screen" style={{ maxWidth: 1400, margin: "0 auto", width: "100%" }}>
      <div className="profilehead">
        <Avatar look={me.profile.look} mood={mood} size={104} variant="ring" />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ fontSize: 32 }}>{name}</h2>
          <span style={{ fontSize: 14, fontWeight: 800, color: "var(--lilac-soft)" }}>AI companion, not a person · {me.profile.traits.join(" · ") || "warm"}</span>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>Lives on your family’s home server · made by you {me.name ? `(${me.name})` : ""} · {me.parentLabel} is in the loop</div>
        </div>
        <div className="row">
          <button className="callbtn" onClick={() => go("/talk")}>📞 Call</button>
          <button className="btn ghost small" onClick={() => go("/")}>💬 Message</button>
          <button className="btn ghost small" onClick={() => go("/me")}>✏️ Edit</button>
        </div>
      </div>
      {state && <div style={{ maxWidth: 520 }}><EnergyCard energy={state.energy} compact /></div>}
      <div className="chips" role="tablist">
        {tabs.map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} className={`chip ${tab === t ? "on" : ""}`} style={t.endsWith(".md") ? {} : {}} onClick={() => { setTab(t); history.replaceState(null, "", on(t)); }}>{l}</button>)}
      </div>

      {tab === "desk" && <DeskComputer me={me} go={go} />}

      {tab === "scheduled" && (
        <div className="stack" style={{ maxWidth: 760, gap: 12 }}>
          <div className="card">
            <b>On the desk</b>
            {sched?.jobs.length === 0 && <span className="small">Nothing queued. Ask {name} to make something!</span>}
            {sched?.jobs.map((j) => (
              <div key={j.id} className="row" style={{ fontSize: 14, borderTop: "1px solid var(--line-soft)", paddingTop: 6 }}>
                <span>{j.status === "done" ? "✅" : j.status === "working" ? "⏳" : j.status === "failed" ? "⚠️" : "🕒"}</span>
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

      {tab === "soul" && (files ? <div style={{ maxWidth: 820 }}><MdFile name="soul.md" text={files.soul} /></div> : <span className="small">…</span>)}
      {tab === "personality" && (files ? <div style={{ maxWidth: 820 }}><MdFile name="personality.md" text={files.personality} /></div> : <span className="small">…</span>)}
      {tab === "memory" && (files ? (
        <div style={{ maxWidth: 820 }} className="stack">
          <MdFile name="memory.md" text={files.memory} />
          <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => go("/memory")}>Manage memories</button>
        </div>
      ) : <span className="small">…</span>)}
    </div>
  );
}

/** Settings: everything about you and the companion. */
export function Settings({ me, go }: { me: Me; go: (to: string) => void }) {
  const name = me.profile.name;
  const logout = async () => { await api("/auth/logout", { body: {} }).catch(() => undefined); location.href = "/"; };
  const rows: [string, string, string, string][] = [
    ["/pip", "🪪", `${name}’s profile`, "Its desk, what’s scheduled, soul.md, personality.md, memory.md"],
    ["/me", "✨", "Personality", "Name, look, traits and voice"],
    ["/memory", "🧠", `What ${name} remembers`, "See and delete memories; check-ins and notifications"],
    ["/shared", "👀", `What ${me.parentLabel} sees`, "Nothing secret here"],
    ["/google", "☁️", "Google Drive", "Save what you make to your own Drive"],
  ];
  return (
    <div className="screen narrow">
      <span className="hand">yours</span>
      <h2 className="screen-title">Settings</h2>
      {rows.map(([to, ic, t, d]) => (
        <button key={to} className="card" style={{ flexDirection: "row", alignItems: "center", gap: 12, textAlign: "left" }} onClick={() => go(to)}>
          <span style={{ fontSize: 24 }}>{ic}</span><span><b>{t}</b><br /><span className="small">{d}</span></span>
        </button>
      ))}
      <button className="btn ghost small" onClick={logout}>Sign out</button>
      <span className="small">{name} is an AI, not a person. It lives on your family’s home server.</span>
    </div>
  );
}
