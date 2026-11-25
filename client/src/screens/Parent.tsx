import { useCallback, useEffect, useState } from "react";
import { api, type Helpline, type Me, type Profile, type Transparency } from "../api";
import { Avatar } from "../components/Avatar";
import { dayLabel, Toggle, when } from "../components/bits";
import { DeskComputer } from "./DeskComputer";

interface Budgets { weeklyUsd: number; deskSharePercent: number; windowUsd: number; windowHours: number; rolloverCapUsd: number; hardStopUsd: number; lowPowerAtPercent: number; weekResetDay: number }
interface Connection { id: string; kind: string; name: string; enabled: boolean; level: "look" | "act"; url: string; tokenEnv: string; allowedTools: string[]; entities: string[]; sites: string[]; account: string }
interface Settings { budgets: Budgets; quietHours: { start: string; end: string }; maxCheckinsPerDay: number; helplines: Helpline[]; retentionDays: number; connections: Connection[] }
interface Overview {
  energy: { mode: string; percent: number; usd: { week: number; window: number; month: number; deskWeek: number; windowAllowance: number; chatWeekBudget: number }; fullBackAt: number | null; weekResetsAt: number };
  desk: { percent: number; canWork: boolean; usd: { today: number; week: number; allowanceLeft: number; dailySlice: number } };
  split: { chatWeek: number; deskWeek: number; deskDaily: number };
  projection: number;
  lowPower: { week: { share: number; turns: number }; month: { share: number; turns: number } };
  budgets: Budgets;
  spend: { week: { kind: string; bucket: string; usd: number; calls: number }[]; month: { kind: string; bucket: string; usd: number; calls: number }[] };
  settings: Settings;
  status: { apiReady: boolean; reporters: string[]; push: boolean; childPushDevices: number; models: { full: string; low: string; safety: string } };
  childName: string;
  companion: Profile;
}

const $ = (n: number) => `$${n.toFixed(2)}`;
const LEVEL_WORDS: Record<string, string> = { now: "Right now", today: "Today", fyi: "Just so you know" };
const KIND_HELP: Record<string, string> = {
  "home-assistant": "Home Assistant REST API. Only the entities listed below can be seen or changed. Token: a long-lived token from a separate HA user.",
  kin: "Kin's MCP endpoint (e.g. https://kin.example/mcp). Only the tools listed are offered.",
  mcp: "Any MCP server (Streamable HTTP). Only the tools listed are offered.",
  jellyfin: "Jellyfin server URL. 'Can act' lets it make playlists for the account id below.",
  calculator: "Runs on the server. No network.",
  dictionary: "Looks words up at the URL below.",
  web: "Reads pages only from the sites listed. Nothing else on the internet.",
  "google-drive": "Saves what the companion makes into a Kith folder in the child's own Google Drive (drive.file: only files Kith made). The child connects their account on the Google Drive screen. Put your Google email below to get view-only access to the Kith folder; leave it empty to share nothing.",
};

function money(n: number, cap: number) {
  const pct = cap > 0 ? Math.min(100, (n / cap) * 100) : 0;
  return (
    <span className="stack" style={{ gap: 4 }}>
      <span className="spread"><b>{$(n)}</b><span className="small">of {$(cap)}</span></span>
      <span className="bar" style={{ height: 8 }}><span style={{ width: `${pct}%`, background: pct > 85 ? "var(--ember)" : "var(--lilac)" }} /></span>
    </span>
  );
}

function SettingsForm({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const [s, setS] = useState<Settings>(initial);
  const [msg, setMsg] = useState("");
  const b = s.budgets;
  const setB = (k: keyof Budgets, v: number) => setS({ ...s, budgets: { ...b, [k]: v } });
  const setC = (i: number, patch: Partial<Connection>) => setS({ ...s, connections: s.connections.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const list = (v: string) => v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    try {
      await api("/api/parent/settings", { method: "PUT", body: s });
      setMsg("Saved ✓");
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const num = (label: string, k: keyof Budgets, step = 0.5) => (
    <label className="field">{label}<input className="input" type="number" step={step} min={0} value={b[k]} onChange={(e) => setB(k, Number(e.target.value))} /></label>
  );

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="card">
        <b>Budgets</b>
        <span className="small">The monthly cap that really protects you is set on the API organisation in the Anthropic Console (Settings › Limits). Kith stops everything at the hard stop below, a little under that cap. Until then, when Full power runs out it switches to Low power instead of stopping.</span>
        <label className="slider"><span className="ends"><span>Chat and calls {100 - b.deskSharePercent}%</span><span>Desk and Studio {b.deskSharePercent}%</span></span>
          <input type="range" min={0} max={50} value={b.deskSharePercent} aria-label="Split between chat and the desk" style={{ ["--v" as string]: `${b.deskSharePercent * 2}%` }} onChange={(e) => setB("deskSharePercent", Number(e.target.value))} /></label>
        <span className="small">That’s ${(b.weeklyUsd * (1 - b.deskSharePercent / 100)).toFixed(2)} a week for chat and calls, and ${((b.weeklyUsd * b.deskSharePercent) / 100 / 7).toFixed(2)} a day for the desk (unused days roll on within the week).</span>
        <div className="grid2">
          {num("Each week ($)", "weeklyUsd")}
          {num("Full power per window ($)", "windowUsd")}
          {num("Window length (hours)", "windowHours", 1)}
          {num("Max rollover per window ($)", "rolloverCapUsd")}
          {num("Hard stop for the month ($)", "hardStopUsd", 1)}
          {num("Low power below (%)", "lowPowerAtPercent", 1)}
          <label className="field">Energy tops up on
            <select className="select" value={b.weekResetDay} onChange={(e) => setB("weekResetDay", Number(e.target.value))}>
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="card">
        <b>Quiet hours and check-ins</b>
        <div className="grid2">
          <label className="field">Quiet from<input className="input" type="time" value={s.quietHours.start} onChange={(e) => setS({ ...s, quietHours: { ...s.quietHours, start: e.target.value } })} /></label>
          <label className="field">until<input className="input" type="time" value={s.quietHours.end} onChange={(e) => setS({ ...s, quietHours: { ...s.quietHours, end: e.target.value } })} /></label>
          <label className="field">Check-ins per day (max 2)<input className="input" type="number" min={0} max={2} value={s.maxCheckinsPerDay} onChange={(e) => setS({ ...s, maxCheckinsPerDay: Math.min(2, Math.max(0, Number(e.target.value))) })} /></label>
          <label className="field">Keep chats for (days, max 30)<input className="input" type="number" min={1} max={30} value={s.retentionDays} onChange={(e) => setS({ ...s, retentionDays: Math.min(30, Math.max(1, Number(e.target.value))) })} /></label>
        </div>
      </div>

      <div className="card">
        <b>Need a grown-up? numbers</b>
        {s.helplines.map((h, i) => (
          <div key={i} className="grid2">
            <input className="input" aria-label="Name" value={h.name} onChange={(e) => setS({ ...s, helplines: s.helplines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <input className="input" aria-label="Number" value={h.number} onChange={(e) => setS({ ...s, helplines: s.helplines.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)) })} />
            <input className="input" aria-label="Line under it" value={h.sub} onChange={(e) => setS({ ...s, helplines: s.helplines.map((x, j) => (j === i ? { ...x, sub: e.target.value } : x)) })} />
            <span className="row">
              <select className="select" value={h.kind} onChange={(e) => setS({ ...s, helplines: s.helplines.map((x, j) => (j === i ? { ...x, kind: e.target.value as Helpline["kind"] } : x)) })}><option value="helpline">helpline</option><option value="emergency">emergency</option></select>
              <button className="x" aria-label="Remove" onClick={() => setS({ ...s, helplines: s.helplines.filter((_, j) => j !== i) })}>✕</button>
            </span>
          </div>
        ))}
        {s.helplines.length < 6 && <button className="btn ghost small" onClick={() => setS({ ...s, helplines: [...s.helplines, { name: "", number: "", sub: "", kind: "helpline" }] })}>+ number</button>}
      </div>

      <div className="card">
        <b>Connections</b>
        <span className="small">Only you can add or switch these on. Each is “look only” or “can act”. Nothing that spends money, messages people or posts online is ever offered, whatever a connection allows. Tokens live in the server’s environment (the variable named here), never in this page.</span>
        {s.connections.map((c, i) => (
          <details key={c.id} className="card" style={{ background: "var(--card-2)" }}>
            <summary className="spread" style={{ cursor: "pointer" }}><b>{c.enabled ? "🟢" : "⚪️"} {c.name}</b><span className="small">{c.level === "act" ? "can act" : "look only"}</span></summary>
            <span className="small">{KIND_HELP[c.kind]}</span>
            <Toggle label="Switched on" checked={c.enabled} onChange={(v) => setC(i, { enabled: v })} />
            <label className="field">Level
              <select className="select" value={c.level} onChange={(e) => setC(i, { level: e.target.value as Connection["level"] })}><option value="look">Look only</option><option value="act">Can act</option></select>
            </label>
            {!["calculator", "web", "google-drive"].includes(c.kind) && <label className="field">URL<input className="input" value={c.url} onChange={(e) => setC(i, { url: e.target.value })} placeholder="https://" /></label>}
            {["home-assistant", "kin", "mcp", "jellyfin"].includes(c.kind) && <label className="field">Token environment variable<input className="input" value={c.tokenEnv} onChange={(e) => setC(i, { tokenEnv: e.target.value })} /></label>}
            {["kin", "mcp"].includes(c.kind) && <label className="field">Allowed tools (comma-separated)<input className="input" value={c.allowedTools.join(", ")} onChange={(e) => setC(i, { allowedTools: list(e.target.value) })} /></label>}
            {c.kind === "home-assistant" && <label className="field">Their room’s entities (comma-separated)<input className="input" value={c.entities.join(", ")} onChange={(e) => setC(i, { entities: list(e.target.value) })} placeholder="light.bedroom, switch.fairy_lights" /></label>}
            {c.kind === "web" && <label className="field">Allowed sites (comma-separated)<input className="input" value={c.sites.join(", ")} onChange={(e) => setC(i, { sites: list(e.target.value) })} placeholder="bbc.co.uk/bitesize, wikipedia.org" /></label>}
            {c.kind === "google-drive" && <label className="field">Your Google email (view-only access to the Kith folder, optional)<input className="input" value={c.account} onChange={(e) => setC(i, { account: e.target.value })} placeholder="you@gmail.com" /></label>}
            {c.kind === "jellyfin" && <label className="field">Jellyfin user id (for playlists)<input className="input" value={c.account} onChange={(e) => setC(i, { account: e.target.value })} /></label>}
          </details>
        ))}
      </div>
      <div className="row"><button className="btn primary" onClick={save}>Save settings</button><span className="small" aria-live="polite">{msg}</span></div>
    </div>
  );
}

/** The grown-up's view: money, reports, the weekly summary, the desk and settings. No everyday chats. */
export function Parent({ me }: { me: Me }) {
  const [o, setO] = useState<Overview | null>(null);
  const [t, setT] = useState<Transparency | null>(null);
  const [tab, setTab] = useState<"overview" | "desk" | "settings">("overview");
  const [testMsg, setTestMsg] = useState("");
  const load = useCallback(() => {
    api<Overview>("/api/parent/overview").then(setO).catch(() => undefined);
    api<Transparency>("/api/transparency").then(setT).catch(() => undefined);
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 30_000); return () => clearInterval(i); }, [load]);
  const test = async () => {
    setTestMsg("Sending…");
    try { const r = await api<{ ok: boolean }>("/api/parent/test-report", { body: {} }); setTestMsg(r.ok ? "Delivered ✓" : "It didn’t get through: check the reporter settings."); } catch (e) { setTestMsg((e as Error).message); }
  };
  const logout = async () => { await api("/auth/logout", { body: {} }).catch(() => undefined); location.href = "/"; };
  const cname = o?.childName || "your child";
  const comp = o?.companion ?? me.profile;
  const meChild: Me = { ...me, profile: comp };

  return (
    <div className="main">
      <div className="screen" style={{ maxWidth: 980, margin: "0 auto", width: "100%" }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <div className="row">
            <Avatar look={comp.look} size={52} variant="ring" />
            <div><span className="hand" style={{ fontSize: 20 }}>parent view</span><h2 style={{ fontSize: 26 }}>{comp.name}, with {cname}</h2></div>
          </div>
          <button className="btn ghost small" onClick={logout}>Sign out</button>
        </div>
        <span className="small">You see money, reports (which {cname} was told about first), the weekly summary you both see, the desk, and the tools {comp.name} used. You don’t see everyday chats.</span>
        <div className="chips" role="tablist">
          {(["overview", "desk", "settings"] as const).map((x) => <button key={x} role="tab" aria-selected={tab === x} className={`chip ${tab === x ? "on" : ""}`} onClick={() => setTab(x)}>{x === "overview" ? "Overview" : x === "desk" ? `${comp.name}’s desk` : "Settings"}</button>)}
        </div>

        {tab === "overview" && o && (
          <>
            {!o.status.apiReady && <div className="notice" style={{ alignSelf: "stretch" }}>No Anthropic API key is set, so {comp.name} can’t think yet. See docs/setup.md.</div>}
            <div className="grid2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <div className="card"><span className="eyebrow">Chat this week</span>{money(o.energy.usd.week, o.split.chatWeek)}<span className="small">{cname} sees: {o.energy.mode === "full" ? "🔥 Full power" : o.energy.mode === "low" ? "🔋 Low power" : "😴 Resting"}, {o.energy.percent}%</span></div>
              <div className="card"><span className="eyebrow">Last {o.budgets.windowHours} hours</span>{money(o.energy.usd.window, o.energy.usd.windowAllowance)}<span className="small">incl. rollover from quieter windows</span></div>
              <div className="card"><span className="eyebrow">Desk this week</span>{money(o.desk.usd.week, o.split.deskWeek)}<span className="small">${o.desk.usd.today.toFixed(2)} today · slice ${o.split.deskDaily.toFixed(2)}/day</span></div>
              <div className="card"><span className="eyebrow">This month</span>{money(o.energy.usd.month, o.budgets.hardStopUsd)}<span className="small">On track for about ${o.projection.toFixed(2)} · hard stop ${o.budgets.hardStopUsd}</span></div>
              <div className="card"><span className="eyebrow">Low power</span><b>{Math.round(o.lowPower.week.share * 100)}% of turns this week</b><span className="small">{Math.round(o.lowPower.month.share * 100)}% this month ({o.lowPower.month.turns} turns)</span></div>
            </div>
            <div className="card">
              <b>Where it went this month</b>
              <table className="money"><thead><tr><th>What</th><th>Budget</th><th className="n">Calls</th><th className="n">Cost</th></tr></thead>
                <tbody>{o.spend.month.map((r) => <tr key={r.kind + r.bucket}><td>{r.kind}</td><td>{r.bucket}</td><td className="n">{r.calls}</td><td className="n">{$(r.usd)}</td></tr>)}</tbody>
              </table>
              <span className="small">Models: {o.status.models.full} (Full power), {o.status.models.low} (Low power), {o.status.models.safety} (safety check).</span>
            </div>
            <div className="card">
              <div className="spread"><b>Reports</b><span className="row"><button className="btn ghost small" onClick={test}>Send a test report</button><span className="small">{testMsg}</span></span></div>
              <span className="small">Reporters: {o.status.reporters.join(", ")}. {cname} is always told first, and sees this same list.</span>
              {t?.reports.length === 0 && <span className="small">No reports.</span>}
              {t?.reports.map((r) => (
                <div key={r.id} className="stack" style={{ gap: 2, borderTop: "1px solid var(--line-soft)", paddingTop: 8 }}>
                  <span className="spread"><span className={`level ${r.level}`}>{LEVEL_WORDS[r.level] ?? r.level}</span><span className="small">{dayLabel(r.ts)} {when(r.ts)} · {r.status}</span></span>
                  <span style={{ fontSize: 14 }}>{r.parentText}</span>
                </div>
              ))}
            </div>
            <div className="card">
              <b>Weekly summaries (you both see these)</b>
              {t?.summaries.length === 0 && <span className="small">The first one arrives on Sunday evening.</span>}
              {t?.summaries.map((s) => <div key={s.week_start}><span className="small">Week of {s.week_start}</span><div style={{ fontSize: 14.5 }}>{s.text}</div></div>)}
            </div>
            <div className="card">
              <b>Tools used</b>
              {t?.toolLog.length === 0 && <span className="small">None yet.</span>}
              <table className="money"><tbody>{t?.toolLog.slice(0, 50).map((l) => <tr key={l.id}><td>{when(l.ts)}</td><td>{l.connection}</td><td>{l.tool}</td><td>{l.level}</td><td title={l.result}>{l.ok ? "ok" : "failed"}</td></tr>)}</tbody></table>
            </div>
            <div className="card">
              <b>Status</b>
              <span className="small">Check-in notifications: {o.status.push ? `ready, ${o.status.childPushDevices} device(s)` : "not set up (VAPID keys)"}.</span>
            </div>
          </>
        )}
        {tab === "desk" && <DeskComputer me={meChild} canEdit={false} />}
        {tab === "settings" && o && <SettingsForm initial={o.settings} onSaved={load} />}
      </div>
    </div>
  );
}
