import { Icon, IL, type IconName } from "../components/Icons";
import { useCallback, useEffect, useState } from "react";
import { api, type Helpline, type Me, type Profile, type Transparency } from "../api";
import { Avatar } from "../components/Avatar";
import { dayLabel, Toggle, when } from "../components/bits";
import { DeskComputer } from "./DeskComputer";

interface Budgets { weeklyUsd: number; deskSharePercent: number; windowUsd: number; windowHours: number; rolloverCapUsd: number; hardStopUsd: number; lowPowerAtPercent: number; weekResetDay: number }
interface Connection { id: string; kind: string; name: string; enabled: boolean; level: "look" | "act"; url: string; tokenEnv: string; allowedTools: string[]; entities: string[]; sites: string[]; account: string }
type Category = "adult" | "gambling" | "dating" | "social" | "harm" | "proxies";
interface BrowserSettings { enabled: boolean; mode: "blocklist" | "safelist"; sites: string[]; assetHosts: string[]; blocked: string[]; categories: Category[]; blockLists: string[]; search: "bing" | "duckduckgo" | "wikipedia" | "brave" }
const CATEGORIES: [Category, string][] = [
  ["adult", "Adult and explicit"], ["gambling", "Gambling"], ["dating", "Dating"], ["social", "Social media and stranger chat"],
  ["harm", "Weapons, drugs, gore and self-harm"], ["proxies", "Proxies, VPNs and ways around filters"],
];
interface Settings { budgets: Budgets; quietHours: { start: string; end: string }; maxCheckinsPerDay: number; helplines: Helpline[]; retentionDays: number; connections: Connection[]; browser: BrowserSettings; safeguards: string }
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

interface KeyStatus { set: boolean; source: "parent view" | "environment" | "none"; hint: string; canStore: boolean }

/** The Anthropic API key: typed in here, checked with Anthropic, stored encrypted on the server, never shown again. */
function ApiKeyCard({ onChanged }: { onChanged: () => void }) {
  const [st, setSt] = useState<KeyStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { api<KeyStatus>("/api/parent/apikey").then(setSt).catch(() => undefined); }, []);
  const save = async () => {
    setBusy(true); setMsg("Checking the key with Anthropic…");
    try { setSt(await api<KeyStatus>("/api/parent/apikey", { method: "PUT", body: { key: key.trim() } })); setKey(""); setMsg("Saved. Pip can think now."); onChanged(); }
    catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const remove = async () => {
    if (!confirm("Remove the key saved here?")) return;
    try { setSt(await api<KeyStatus>("/api/parent/apikey", { method: "DELETE" })); setMsg("Removed."); onChanged(); } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section className="card psec" id="set-claude">
      <h3 className="psec-h"><span className="psec-ic"><Icon name="sparkle" size={18} /></span>Claude (Anthropic API key)</h3>
      <span className="small">Make the key on an API organisation in the Anthropic Console (Settings › API keys), and set a monthly limit there too. The key is checked with Anthropic, stored encrypted on your home server, and never shown again, only its last four characters.</span>
      <div className="pkey-status">
        <span className={`pcheck-dot ${st?.set ? "ok" : ""}`}><Icon name={st?.set ? "check" : "warn"} size={14} /></span>
        <span>{!st ? "…" : st.set ? <>Key {st.hint} is set <span className="small">({st.source === "parent view" ? "saved here" : "from the server’s environment"})</span></> : "No key yet, so Pip can’t think."}</span>
        {st?.source === "parent view" && <button className="btn ghost small" style={{ marginLeft: "auto" }} onClick={remove}>Remove</button>}
      </div>
      {st && !st.canStore ? (
        <div className="pwarn"><Icon name="warn" size={18} /><span>To save a key here, the server needs <b>KITH_SECRET_KEY</b> first (64 hex characters: <code>openssl rand -hex 32</code>). See docs/setup.md.</span></div>
      ) : (
        <form className="row" style={{ flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); if (key.trim()) void save(); }}>
          <input className="input" type="password" autoComplete="off" spellCheck={false} aria-label="Anthropic API key" placeholder={st?.set ? "Paste a new key to replace it" : "sk-ant-…"}
            value={key} onChange={(e) => setKey(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <button className="btn primary small" type="submit" disabled={busy || !key.trim()}>{busy ? "Checking…" : st?.set ? "Replace key" : "Save key"}</button>
        </form>
      )}
      {msg && <span className="small" aria-live="polite">{msg}</span>}
    </section>
  );
}

function SettingsForm({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const [s, setS] = useState<Settings>(initial);
  const setWeb = (patch: Partial<BrowserSettings>) => setS((x) => ({ ...x, browser: { ...x.browser, ...patch } }));
  const [msg, setMsg] = useState("");
  const [builtIn, setBuiltIn] = useState("");
  useEffect(() => { api<{ builtIn: string }>("/api/parent/safeguards").then((r) => setBuiltIn(r.builtIn)).catch(() => undefined); }, []);
  const b = s.budgets;
  const setB = (k: keyof Budgets, v: number) => setS({ ...s, budgets: { ...b, [k]: v } });
  const setC = (i: number, patch: Partial<Connection>) => setS({ ...s, connections: s.connections.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const list = (v: string) => v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const save = async () => {
    try {
      await api("/api/parent/settings", { method: "PUT", body: s });
      setMsg("Saved.");
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const num = (label: string, k: keyof Budgets, step = 0.5) => (
    <label className="field">{label}<input className="input" type="number" step={step} min={0} value={b[k]} onChange={(e) => setB(k, Number(e.target.value))} /></label>
  );

  return (
    <div className="psettings">
      <nav className="psec-nav" aria-label="Settings sections">
        {([["set-claude", "sparkle", "Claude"], ["set-budgets", "fire", "Budgets"], ["set-quiet", "moon", "Quiet hours"], ["set-help", "phone", "Grown-up? numbers"], ["set-safeguards", "shield", "Safeguards"], ["set-browser", "compass", "Browser"], ["set-connections", "home", "Connections"]] as const).map(([id, ic, l]) => (
          <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}><Icon name={ic} size={16} />{l}</a>
        ))}
      </nav>
      <div className="psec-list">
        <ApiKeyCard onChanged={onSaved} />
      <section className="card psec" id="set-budgets">
        <h3 className="psec-h"><span className="psec-ic"><Icon name="fire" size={18} /></span>Budgets</h3>
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
      </section>

      <section className="card psec" id="set-quiet">
        <h3 className="psec-h"><span className="psec-ic"><Icon name="moon" size={18} /></span>Quiet hours and check-ins</h3>
        <div className="grid2">
          <label className="field">Quiet from<input className="input" type="time" value={s.quietHours.start} onChange={(e) => setS({ ...s, quietHours: { ...s.quietHours, start: e.target.value } })} /></label>
          <label className="field">until<input className="input" type="time" value={s.quietHours.end} onChange={(e) => setS({ ...s, quietHours: { ...s.quietHours, end: e.target.value } })} /></label>
          <label className="field">Check-ins per day (max 2)<input className="input" type="number" min={0} max={2} value={s.maxCheckinsPerDay} onChange={(e) => setS({ ...s, maxCheckinsPerDay: Math.min(2, Math.max(0, Number(e.target.value))) })} /></label>
          <label className="field">Keep chats for (days, max 30)<input className="input" type="number" min={1} max={30} value={s.retentionDays} onChange={(e) => setS({ ...s, retentionDays: Math.min(30, Math.max(1, Number(e.target.value))) })} /></label>
        </div>
      </section>

      <section className="card psec" id="set-help">
        <h3 className="psec-h"><span className="psec-ic"><Icon name="phone" size={18} /></span>Grown-up? numbers</h3>
        {s.helplines.map((h, i) => (
          <div key={i} className="grid2">
            <input className="input" aria-label="Name" value={h.name} onChange={(e) => setS({ ...s, helplines: s.helplines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <input className="input" aria-label="Number" value={h.number} onChange={(e) => setS({ ...s, helplines: s.helplines.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)) })} />
            <input className="input" aria-label="Line under it" value={h.sub} onChange={(e) => setS({ ...s, helplines: s.helplines.map((x, j) => (j === i ? { ...x, sub: e.target.value } : x)) })} />
            <span className="row">
              <select className="select" value={h.kind} onChange={(e) => setS({ ...s, helplines: s.helplines.map((x, j) => (j === i ? { ...x, kind: e.target.value as Helpline["kind"] } : x)) })}><option value="helpline">helpline</option><option value="emergency">emergency</option></select>
              <button className="x" aria-label="Remove" onClick={() => setS({ ...s, helplines: s.helplines.filter((_, j) => j !== i) })}><Icon name="close" size={16} /></button>
            </span>
          </div>
        ))}
        {s.helplines.length < 6 && <button className="btn ghost small" onClick={() => setS({ ...s, helplines: [...s.helplines, { name: "", number: "", sub: "", kind: "helpline" }] })}>+ number</button>}
      </section>

      <section className="card psec" id="set-safeguards">
        <h3 className="psec-h"><span className="psec-ic"><Icon name="shield" size={18} /></span>Safeguards</h3>
        <span className="small">These always come first, ahead of the soul, personality and memory your child writes, and nothing they write can override them. They aren’t shown on your child’s profile; it just says safety rules sit underneath. The safety check on every message runs separately as well.</span>
        <details><summary className="small" style={{ cursor: "pointer" }}>Built-in safeguards (always on)</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, color: "var(--text-3)", fontFamily: "var(--sans)" }}>{builtIn}</pre>
        </details>
        <label className="field">Family safeguards you add (they apply just as strictly)
          <textarea className="textarea" style={{ minHeight: 120 }} maxLength={4000} value={s.safeguards} onChange={(e) => setS({ ...s, safeguards: e.target.value })}
            placeholder={"e.g.\n- Only your bedroom lights, never other rooms.\n- No horror stories after 8pm.\n- Encourage time outside at weekends."} />
        </label>
      </section>

      <section className="card psec" id="set-browser">
        <h3 className="psec-h"><span className="psec-ic"><Icon name="compass" size={18} /></span>The desk’s browser</h3>
        <span className="small">A real browser with tabs, kept cookies and site data. On its own, Pip only reads pages for tasks your child asked for: it never types, signs in or downloads, and it stops at robot checks (CAPTCHAs) without trying to get past them. When you or your child take over, you can click, type and use tabs, but signing in is blocked. Every page is logged, safety-checked and can be watched live, and the proxy on the server applies the same rules again.</span>
        <Toggle label="Browsing switched on" checked={s.browser.enabled} onChange={(v) => setWeb({ enabled: v })} />
        <button className="btn ghost small" onClick={async () => { if (confirm("Clear the desk browser’s saved data? Sites will forget their settings, and open tabs close.")) { try { await api("/api/parent/browser/clear", { body: {} }); setMsg("The desk browser’s saved data is cleared."); } catch (e) { setMsg((e as Error).message); } } }}>Clear saved data (cookies, site data, history)</button>
        <label className="field">What it can reach
          <select className="select" value={s.browser.mode} onChange={(e) => setWeb({ mode: e.target.value as BrowserSettings["mode"] })}>
            <option value="blocklist">The whole web, except what’s blocked (recommended)</option>
            <option value="safelist">Only the favourite sites below</option>
          </select></label>
        {s.browser.mode === "blocklist" && (
          <>
            <b style={{ fontSize: 14 }}>Always blocked</b>
            {CATEGORIES.map(([k, label]) => (
              <Toggle key={k} label={label} checked={s.browser.categories.includes(k)}
                onChange={(v) => setWeb({ categories: v ? [...s.browser.categories, k] : s.browser.categories.filter((c) => c !== k) })} />
            ))}
            <label className="field">Your own blocked sites (one per line; subdomains are blocked too)
              <textarea className="textarea" value={s.browser.blocked.join("\n")} onChange={(e) => setWeb({ blocked: list(e.target.value) })} /></label>
            <label className="field">Public block lists, fetched daily (hosts-file format)
              <textarea className="textarea" value={s.browser.blockLists.join("\n")} onChange={(e) => setWeb({ blockLists: list(e.target.value) })} /></label>
          </>
        )}
        <label className="field">{s.browser.mode === "safelist" ? "Safe list" : "Favourite sites (searched first, never blocked by a public list)"} (one per line; a path limits it, e.g. www.bbc.co.uk/bitesize)
          <textarea className="textarea" value={s.browser.sites.join("\n")} onChange={(e) => setWeb({ sites: list(e.target.value) })} /></label>
        {s.browser.mode === "safelist" && (
          <label className="field">Image and style hosts those sites need (no scripts ever load)
            <textarea className="textarea" value={s.browser.assetHosts.join("\n")} onChange={(e) => setWeb({ assetHosts: list(e.target.value) })} /></label>
        )}
        <label className="field">Search
          <select className="select" value={s.browser.search} onChange={(e) => setWeb({ search: e.target.value as BrowserSettings["search"] })}>
            <option value="bing">Bing, SafeSearch strict (no key needed)</option>
            <option value="duckduckgo">DuckDuckGo, SafeSearch strict (often blocks servers with a robot check)</option>
            <option value="brave">Brave Search, SafeSearch strict (needs KITH_BRAVE_API_KEY)</option>
            <option value="wikipedia">Wikipedia’s own search only</option>
          </select></label>
      </section>

      <section className="card psec" id="set-connections">
        <h3 className="psec-h"><span className="psec-ic"><Icon name="home" size={18} /></span>Connections</h3>
        <span className="small">Only you can add or switch these on. Each is “look only” or “can act”. Nothing that spends money, messages people or posts online is ever offered, whatever a connection allows. Tokens live in the server’s environment (the variable named here), never in this page.</span>
        {s.connections.map((c, i) => (
          <details key={c.id} className="card" style={{ background: "var(--card-2)" }}>
            <summary className="spread" style={{ cursor: "pointer" }}><b className="il"><span className={`onoff ${c.enabled ? "on" : ""}`} aria-label={c.enabled ? "on" : "off"} />{c.name}</b><span className="small">{c.level === "act" ? "can act" : "look only"}</span></summary>
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
      </section>
      </div>
      <div className="psave"><span className="small" aria-live="polite">{msg || "Changes are saved when you press Save."}</span><button className="btn primary" onClick={save}>Save settings</button></div>
    </div>
  );
}

type PTab = "overview" | "reports" | "desk" | "settings";
const PNAV: [PTab, IconName, string][] = [["overview", "home", "Overview"], ["reports", "bell", "Reports"], ["desk", "desk", "Desk"], ["settings", "settings", "Settings"]];

function Tile({ icon, label, value, cap, sub }: { icon: IconName; label: string; value: number; cap: number; sub: React.ReactNode }) {
  const pct = cap > 0 ? Math.min(100, (value / cap) * 100) : 0;
  return (
    <div className="card ptile">
      <span className="ptile-h"><span className="psec-ic"><Icon name={icon} size={16} /></span>{label}</span>
      <span className="ptile-v">{$(value)}<small> of {$(cap)}</small></span>
      <span className="bar" style={{ height: 6 }}><span style={{ width: `${pct}%`, background: pct > 85 ? "var(--ember)" : "var(--lilac)" }} /></span>
      <span className="small">{sub}</span>
    </div>
  );
}

/** The grown-up's view: money, reports, the weekly summary, the desk and settings. No everyday chats. */
export function Parent({ me }: { me: Me }) {
  const [o, setO] = useState<Overview | null>(null);
  const [t, setT] = useState<Transparency | null>(null);
  const [tab, setTab] = useState<PTab>("overview");
  const [testMsg, setTestMsg] = useState("");
  const load = useCallback(() => {
    api<Overview>("/api/parent/overview").then(setO).catch(() => undefined);
    api<Transparency>("/api/transparency").then(setT).catch(() => undefined);
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 30_000); return () => clearInterval(i); }, [load]);
  const test = async () => {
    setTestMsg("Sending…");
    try { const r = await api<{ ok: boolean }>("/api/parent/test-report", { body: {} }); setTestMsg(r.ok ? "Delivered." : "It didn’t get through: check the reporter settings."); } catch (e) { setTestMsg((e as Error).message); }
  };
  const logout = async () => { const r = await api<{ redirect?: string | null }>("/auth/logout", { body: {} }).catch(() => ({ redirect: null })); location.href = r.redirect || "/"; };
  const cname = o?.childName || "your child";
  const comp = o?.companion ?? me.profile;
  const meChild: Me = { ...me, profile: comp };
  const mode = o?.energy.mode ?? "full";
  const powerIcon: IconName = mode === "full" ? "fire" : mode === "low" ? "battery" : "moon";
  const powerWord = mode === "full" ? "Full power" : mode === "low" ? "Low power" : "Resting";
  const nowReports = (t?.reports ?? []).filter((r) => r.level === "now").length;
  const checks: [boolean, string, string][] = o ? [
    [o.status.apiReady, "Thinking", o.status.apiReady ? `${o.status.models.full} and ${o.status.models.low}` : "Add the Anthropic API key in Settings"],
    [o.status.reporters.length > 0, "Reports reach you", o.status.reporters.length ? o.status.reporters.join(", ") : "No reporter set up"],
    [o.status.push, "Notifications", o.status.push ? `${o.status.childPushDevices} device(s) signed up` : "VAPID keys not set"],
  ] : [];
  const monthPct = o ? Math.min(100, (o.energy.usd.month / Math.max(0.01, o.budgets.hardStopUsd)) * 100) : 0;
  const projPct = o ? Math.min(100, (o.projection / Math.max(0.01, o.budgets.hardStopUsd)) * 100) : 0;

  const reports = (
    <div className="card">
      <div className="spread"><h3 className="psec-h"><span className="psec-ic"><Icon name="bell" size={18} /></span>Reports</h3>
        <span className="row" style={{ gap: 8 }}><span className="small">{testMsg}</span><button className="btn ghost small" onClick={test}>Send a test</button></span></div>
      <span className="small">{cname} is always told first, and sees this same list.</span>
      {t?.reports.length === 0 && <div className="pempty-state"><Icon name="check" size={22} /><span>Nothing to report. That’s good.</span></div>}
      {t?.reports.map((r) => (
        <div key={r.id} className="preport">
          <span className={`level ${r.level}`}>{LEVEL_WORDS[r.level] ?? r.level}</span>
          <span style={{ flex: 1, fontSize: 14 }}>{r.parentText}</span>
          <span className="small" style={{ whiteSpace: "nowrap" }}>{dayLabel(r.ts)} {when(r.ts)} · {r.status}</span>
        </div>
      ))}
    </div>
  );
  const summaries = (
    <div className="card">
      <h3 className="psec-h"><span className="psec-ic"><Icon name="scroll" size={18} /></span>Weekly summary</h3>
      <span className="small">You and {cname} both see these.</span>
      {t?.summaries.length === 0 && <div className="pempty-state"><Icon name="calendar" size={22} /><span>The first one arrives on Sunday evening.</span></div>}
      {t?.summaries.map((s) => <div key={s.week_start} className="psummary"><span className="eyebrow">Week of {s.week_start}</span><div>{s.text}</div></div>)}
    </div>
  );

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Parent sections">
        <div className="me brand"><img src="/icon-192.png" alt="" width={44} height={44} /><span><b>Kith</b><span className="small">parent view</span></span></div>
        {PNAV.map(([k, ic, l]) => (
          <button key={k} className={`navbtn ${tab === k ? "on" : ""}`} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>
            <span className="ic"><Icon name={ic} on={tab === k} size={22} /></span>{k === "desk" ? `${comp.name}’s desk` : l}{k === "reports" && nowReports > 0 && <span className="pbadge">{nowReports}</span>}
          </button>
        ))}
        <div className="foot">
          <span className="small">You see money, reports, the weekly summary, the desk and the tools {comp.name} used. Never everyday chats.</span>
          <button className="btn ghost block" onClick={logout}>Sign out</button>
        </div>
      </nav>
      <div className="main">
        <header className="phead">
          <span className="phead-dp"><Avatar look={comp.look} size={56} variant="ring" mood={mode === "low" ? "sleepy" : mode === "resting" ? "resting" : "happy"} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="hand" style={{ fontSize: 20 }}>parent view</span>
            <h2>{comp.name}<span className="pwith">, with {cname}</span></h2>
          </div>
          {o && <span className={`ppower ${mode}`}><Icon name={powerIcon} size={16} /><span className="pw">{powerWord} · </span>{o.energy.percent}%</span>}
          <button className="btn ghost small mobile-only" onClick={logout}>Sign out</button>
        </header>
        <div className="chips ptabs mobile-only" role="tablist">
          {PNAV.map(([k, ic, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`chip ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}><IL i={ic}>{k === "desk" ? "Desk" : l}</IL></button>)}
        </div>
        <div className="screen pscreen-parent">
          {tab === "overview" && o && (
            <>
              {!o.status.apiReady && <div className="pwarn"><Icon name="warn" size={18} /><span style={{ flex: 1 }}>No Anthropic API key is set, so {comp.name} can’t think yet.</span><button className="btn primary small" onClick={() => { setTab("settings"); setTimeout(() => document.getElementById("set-claude")?.scrollIntoView({ behavior: "smooth" }), 80); }}>Add the key</button></div>}
              <div className="phero">
                <div className="card phero-main">
                  <span className="ptile-h"><span className="psec-ic"><Icon name="calendar" size={16} /></span>This month</span>
                  <span className="phero-v">{$(o.energy.usd.month)}<small> of {$(o.budgets.hardStopUsd)} hard stop</small></span>
                  <span className="pmeter" aria-label={`Spent ${Math.round(monthPct)}% of the month’s hard stop; on track for ${Math.round(projPct)}%`}>
                    <span className="pmeter-proj" style={{ width: `${projPct}%` }} />
                    <span className="pmeter-fill" style={{ width: `${monthPct}%` }} />
                  </span>
                  <span className="small">On track for about <b>{$(o.projection)}</b> this month. Everything rests at the hard stop; until then, Full power switches to Low power instead of stopping.</span>
                </div>
                <div className="card pchecks">
                  <h3 className="psec-h"><span className="psec-ic"><Icon name="check" size={18} /></span>Set-up</h3>
                  {checks.map(([ok, l, d]) => (
                    <div key={l} className="pcheck"><span className={`pcheck-dot ${ok ? "ok" : ""}`}><Icon name={ok ? "check" : "warn"} size={14} /></span><span><b>{l}</b><br /><span className="small">{d}</span></span></div>
                  ))}
                </div>
              </div>
              <div className="ptiles">
                <Tile icon="chat2" label="Chat this week" value={o.energy.usd.week} cap={o.split.chatWeek} sub={<>{cname} sees {powerWord}, {o.energy.percent}%</>} />
                <Tile icon="clock" label={`Last ${o.budgets.windowHours} hours`} value={o.energy.usd.window} cap={o.energy.usd.windowAllowance} sub="incl. rollover from quieter windows" />
                <Tile icon="desk" label="Desk this week" value={o.desk.usd.week} cap={o.split.deskWeek} sub={<>{$(o.desk.usd.today)} today · {$(o.split.deskDaily)} a day</>} />
                <div className="card ptile">
                  <span className="ptile-h"><span className="psec-ic"><Icon name="battery" size={16} /></span>Low power</span>
                  <span className="ptile-v">{Math.round(o.lowPower.week.share * 100)}%<small> of turns this week</small></span>
                  <span className="bar" style={{ height: 6 }}><span style={{ width: `${Math.round(o.lowPower.week.share * 100)}%`, background: "var(--sky, #9CC2E8)" }} /></span>
                  <span className="small">{Math.round(o.lowPower.month.share * 100)}% this month ({o.lowPower.month.turns} turns)</span>
                </div>
              </div>
              <div className="pcols">
                <div className="stack" style={{ gap: 16 }}>{reports}{summaries}</div>
                <div className="stack" style={{ gap: 16 }}>
                  <div className="card">
                    <h3 className="psec-h"><span className="psec-ic"><Icon name="scroll" size={18} /></span>Where it went this month</h3>
                    {o.spend.month.length === 0 ? <div className="pempty-state"><Icon name="sparkle" size={22} /><span>Nothing spent yet.</span></div> : (
                      <table className="money"><thead><tr><th>What</th><th>Budget</th><th className="n">Calls</th><th className="n">Cost</th></tr></thead>
                        <tbody>{o.spend.month.map((r) => <tr key={r.kind + r.bucket}><td>{r.kind}</td><td>{r.bucket}</td><td className="n">{r.calls}</td><td className="n">{$(r.usd)}</td></tr>)}</tbody>
                      </table>
                    )}
                  </div>
                  <div className="card">
                    <h3 className="psec-h"><span className="psec-ic"><Icon name="home" size={18} /></span>Tools {comp.name} used</h3>
                    {t?.toolLog.length === 0 ? <div className="pempty-state"><Icon name="check" size={22} /><span>None yet.</span></div> : (
                      <table className="money"><tbody>{t?.toolLog.slice(0, 50).map((l) => <tr key={l.id}><td>{when(l.ts)}</td><td>{l.connection}</td><td>{l.tool}</td><td>{l.level}</td><td title={l.result}>{l.ok ? "ok" : "failed"}</td></tr>)}</tbody></table>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
          {tab === "reports" && <div className="pcols">{reports}{summaries}</div>}
          {tab === "desk" && <DeskComputer me={meChild} canEdit={false} />}
          {tab === "settings" && o && <SettingsForm initial={o.settings} onSaved={load} />}
        </div>
      </div>
    </div>
  );
}
