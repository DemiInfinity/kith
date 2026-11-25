import { Icon, IL, type IconName } from "../components/Icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Helpline, type Me, type Profile, type Transparency } from "../api";
import { Avatar } from "../components/Avatar";
import { dayLabel, Toggle, when } from "../components/bits";
import { DeskComputer } from "./DeskComputer";
import { disablePush, enablePush, pushStatus } from "../lib/push";
import { ParentSkills } from "./ParentSkills";
import { isMacApp } from "../lib/native";
import { ParentHelp } from "./HelpCentre";

interface Budgets { weeklyUsd: number; deskSharePercent: number; windowUsd: number; windowHours: number; rolloverCapUsd: number; hardStopUsd: number; lowPowerAtPercent: number; weekResetDay: number }
interface Connection { id: string; kind: "home-assistant" | "kin" | "jellyfin" | "calculator" | "dictionary" | "web" | "mcp" | "google-drive"; name: string; enabled: boolean; level: "look" | "act"; url: string; tokenEnv: string; allowedTools: string[]; entities: string[]; sites: string[]; account: string; features?: { edit: boolean; calendar: boolean; tasks: boolean } }
type Category = "adult" | "gambling" | "dating" | "social" | "harm" | "proxies";
interface BrowserSettings { enabled: boolean; mode: "blocklist" | "safelist"; sites: string[]; assetHosts: string[]; blocked: string[]; categories: Category[]; blockLists: string[]; search: "bing" | "duckduckgo" | "wikipedia" | "brave" }
const CATEGORIES: [Category, string][] = [
  ["adult", "Adult and explicit"], ["gambling", "Gambling"], ["dating", "Dating"], ["social", "Social media and stranger chat"],
  ["harm", "Weapons, drugs, gore and self-harm"], ["proxies", "Proxies, VPNs and ways around filters"],
];
interface VoiceS { sttHost: string; sttPort: number; ttsHost: string; ttsPort: number; whisperModel: string; voices: { label: string; voice: string }[] }
interface DiskS { totalGb: number; deskGb: number; keepDays: number }
interface DiskUsage { data: number; desk: { items: number; trash: number; screenshots: number; browser: number; total: number } | null; total: number; totalCap: number; deskCap: number; keepDays: number; overTotal: boolean; overDesk: boolean }
const gb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0, n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`);

function StorageBars({ u }: { u: DiskUsage }) {
  const pct = (a: number, b: number) => `${Math.min(100, (a / Math.max(1, b)) * 100)}%`;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <span className="spread"><b>{gb(u.total)}</b><span className="small">of {gb(u.totalCap)} in total</span></span>
      <span className="bar" style={{ height: 8 }}><span style={{ width: pct(u.total, u.totalCap), background: u.overTotal ? "var(--ember)" : "var(--lilac)" }} /></span>
      {u.desk && <>
        <span className="spread"><span className="small">Desk files</span><span className="small">{gb(u.desk.items)} of {gb(u.deskCap)}</span></span>
        <span className="bar" style={{ height: 6 }}><span style={{ width: pct(u.desk.items, u.deskCap), background: u.overDesk ? "var(--ember)" : "var(--sky, #9CC2E8)" }} /></span>
      </>}
      <span className="small">Kith’s data {gb(u.data)}{u.desk ? ` · desk files ${gb(u.desk.items)} · trash ${gb(u.desk.trash)} · browser data ${gb(u.desk.browser)}` : " · desk not reachable right now"}. Trash goes after {u.keepDays} days.</span>
      {(u.overTotal || u.overDesk) && <div className="pwarn"><Icon name="warn" size={18} /><span>{u.overDesk ? "The desk’s files have reached their limit" : "Kith has reached its disk budget"}, so new desk work waits. Delete things on the desk, or raise the limit below.</span></div>}
    </div>
  );
}

function VoiceCheck({ v }: { v: VoiceS }) {
  const [r, setR] = useState<{ setup: { sttHost: string; sttPort: number; ttsHost: string; ttsPort: number; envWhisperModel: string }; stt: { ok: boolean; installed: string[]; error?: string }; tts: { ok: boolean; installed: string[]; error?: string } } | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => { setBusy(true); try { setR(await api("/api/parent/voice")); } catch { setR(null); } setBusy(false); };
  const loaded = r?.stt.installed ?? [];
  const mismatch = r?.stt.ok && v.whisperModel && !loaded.includes(v.whisperModel);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <button type="button" className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={check} disabled={busy}><IL i="speaker">{busy ? "Checking…" : "Check the voice servers"}</IL></button>
      {r && <>
        <div className="pcheck"><span className={`pcheck-dot ${r.stt.ok ? "ok" : ""}`}><Icon name={r.stt.ok ? "check" : "warn"} size={14} /></span><span><b>Listening</b> ({r.setup.sttHost}:{r.setup.sttPort})<br /><span className="small">{r.stt.ok ? `Model loaded: ${loaded.join(", ") || "unknown"}` : r.stt.error}</span></span></div>
        <div className="pcheck"><span className={`pcheck-dot ${r.tts.ok ? "ok" : ""}`}><Icon name={r.tts.ok ? "check" : "warn"} size={14} /></span><span><b>Speaking</b> ({r.setup.ttsHost}:{r.setup.ttsPort})<br /><span className="small">{r.tts.ok ? `${r.tts.installed.length} English voices available` : r.tts.error}</span></span></div>
        {mismatch && <div className="pwarn"><Icon name="warn" size={18} /><span>The listening server has <b>{loaded.join(", ")}</b> loaded, not {v.whisperModel}. The bundled Whisper loads one model when it starts: set <code className="hc-code">KITH_WHISPER_MODEL={v.whisperModel}</code> in .env, then <code className="hc-code">docker compose --profile voice up -d whisper</code>. A shared Wyoming server uses whatever models it has.</span></div>}
      </>}
    </div>
  );
}

interface TestMsg { role: "parent" | "companion"; text: string; meta?: string }

interface LangSummary { lang: string; name: string; level: string; goal: string; words: number; cards: number; week: { days: number; chats: number; reviews: number; kana: number; topics: string[] }; hiragana?: number; katakana?: number }
type LangLevel = "A1" | "A2" | "B1";
interface ParentLangs {
  summary: LangSummary[];
  languages: { code: string; name: string; native: string; status: "active" | "pending" | "declined"; enabled: boolean; level: LangLevel; goal: string; requested: number | null }[];
  catalogue: { code: string; name: string; native: string; added: boolean }[];
  unlisted: { name: string; ts: number }[];
}

/** Languages at the topic level: requests to approve, levels, words learned and what they chatted
 *  about, never the chats. The parent can also add or remove a language directly. */
function ParentLanguages({ child, companion }: { child: string; companion: string }) {
  const [v, setV] = useState<ParentLangs | null>(null);
  const [add, setAdd] = useState("");
  const [custom, setCustom] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => api<ParentLangs>("/api/parent/languages").then(setV).catch(() => undefined), []);
  useEffect(() => { void load(); }, [load]);
  if (!v) return null;
  const act = async (f: () => Promise<unknown>) => { setErr(""); try { await f(); } catch (e) { setErr((e as Error).message); } void load(); };
  const setLang = (code: string, patch: object) => act(() => api(`/api/languages/${code}`, { method: "PUT", body: patch }));
  const decide = (code: string, approve: boolean) => act(() => api(`/api/parent/languages/${code}/decide`, { body: { approve } }));
  const remove = (code: string, name: string) => { if (confirm(`Take ${name} off ${child || "your child"}’s list? Their cards and progress are kept in case it comes back.`)) void act(() => api(`/api/parent/languages/${code}`, { method: "DELETE" })); };
  const pending = v.languages.filter((l) => l.status === "pending");
  const active = v.languages.filter((l) => l.status === "active");
  const addable = v.catalogue.filter((c) => !c.added);
  const who = child || "Your child";
  return (
    <section className="card psec">
      <div className="spread"><h3 className="psec-h"><span className="psec-ic"><Icon name="globe" size={18} /></span>Languages this week</h3><span className="small">{who} sees the same summary</span></div>
      {pending.map((l) => (
        <div key={l.code} className="pwarn" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <Icon name="globe" size={18} /><span style={{ flex: 1, minWidth: 200 }}><b>{who} would like to learn {l.name}</b> ({l.level}, {l.goal === "school" ? "for school" : "for fun"}). Nothing is practised until you say yes.</span>
          <button className="btn primary small" onClick={() => void decide(l.code, true)}>Approve</button>
          <button className="btn ghost small" onClick={() => void decide(l.code, false)}>Not now</button>
        </div>
      ))}
      {v.unlisted.map((u) => (
        <div key={u.name} className="pwarn" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <Icon name="question" size={18} /><span style={{ flex: 1, minWidth: 200 }}><b>{who} asked to learn {u.name}</b>, which isn’t on Kith’s list. Add it if you’re happy for {companion} to teach it.</span>
          <button className="btn primary small" onClick={() => void act(() => api("/api/parent/languages", { body: { name: u.name } }))}>Add it</button>
          <button className="btn ghost small" onClick={() => void act(() => api("/api/parent/languages/unlisted/dismiss", { body: { name: u.name } }))}>Dismiss</button>
        </div>
      ))}
      {active.length === 0 && <span className="small">No languages yet.</span>}
      {active.map((l) => {
        const s = v.summary.find((x) => x.lang === l.code);
        return (
          <div key={l.code} className="memrow" style={{ alignItems: "flex-start", padding: "10px 12px", flexWrap: "wrap", gap: 10 }}>
            <span className="t" style={{ flex: 1, minWidth: 200 }}>
              <b>{l.native}</b>{l.native !== l.name ? <span className="small"> {l.name}</span> : null} {s ? <>· {s.words} words learned{s.hiragana !== undefined ? ` · ${s.hiragana} of 46 hiragana` : ""}</> : <span className="small">· switched off</span>}<br />
              {s && <span className="small">{s.week.days} {s.week.days === 1 ? "day" : "days"} of practice · {s.week.chats} practice chats with {companion}{s.week.topics.length ? ` · topics: ${s.week.topics.join(", ")}` : ""}</span>}
            </span>
            <select className="select" style={{ width: 92 }} aria-label={`${l.name} level`} value={l.level} onChange={(e) => void setLang(l.code, { level: e.target.value })}>
              <option>A1</option><option>A2</option><option>B1</option>
            </select>
            <Toggle label="On" checked={l.enabled} onChange={(on) => void setLang(l.code, { enabled: on })} />
            <button className="x" aria-label={`Remove ${l.name}`} onClick={() => remove(l.code, l.name)}><Icon name="trash" size={16} /></button>
          </div>
        );
      })}
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <select className="select" style={{ flex: 1, minWidth: 180 }} aria-label="Add a language" value={add} onChange={(e) => setAdd(e.target.value)}>
          <option value="">Add a language…</option>
          {addable.map((c) => <option key={c.code} value={c.code}>{c.native === c.name ? c.name : `${c.name} · ${c.native}`}</option>)}
          <option value="__other">Another language…</option>
        </select>
        {add === "__other" && <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Which one?" maxLength={40} value={custom} onChange={(e) => setCustom(e.target.value)} />}
        <button className="btn ghost small" disabled={!add || (add === "__other" && custom.trim().length < 2)}
          onClick={() => void act(async () => { await api("/api/parent/languages", { body: add === "__other" ? { name: custom.trim() } : { code: add } }); setAdd(""); setCustom(""); })}>Add</button>
      </div>
      {err && <span className="small" style={{ color: "var(--ember)" }}>{err}</span>}
      <span className="small">You see levels, counts and topics. The practice chats themselves stay private, like the rest of Kith, and the usual safety reports still reach you in English. For languages without their own safety rules, each message is also checked through a private English translation that’s never saved or shown.</span>
    </section>
  );
}

interface GoogleSetup {
  origin: string; redirectUri: string; https: boolean; apis: string[]; scopes: string[]; sensitive: string[]; connect: string;
  status: { client: boolean; secretKey: boolean; picker: boolean; account: string; connected: boolean };
}

/** Every family makes their own Google client (no shared secrets). This walks you through it with
 *  this Kith's exact addresses and scopes, and ticks off what's already set. */
function GoogleSetupGuide() {
  const [g, setG] = useState<GoogleSetup | null>(null);
  const [copied, setCopied] = useState("");
  useEffect(() => { api<GoogleSetup>("/api/parent/google/setup").then(setG).catch(() => undefined); }, []);
  if (!g) return null;
  if (g.connect) return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="small">Google sign-in goes through the shared Kith Connect helper ({g.connect}), so there’s nothing to set up in Google. It stores nothing; everything else goes straight from this Kith to Google.</span>
      {!g.https && <div className="pwarn"><Icon name="warn" size={18} /><span>Google needs Kith on an https:// address. Set KITH_PUBLIC_URL to it first (it’s {g.origin} now).</span></div>}
    </div>
  );
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(""), 1500); } catch { /* select it by hand */ } };
  const Val = ({ v }: { v: string }) => (
    <span className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <code className="gcode">{v}</code>
      <button type="button" className="chip" style={{ minHeight: 28 }} onClick={() => void copy(v)}>{copied === v ? "Copied" : "Copy"}</button>
    </span>
  );
  const Tick = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
    <span className="row" style={{ gap: 6, alignItems: "center" }}><Icon name={ok ? "check" : "warn"} size={16} /><span className="small">{children}</span></span>
  );
  return (
    <details className="gsetup">
      <summary><b>Set up Google, step by step</b> <span className="small">· about 15 minutes, once</span></summary>
      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
        <Tick ok={g.status.client}>Google client {g.status.client ? "is set" : "not set yet"}</Tick>
        <Tick ok={g.status.secretKey}>Encryption key (KITH_SECRET_KEY) {g.status.secretKey ? "is set" : "not set: scripts/setup-secrets.sh makes it"}</Tick>
        <Tick ok={g.status.picker}>Google Picker {g.status.picker ? "is set" : "not set (optional, for picking files)"}</Tick>
        <Tick ok={g.status.connected}>{g.status.connected ? "Your child has connected" : "Your child hasn’t connected yet"}{g.status.account ? ` (only ${g.status.account} is allowed)` : ""}</Tick>
        {!g.https && <div className="pwarn"><Icon name="warn" size={18} /><span>Google needs Kith on an https:// address. Set KITH_PUBLIC_URL to it first (it’s {g.origin} now).</span></div>}
      </div>
      <ol className="gsteps">
        <li>In the <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud console</a>, make a project called “Kith”.</li>
        <li>In <a href="https://console.cloud.google.com/apis/library" target="_blank" rel="noreferrer">APIs &amp; Services › Library</a>, turn on: {g.apis.join(", ")}.</li>
        <li>In <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">Google Auth Platform</a>: Branding (app name “Kith”, your email), Audience <b>External</b> and leave it in <b>Testing</b>, then <b>Test users</b>: add your child’s Google account.</li>
        <li>In <b>Data access › Add or remove scopes</b>, add exactly these (nothing should land under “restricted”):
          <div className="stack" style={{ gap: 4, marginTop: 4 }}>{g.scopes.map((s) => <Val key={s} v={s} />)}</div>
          {g.sensitive.length > 0 && <span className="small">Calendar and Tasks show as “sensitive”. That’s fine in Testing; publishing with them needs Google’s review.</span>}
        </li>
        <li>In <b>Clients › Create client</b>, choose <b>Web application</b>, then add:
          <div className="stack" style={{ gap: 4, marginTop: 4 }}>
            <span className="small">Authorised JavaScript origin</span><Val v={g.origin} />
            <span className="small">Authorised redirect URI</span><Val v={g.redirectUri} />
          </div>
          Copy the client ID and secret straight into the next step; Google shows the secret only once.
        </li>
        <li>Optional, so your child can hand Kith a file: <b>Credentials › Create credentials › API key</b>, restricted to the Google Picker API and to websites <code className="gcode">{g.origin}/*</code>. Note the project number on the project’s dashboard.</li>
        <li>On the server, run <code className="gcode">scripts/setup-secrets.sh</code>, answer y to “Set up Google now?”, paste them in, and restart Kith.</li>
        <li>Switch Google on above. Your child opens Settings › Google › Connect my Google account.</li>
      </ol>
      <span className="small">While the app is in Testing, Google asks your child to connect again every 7 days. Full details: docs/google.md.</span>
    </details>
  );
}

/** A short private test chat: proves the companion really answers, through the same safety check. */
function TestChat({ name, ready, onNeedKey }: { name: string; ready: boolean; onNeedKey: () => void }) {
  const [msgs, setMsgs] = useState<TestMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const list = useRef<HTMLDivElement | null>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [msgs, busy]);
  const send = async (t = text) => {
    const body = t.trim();
    if (!body || busy) return;
    setText(""); setErr(""); setBusy(true);
    const history = msgs.map(({ role, text }) => ({ role, text }));
    setMsgs((m) => [...m, { role: "parent", text: body }]);
    try {
      const r = await api<{ reply: string; model: string; power: string; ms: number; safety: { input: string; output: string } }>("/api/parent/test-chat", { body: { text: body, history } });
      const power = r.power === "full" ? "Full power" : r.power === "low" ? "Low power" : "Resting";
      setMsgs((m) => [...m, { role: "companion", text: r.reply, meta: `${r.model} · ${power} · ${(r.ms / 1000).toFixed(1)} s · safety: message ${r.safety.input}, reply ${r.safety.output}` }]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card ptest">
      <div className="spread">
        <h3 className="psec-h"><span className="psec-ic"><Icon name="chat2" size={18} /></span>Try a chat with {name}</h3>
        {msgs.length > 0 && <button className="btn ghost small" onClick={() => { setMsgs([]); setErr(""); }}>Clear</button>}
      </div>
      <span className="small">Check {name} is really working: the same safety check, safeguards and personality your child gets, on the model the current power mode uses. It’s private and isn’t saved: {name} can’t see your child’s chats or memories here, and can’t use tools. Each message costs about a penny.</span>
      {!ready ? (
        <div className="pwarn"><Icon name="warn" size={18} /><span style={{ flex: 1 }}>{name} can’t think until the Anthropic API key is set.</span><button className="btn primary small" onClick={onNeedKey}>Add the key</button></div>
      ) : <>
        <div className="ptest-list" ref={list} aria-live="polite">
          {msgs.length === 0 && (
            <div className="chips">
              {["Hi! Are you working?", "What can you help with?", "Tell me a fun fact about foxes"].map((q) => <button key={q} className="chip" onClick={() => send(q)}>{q}</button>)}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`ptest-msg ${m.role === "parent" ? "me" : ""}`}>
              <div className="ptest-bubble">{m.text}</div>
              {m.meta && <span className="ptest-meta">{m.meta}</span>}
            </div>
          ))}
          {busy && <div className="ptest-msg"><div className="ptest-bubble"><span className="typing"><i /><i /><i /></span></div></div>}
        </div>
        {err && <div className="pwarn"><Icon name="warn" size={18} /><span>{err}</span></div>}
        <form className="row" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <input className="input" id="ptest-input" aria-label={`Message ${name}`} placeholder={`Message ${name}…`} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
          <button className="btn primary small" type="submit" disabled={busy || !text.trim()}><IL i="send">Send</IL></button>
        </form>
      </>}
    </div>
  );
}

interface NotifyS { now: boolean; today: boolean; fyi: boolean; weekly: boolean; budget: boolean; showSummary: boolean }

/** Lets notifications reach this device (the parent's own), with a test. */
function ParentPushControls({ publicKey }: { publicKey: string }) {
  const [st, setSt] = useState<"…" | "on" | "off" | "blocked" | "unsupported">("…");
  const [msg, setMsg] = useState("");
  useEffect(() => { pushStatus().then(setSt).catch(() => setSt("unsupported")); }, []);
  const toggle = async () => {
    setMsg("");
    try {
      if (st === "on") { await disablePush(); setSt("off"); }
      else { await enablePush(publicKey); setSt("on"); }
    } catch (e) { setMsg((e as Error).message); setSt(await pushStatus().catch(() => "unsupported" as const)); }
  };
  const test = async () => {
    setMsg("Sending…");
    try {
      const r = await api<{ sent: number; devices: number; macApp?: boolean }>("/api/parent/push/test", { body: {} });
      const where = [r.macApp ? "Kith Parent on your Mac (within a minute)" : "", r.sent ? `${r.sent} device${r.sent === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
      setMsg(where ? `Sent to ${where}.` : r.devices ? "It didn’t get through. Check this device’s notification settings." : "No device is set up yet.");
    }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      {isMacApp() ? <div className="row" style={{ flexWrap: "wrap", alignItems: "center" }}>
          <span className="small" style={{ flex: 1, minWidth: 220 }}>This Mac is set: Kith Parent shows them as Mac notifications, even with the window closed. Turn on “Let notifications reach this device” on your phone too if you like.</span>
          <button type="button" className="btn ghost small" onClick={test}>Send a test</button>
        </div>
        : !publicKey ? <span className="small">Phones and browsers need VAPID keys on the server first (scripts/setup-secrets.sh makes them). Kith Parent on a Mac works without them.</span>
        : st === "unsupported" ? <span className="small">This browser can’t receive notifications. On an iPhone, add Kith to the Home Screen first (Share › Add to Home Screen), then open it from there.</span>
        : st === "blocked" ? <span className="small">Notifications are blocked for this site in the browser’s settings.</span>
        : <div className="row" style={{ flexWrap: "wrap" }}>
            <button type="button" className={`btn small ${st === "on" ? "ghost" : "primary"}`} onClick={toggle} disabled={st === "…"}><IL i="bell">{st === "on" ? "Stop notifications on this device" : "Let notifications reach this device"}</IL></button>
            <button type="button" className="btn ghost small" onClick={test}>Send a test</button>
          </div>}
      {msg && <span className="small" aria-live="polite">{msg}</span>}
    </div>
  );
}

interface Settings { notify: NotifyS; voice: VoiceS; disk: DiskS; safeguardsDoc: string; heartbeat: { checklist: string }; budgets: Budgets; quietHours: { start: string; end: string }; maxCheckinsPerDay: number; helplines: Helpline[]; retentionDays: number; connections: Connection[]; browser: BrowserSettings; safeguards: string }
interface Overview {
  energy: { mode: string; percent: number; usd: { week: number; window: number; month: number; deskWeek: number; windowAllowance: number; chatWeekBudget: number }; fullBackAt: number | null; weekResetsAt: number };
  desk: { percent: number; canWork: boolean; usd: { today: number; week: number; allowanceLeft: number; dailySlice: number } };
  split: { chatWeek: number; deskWeek: number; deskDaily: number };
  projection: number;
  lowPower: { week: { share: number; turns: number }; month: { share: number; turns: number } };
  budgets: Budgets;
  spend: { week: { kind: string; bucket: string; usd: number; calls: number }[]; month: { kind: string; bucket: string; usd: number; calls: number }[] };
  settings: Settings;
  status: { apiReady: boolean; reporters: string[]; push: boolean; childPushDevices: number; parentPushDevices?: number; parentMacApp?: boolean; models: { full: string; low: string; safety: string } };
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
  "google-drive": "Saves what the companion makes into a Kith folder in the child's own Google account (drive.file: only files Kith made or the child picks). The child connects their account on the Google screen. Below, you can also let it edit picked Docs, Sheets and Slides, use their calendar, and keep a Homework list: each is off until you switch it on, every change needs the child's yes first, and nothing is ever deleted, shared or emailed. Put your Google email below to get view-only access to the Kith folder; leave it empty to share nothing.",
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

function HeartbeatLog() {
  const [b, setB] = useState<{ last: { ts: number; outcome: string; note: string } | null; recent: { ts: number; outcome: string; note: string }[] } | null>(null);
  useEffect(() => { api<typeof b>("/api/heartbeat").then(setB).catch(() => undefined); }, []);
  if (!b?.recent.length) return <span className="small">No beats yet: the first one happens within half an hour.</span>;
  return (
    <details><summary className="small" style={{ cursor: "pointer", fontWeight: 800 }}>Recent beats</summary>
      <table className="money"><tbody>{b.recent.map((x) => <tr key={x.ts}><td>{when(x.ts)}</td><td>{x.outcome}</td><td>{x.note}</td></tr>)}</tbody></table>
    </details>
  );
}

interface KeyStatus { set: boolean; source: "parent view" | "environment" | "none"; hint: string; canStore: boolean }

/** The Anthropic API key: typed in here, checked with Anthropic, stored encrypted on the server, never shown again. */
function ApiKeyCard({ onChanged, companion }: { onChanged: () => void; companion: string }) {
  const [st, setSt] = useState<KeyStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { api<KeyStatus>("/api/parent/apikey").then(setSt).catch(() => undefined); }, []);
  const save = async () => {
    setBusy(true); setMsg("Checking the key with Anthropic…");
    try { setSt(await api<KeyStatus>("/api/parent/apikey", { method: "PUT", body: { key: key.trim() } })); setKey(""); setMsg(`Saved. ${companion} can think now.`); onChanged(); }
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
        <span>{!st ? "…" : st.set ? <>Key {st.hint} is set <span className="small">({st.source === "parent view" ? "saved here" : "from the server’s environment"})</span></> : `No key yet, so ${companion} can’t think.`}</span>
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

const KIND_ICON: Record<string, IconName> = { "home-assistant": "home", kin: "calendar", mcp: "sparkle", jellyfin: "music", calculator: "note", dictionary: "stories", web: "compass", "google-drive": "cloud" };
const ADDABLE: [Connection["kind"], string][] = [["mcp", "MCP server"], ["home-assistant", "Home Assistant"], ["kin", "Kin"], ["jellyfin", "Jellyfin"], ["web", "Allowed websites"]];
const BUILT_IN = new Set(["room", "kin", "jellyfin", "calculator", "dictionary", "google", "web"]);

function SettingsForm({ initial, onSaved, section = "settings", companion = "Pip", publicKey = "" }: { initial: Settings; onSaved: () => void; section?: "settings" | "connectors"; companion?: string; publicKey?: string }) {
  const [s, setS] = useState<Settings>(initial);
  const setWeb = (patch: Partial<BrowserSettings>) => setS((x) => ({ ...x, browser: { ...x.browser, ...patch } }));
  const [msg, setMsg] = useState("");
  const [builtIn, setBuiltIn] = useState("");
  useEffect(() => { api<{ builtIn: string }>("/api/parent/safeguards").then((r) => setBuiltIn(r.builtIn)).catch(() => undefined); }, []);
  const docText = s.safeguardsDoc || builtIn;
  const [vrows, setVrows] = useState(() => [0, 1, 2].map((i) => initial.voice?.voices[i] ?? { label: "", voice: "" }));
  const [disk, setDisk] = useState<DiskUsage | null>(null);
  useEffect(() => { api<DiskUsage>("/api/parent/disk").then(setDisk).catch(() => undefined); }, []);
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
    <div className={`psettings ${section === "connectors" ? "single" : ""}`}>
      {section === "settings" && <nav className="psec-nav" aria-label="Settings sections">
        {([["set-claude", "sparkle", "Claude"], ["set-notify", "bell", "Notifications"], ["set-heartbeat", "heart", "Heartbeat"], ["set-budgets", "fire", "Budgets"], ["set-voice", "speaker", "Voice"], ["set-storage", "folder", "Storage"], ["set-quiet", "moon", "Quiet hours"], ["set-help", "phone", "Grown-up? numbers"], ["set-safeguards", "shield", "Safeguards"], ["set-browser", "compass", "Browser"]] as const).map(([id, ic, l]) => (
          <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}><Icon name={ic} size={16} />{l}</a>
        ))}
      </nav>}
      <div className="psec-list">
        {section === "settings" && <>
        <ApiKeyCard onChanged={onSaved} companion={companion} />
        <section className="card psec" id="set-notify">
          <h3 className="psec-h"><span className="psec-ic"><Icon name="bell" size={18} /></span>Notifications to you</h3>
          <span className="small">Notifications to your own phone or computer, separate from your child’s. Turn them on on each device you want them on. “Right now” reports come through even in quiet hours; everything else waits until quiet hours end. Your child’s chat text is never sent.</span>
          <ParentPushControls publicKey={publicKey} />
          <b style={{ fontSize: 14 }}>Reports</b>
          <Toggle label="Right now (urgent)" checked={s.notify.now} onChange={(v) => setS({ ...s, notify: { ...s.notify, now: v } })} />
          <Toggle label="Today" checked={s.notify.today} onChange={(v) => setS({ ...s, notify: { ...s.notify, today: v } })} />
          <Toggle label="Just so you know" checked={s.notify.fyi} onChange={(v) => setS({ ...s, notify: { ...s.notify, fyi: v } })} />
          <b style={{ fontSize: 14 }}>Also</b>
          <Toggle label="The weekly summary is ready" checked={s.notify.weekly} onChange={(v) => setS({ ...s, notify: { ...s.notify, weekly: v } })} />
          <Toggle label="Budget alerts (Low power started, the monthly hard stop reached)" checked={s.notify.budget} onChange={(v) => setS({ ...s, notify: { ...s.notify, budget: v } })} />
          <b style={{ fontSize: 14 }}>On the lock screen</b>
          <Toggle label="Show the report’s one-line summary" checked={s.notify.showSummary} onChange={(v) => setS({ ...s, notify: { ...s.notify, showSummary: v } })} />
          <span className="small">{s.notify.showSummary ? "Notifications show the one-line summary you’d see under Reports (never chat text). Anyone who can see your lock screen can read it." : "Notifications only say something needs you (e.g. “Kith: needs you. Something needs you now. Open Kith to read it.”). Open Kith to read the report."}</span>
        </section>
        <section className="card psec" id="set-heartbeat">
          <h3 className="psec-h"><span className="psec-ic"><Icon name="heart" size={18} /></span>Heartbeat</h3>
          <span className="small">Every 30 minutes, always (it can’t be switched off), the companion quietly looks over what’s coming up (reminders, exam dates, things it made, what your child mentioned) against this checklist, and decides whether anything needs doing. Usually nothing does; when something does, it either sends one gentle check-in (within your daily limit, never in quiet hours, never while they’re chatting, safety-checked) or writes a line in its journal. It runs on Low power from the desk’s budget, beats “asleep” in quiet hours without calling Claude, and skips calling Claude when nothing has changed.</span>
          <label className="field">What it keeps an eye on
            <textarea className="textarea" style={{ minHeight: 140 }} maxLength={2000} value={s.heartbeat.checklist} onChange={(e) => setS({ ...s, heartbeat: { checklist: e.target.value } })} /></label>
          <HeartbeatLog />
        </section>
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

      <section className="card psec" id="set-voice">
        <h3 className="psec-h"><span className="psec-ic"><Icon name="speaker" size={18} /></span>Voice</h3>
        <span className="small">Calls use Whisper to listen and Piper to speak, over the Wyoming protocol. Leave a box empty to use the server’s .env. Smaller models use less memory: on a small machine, keep listening on <b>tiny</b>. You can point either one at a Wyoming server that’s already running (another machine, or Home Assistant’s).</span>
        <label className="field">Listening model (Whisper)
          <select className="select" value={s.voice.whisperModel} onChange={(e) => setS({ ...s, voice: { ...s.voice, whisperModel: e.target.value } })}>
            <option value="">Whatever the server has loaded</option>
            <option value="tiny-int8">tiny (fastest, least memory, about 150 MB)</option>
            <option value="base-int8">base (better, about 250 MB)</option>
            <option value="small-int8">small (best of these, about 600 MB; needs a bigger machine)</option>
          </select></label>
        <b style={{ fontSize: 14 }}>Voices your child can pick (Piper)</b>
        <span className="small">A name your child sees, and a Piper voice (e.g. en_GB-alba-medium). Piper fetches voices it doesn’t have yet. Leave all empty to use the .env voices.</span>
        {vrows.map((row, i) => {
          const setRow = (p: Partial<{ label: string; voice: string }>) => {
            const next = vrows.map((x, j) => (j === i ? { ...x, ...p } : x));
            setVrows(next);
            // Only complete rows are saved; half-typed ones wait until they're done.
            setS((cur) => ({ ...cur, voice: { ...cur.voice, voices: next.filter((x) => x.label.trim() && /^[A-Za-z0-9_-]{3,80}$/.test(x.voice)) } }));
          };
          return (
            <div key={i} className="grid2">
              <input className="input" aria-label={`Voice ${i + 1} name`} placeholder={["Wren", "Robin", "Fern"][i]} value={row.label} maxLength={20} onChange={(e) => setRow({ label: e.target.value })} />
              <input className="input" aria-label={`Voice ${i + 1} Piper voice`} placeholder={["en_GB-cori-medium", "en_GB-alan-medium", "en_GB-jenny_dioco-medium"][i]} value={row.voice} maxLength={80} onChange={(e) => setRow({ voice: e.target.value.trim() })} />
            </div>
          );
        })}
        <div className="grid2">
          <label className="field">Listening server<input className="input" placeholder="whisper (from .env)" value={s.voice.sttHost} onChange={(e) => setS({ ...s, voice: { ...s.voice, sttHost: e.target.value.trim() } })} /></label>
          <label className="field">Port<input className="input" type="number" placeholder="10300" value={s.voice.sttPort || ""} onChange={(e) => setS({ ...s, voice: { ...s.voice, sttPort: Number(e.target.value) || 0 } })} /></label>
          <label className="field">Speaking server<input className="input" placeholder="piper (from .env)" value={s.voice.ttsHost} onChange={(e) => setS({ ...s, voice: { ...s.voice, ttsHost: e.target.value.trim() } })} /></label>
          <label className="field">Port<input className="input" type="number" placeholder="10200" value={s.voice.ttsPort || ""} onChange={(e) => setS({ ...s, voice: { ...s.voice, ttsPort: Number(e.target.value) || 0 } })} /></label>
        </div>
        <VoiceCheck v={s.voice} />
        <span className="small">Save first, then check. The bundled voice containers keep their models in memory while they run; on a small machine you can leave them off (no <code className="hc-code">--profile voice</code>) and use a Wyoming server on another machine instead.</span>
      </section>

      <section className="card psec" id="set-storage">
        <h3 className="psec-h"><span className="psec-ic"><Icon name="folder" size={18} /></span>Storage</h3>
        <span className="small">A disk budget for Kith: its own data (database, chat archive, block lists) plus the desk’s files. When the desk’s files reach their limit, or everything reaches the total, new desk work waits until there’s room. Trash and any desk screenshots are deleted after the days below; the desk browser’s caches are cleared whenever it stops.</span>
        {disk ? <StorageBars u={disk} /> : <span className="small">Measuring…</span>}
        <div className="grid2">
          <label className="field">Total budget (GB)<input className="input" type="number" min={1} step={1} value={s.disk.totalGb} onChange={(e) => setS({ ...s, disk: { ...s.disk, totalGb: Math.max(1, Number(e.target.value) || 1) } })} /></label>
          <label className="field">Desk files (GB)<input className="input" type="number" min={0.5} step={0.5} value={s.disk.deskGb} onChange={(e) => setS({ ...s, disk: { ...s.disk, deskGb: Math.max(0.5, Number(e.target.value) || 0.5) } })} /></label>
          <label className="field">Keep trash for (days)<input className="input" type="number" min={1} max={90} value={s.disk.keepDays} onChange={(e) => setS({ ...s, disk: { ...s.disk, keepDays: Math.min(90, Math.max(1, Number(e.target.value) || 7)) } })} /></label>
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
        <label className="field">
          <span className="spread"><span>The safeguards document {s.safeguardsDoc ? <span className="pcmd">edited</span> : <span className="small">(the built-in version)</span>}</span>
            {s.safeguardsDoc && <button type="button" className="btn ghost small" onClick={() => { if (confirm("Go back to the built-in safeguards?")) setS({ ...s, safeguardsDoc: "" }); }}>Reset to the built-in version</button>}</span>
          <textarea className="textarea" style={{ minHeight: 260, fontSize: 13.5, lineHeight: 1.5 }} maxLength={12000} value={docText}
            onChange={(e) => setS({ ...s, safeguardsDoc: e.target.value === builtIn ? "" : e.target.value })} />
        </label>
        <div className="pwarn"><Icon name="shield" size={18} /><span>Edit with care: this is what keeps the companion’s behaviour safe. Whatever it says, every message is still checked by the separate safety check, worries are still reported (and your child is told first), and Grown-up?, Childline and 999 always work.</span></div>
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

        </>}
        {section === "connectors" && <>
        <div className="pintro">
          <span className="small">Connectors are the things {companion} can use beyond chatting: your Home Assistant, Kin, Jellyfin, MCP servers and more. Only you can add or switch them on, each is “look only” or “can act”, and every use is logged under Overview. Nothing that spends money, messages people or posts online is ever offered, whatever a connector allows. Tokens stay in the server’s environment (you name the variable here), never in this page. Your child can see which connectors are on, and what they do.</span>
          <span className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="small" style={{ fontWeight: 800 }}>Add:</span>
            {ADDABLE.map(([k, l]) => (
              <button key={k} className="btn ghost small" disabled={s.connections.length >= 20} onClick={() => setS({ ...s, connections: [...s.connections, { id: `${k.replace(/[^a-z]/g, "")}-${Date.now().toString(36).slice(-5)}`, kind: k, name: l, enabled: false, level: "look", url: "", tokenEnv: "", allowedTools: [], entities: [], sites: [], account: "" }] })}>
                <IL i={KIND_ICON[k]}>{l}</IL>
              </button>
            ))}
          </span>
        </div>
        <div className="pconns">
        {s.connections.map((c, i) => (
          <div key={c.id} className={`card pconn ${c.enabled ? "on" : ""}`}>
            <div className="pconn-head">
              <span className="psec-ic"><Icon name={KIND_ICON[c.kind] ?? "home"} size={18} /></span>
              <input className="pconn-name" value={c.name} maxLength={60} aria-label="Connector name" onChange={(e) => setC(i, { name: e.target.value })} />
              <Toggle label="" checked={c.enabled} onChange={(v) => setC(i, { enabled: v })} />
            </div>
            <span className="small">{KIND_HELP[c.kind]}</span>
            <div className="chips" role="radiogroup" aria-label="What it may do">
              <button role="radio" aria-checked={c.level === "look"} className={`chip ${c.level === "look" ? "on" : ""}`} onClick={() => setC(i, { level: "look" })}><IL i="eye">Look only</IL></button>
              <button role="radio" aria-checked={c.level === "act"} className={`chip ${c.level === "act" ? "on" : ""}`} onClick={() => setC(i, { level: "act" })}><IL i="sparkle">Can act</IL></button>
            </div>
            <details className="pconn-more"><summary>Settings</summary>
            {!["calculator", "web", "google-drive"].includes(c.kind) && <label className="field">URL<input className="input" value={c.url} onChange={(e) => setC(i, { url: e.target.value })} placeholder="https://" /></label>}
            {["home-assistant", "kin", "mcp", "jellyfin"].includes(c.kind) && <label className="field">Token environment variable<input className="input" value={c.tokenEnv} onChange={(e) => setC(i, { tokenEnv: e.target.value })} placeholder="KITH_CONN_…_TOKEN" /></label>}
            {["kin", "mcp"].includes(c.kind) && <label className="field">Allowed tools (comma-separated)<input className="input" value={c.allowedTools.join(", ")} onChange={(e) => setC(i, { allowedTools: list(e.target.value) })} /></label>}
            {c.kind === "home-assistant" && <label className="field">Their room’s entities (comma-separated)<input className="input" value={c.entities.join(", ")} onChange={(e) => setC(i, { entities: list(e.target.value) })} placeholder="light.bedroom, switch.fairy_lights" /></label>}
            {c.kind === "web" && <label className="field">Allowed sites (comma-separated)<input className="input" value={c.sites.join(", ")} onChange={(e) => setC(i, { sites: list(e.target.value) })} placeholder="bbc.co.uk/bitesize, wikipedia.org" /></label>}
            {c.kind === "google-drive" && <label className="field">Your Google email (view-only access to the Kith folder, optional)<input className="input" value={c.account} onChange={(e) => setC(i, { account: e.target.value })} placeholder="you@gmail.com" /></label>}
            {c.kind === "google-drive" && (() => {
              const f = c.features ?? { edit: false, calendar: false, tasks: false };
              const setF = (patch: Partial<typeof f>) => setC(i, { features: { ...f, ...patch } });
              return (
                <div className="stack" style={{ gap: 6 }}>
                  <Toggle label={<>Edit Docs, Sheets and Slides <span className="small">· only files the child picks or Kith made; each change needs their yes; never coursework; Google keeps every version</span></>} checked={f.edit} onChange={(v) => setF({ edit: v })} />
                  <Toggle label={<>Their Google Calendar <span className="small">· read events; add ones they confirm; only change or remove Kith’s own; never guests or emails</span></>} checked={f.calendar} onChange={(v) => setF({ calendar: v })} />
                  <Toggle label={<>A Homework list in Google Tasks <span className="small">· read, add and tick off, with their yes</span></>} checked={f.tasks} onChange={(v) => setF({ tasks: v })} />
                  <span className="small">Calendar and Tasks need the child to connect Google again after you switch them on, so Google can ask them. Gmail, contacts, photos and Classroom are never used.</span>
                  <GoogleSetupGuide />
                </div>
              );
            })()}
            {c.kind === "jellyfin" && <label className="field">Jellyfin user id (for playlists)<input className="input" value={c.account} onChange={(e) => setC(i, { account: e.target.value })} /></label>}
            {!BUILT_IN.has(c.id) && <button className="btn ghost small" onClick={() => { if (confirm(`Remove ${c.name}?`)) setS({ ...s, connections: s.connections.filter((_, j) => j !== i) }); }}><IL i="trash">Remove this connector</IL></button>}
            </details>
          </div>
        ))}
        </div>
        </>}
      </div>
      <div className="psave"><span className="small" aria-live="polite">{msg || "Changes are saved when you press Save."}</span><button className="btn primary" onClick={save}>{section === "connectors" ? "Save connectors" : "Save settings"}</button></div>
    </div>
  );
}

type PTab = "overview" | "reports" | "desk" | "connectors" | "skills" | "settings" | "help";
const PNAV: [PTab, IconName, string][] = [["overview", "home", "Overview"], ["reports", "bell", "Reports"], ["desk", "desk", "Desk"], ["connectors", "sparkle", "Connectors"], ["skills", "bulb", "Skills"], ["settings", "settings", "Settings"], ["help", "question", "Help"]];

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
  const [disk, setDisk] = useState<DiskUsage | null>(null);
  const load = useCallback(() => {
    api<DiskUsage>("/api/parent/disk").then(setDisk).catch(() => undefined);
    api<Overview>("/api/parent/overview").then(setO).catch(() => undefined);
    api<Transparency>("/api/transparency").then(setT).catch(() => undefined);
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 30_000); return () => clearInterval(i); }, [load]);
  // "Kith Parent" in the tab, and when added to the Dock or Home Screen (the manifest says so too).
  useEffect(() => {
    const before = document.title;
    document.title = "Kith Parent";
    let meta = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const created = !meta;
    if (!meta) { meta = document.createElement("meta"); meta.name = "apple-mobile-web-app-title"; document.head.appendChild(meta); }
    const prev = meta.content;
    meta.content = "Kith Parent";
    return () => { document.title = before; if (created) meta?.remove(); else if (meta) meta.content = prev; };
  }, []);
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
    (() => {
      // Kith Parent on a Mac gets them natively (no VAPID keys needed); phones and browsers use web push.
      const web = o.status.push ? o.status.parentPushDevices ?? 0 : 0;
      const mac = !!o.status.parentMacApp;
      const yours = [mac ? "Kith Parent on your Mac" : "", web ? `${web} other device${web === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
      return [mac || web > 0, "Notifications to you", yours ? `${yours}${o.status.push ? ` · ${o.status.childPushDevices} of ${cname}’s` : ""}`
        : !o.status.push ? "Open Kith Parent on your Mac, or set VAPID keys for phones" : "Settings › Notifications to you › Let notifications reach this device"] as [boolean, string, string];
    })(),
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
              <TestChat name={comp.name} ready={o.status.apiReady} onNeedKey={() => { setTab("settings"); setTimeout(() => document.getElementById("set-claude")?.scrollIntoView({ behavior: "smooth" }), 80); }} />
              <ParentLanguages child={cname} companion={comp.name} />
              {disk && (
                <div className="card pstorage">
                  <span className="ptile-h"><span className="psec-ic"><Icon name="folder" size={16} /></span>Storage</span>
                  <StorageBars u={disk} />
                </div>
              )}
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
          {tab === "settings" && o && <SettingsForm key="settings" initial={o.settings} onSaved={load} publicKey={me.push.ready ? me.push.publicKey : ""} />}
          {tab === "help" && <ParentHelp companion={comp.name} child={cname} />}
          {tab === "skills" && <ParentSkills companion={comp.name} childName={cname} />}
          {tab === "connectors" && o && <SettingsForm key="connectors" section="connectors" companion={comp.name} initial={o.settings} onSaved={load} />}
        </div>
      </div>
    </div>
  );
}
