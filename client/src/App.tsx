import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AppState, type Me, type Mood, type Profile, type Turn } from "./api";
import { Avatar, LogoMark } from "./components/Avatar";
import { EnergyCard, HelpSheet, useRoute } from "./components/bits";
import { Meet } from "./screens/Meet";
import { Chat } from "./screens/Chat";
import { Talk } from "./screens/Talk";
import { Personality } from "./screens/Personality";
import { Desk, DeskAside } from "./screens/Desk";
import { Remembers } from "./screens/Remembers";
import { Shared } from "./screens/Shared";
import { OC } from "./screens/OC";
import { Parent } from "./screens/Parent";
import { registerServiceWorker } from "./lib/push";
import { Google } from "./screens/Google";

function SignIn() {
  const [info, setInfo] = useState<{ oidc: boolean; label: string; dev: boolean } | null>(null);
  const reason = new URLSearchParams(location.search).get("signin");
  useEffect(() => { api<{ oidc: boolean; label: string; dev: boolean }>("/api/public/signin").then(setInfo).catch(() => undefined); }, []);
  return (
    <div className="main">
      <div className="screen narrow" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", gap: 18 }}>
        <LogoMark size={88} />
        <h1 style={{ fontSize: 46 }}>kith</h1>
        <span className="hand">a companion that grows up with you, kept at home</span>
        {reason === "not-allowed" && <div className="notice">That account isn’t set up for Kith. Ask the grown-up who runs it.</div>}
        {reason === "failed" && <div className="notice">Sign-in didn’t work. Try again?</div>}
        {info?.oidc && <a className="btn primary" href="/auth/login" style={{ textDecoration: "none" }}>Sign in with {info.label}</a>}
        {info && !info.oidc && !info.dev && <span className="small">Sign-in isn’t set up yet. See docs/setup.md.</span>}
        {info?.dev && (
          <div className="stack" style={{ width: "100%" }}>
            <span className="small">Local testing (KITH_DEV_LOGIN is on)</span>
            <a className="btn ghost" href="/auth/dev?role=child" style={{ textDecoration: "none" }}>Try as the child</a>
            <a className="btn ghost" href="/auth/dev?role=parent" style={{ textDecoration: "none" }}>Try as the parent</a>
          </div>
        )}
      </div>
    </div>
  );
}

const NAV = (name: string, parent: string) => [
  { to: "/", icon: "💬", label: "Chat" },
  { to: "/talk", icon: "🎙️", label: "Talk" },
  { to: "/desk", icon: "🖥️", label: `${name}’s desk` },
  { to: "/oc", icon: "⭐", label: "OC workshop" },
  { to: "/memory", icon: "🧠", label: `What ${name} remembers` },
  { to: "/me", icon: "✨", label: "Personality" },
  { to: "/shared", icon: "👀", label: `What ${parent} sees` },
  { to: "/google", icon: "☁️", label: "Google Drive" },
];
const TABS = [
  { to: "/", icon: "💬", label: "Chat" },
  { to: "/talk", icon: "🎙️", label: "Talk" },
  { to: "/desk", icon: "🖥️", label: "Desk" },
  { to: "/oc", icon: "⭐", label: "OCs" },
  { to: "/you", icon: "✨", label: "You" },
];

function YouMenu({ me, go }: { me: Me; go: (to: string) => void }) {
  const name = me.profile.name;
  const logout = async () => { await api("/auth/logout", { body: {} }).catch(() => undefined); location.href = "/"; };
  return (
    <div className="screen narrow">
      <span className="hand">yours</span>
      <h2 className="screen-title">You and {name}</h2>
      {[["/me", "✨", "Personality", "Name, look, traits and voice"], ["/memory", "🧠", `What ${name} remembers`, "See and delete memories, check-ins"], ["/shared", "👀", `What ${me.parentLabel} sees`, "Nothing secret here"], ["/google", "☁️", "Google Drive", "Save what you make to your own Drive"]].map(([to, ic, t, d]) => (
        <button key={to} className="card" style={{ flexDirection: "row", alignItems: "center", gap: 12, textAlign: "left" }} onClick={() => go(to)}>
          <span style={{ fontSize: 24 }}>{ic}</span><span><b>{t}</b><br /><span className="small">{d}</span></span>
        </button>
      ))}
      <button className="btn ghost small" onClick={logout}>Sign out</button>
      <span className="small">{name} is an AI, not a person. It lives on your family’s home server.</span>
    </div>
  );
}

function ChildApp({ me: initialMe }: { me: Me }) {
  const [me, setMe] = useState(initialMe);
  const [state, setState] = useState<AppState | null>(null);
  const [mood, setMood] = useState<Mood>("happy");
  const [help, setHelp] = useState(false);
  const [path, go] = useRoute();
  const load = useCallback(() => api<AppState>("/api/state").then(setState).catch(() => undefined), []);
  useEffect(() => { void load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]);

  const onSaved = (p: Profile) => setMe((m) => ({ ...m, profile: p }));
  if (!me.profile.setupDone) return <Meet me={me} onDone={onSaved} />;

  const energy = state?.energy;
  const baseMood: Mood = mood !== "happy" ? mood : energy?.mode === "low" ? "sleepy" : energy?.mode === "resting" ? "resting" : "happy";
  const onTurn = (t: Turn) => { setState((s) => (s ? { ...s, energy: t.energy } : s)); void load(); };
  const name = me.profile.name;
  const working = state?.desk.working;
  const moodText = `${baseMood === "happy" ? "😊 happy" : baseMood === "thinking" ? "🤔 thinking" : baseMood === "sleepy" ? "😌 sleepy" : baseMood === "resting" ? "😴 resting" : "💛 here for you"}${working ? " · " + (working.kind === "story" ? "writing a story" : `making ${working.title}`) : ""}`;
  const openHelp = () => setHelp(true);
  const showAside = path === "/" || path === "/talk";

  let screen: React.ReactNode;
  if (path === "/talk" && energy) screen = <Talk me={me} energy={energy} onTurn={onTurn} openHelp={openHelp} go={go} />;
  else if (path === "/desk") screen = <Desk me={me} energy={energy} />;
  else if (path === "/oc") screen = <OC me={me} onTurn={onTurn} onMood={setMood} openHelp={openHelp} go={go} />;
  else if (path === "/memory") screen = <Remembers me={me} onSaved={onSaved} />;
  else if (path === "/me") screen = <Personality me={me} onSaved={onSaved} />;
  else if (path === "/shared") screen = <Shared me={me} />;
  else if (path === "/you") screen = <YouMenu me={me} go={go} />;
  else if (path === "/google") screen = <Google me={me} />;
  else screen = <Chat me={me} onTurn={onTurn} onMood={setMood} openHelp={openHelp} go={go} />;

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Sections">
        <div className="me">
          <Avatar look={me.profile.look} mood={baseMood} size={52} variant="side" />
          <span><b>{name}</b><span>{moodText}</span></span>
        </div>
        {energy && <div style={{ margin: "-4px 6px 12px" }}><EnergyCard energy={energy} compact /></div>}
        {NAV(name, me.parentLabel).map((n) => (
          <button key={n.to} className={`navbtn ${path === n.to ? "on" : ""}`} aria-current={path === n.to ? "page" : undefined} onClick={() => go(n.to)}>
            <span className="ic" aria-hidden>{n.icon}</span>{n.label}
          </button>
        ))}
        <div className="foot">
          <span className="small">{name} is an AI, not a person. It lives on your family’s home server.</span>
          <button className="btn ember block" style={{ minHeight: 44, fontSize: 14 }} onClick={openHelp}>Need a grown-up?</button>
        </div>
      </nav>
      <div className="main">
        {path !== "/talk" && (
          <header className="topbar mobile-only">
            <Avatar look={me.profile.look} mood={baseMood} size={42} variant="side" />
            <span className="who"><b>{name}</b><span>AI, not a person · {moodText}</span></span>
            <button className="grownup" onClick={openHelp}>Need a grown-up?</button>
          </header>
        )}
        {screen}
        <nav className="tabbar" aria-label="Sections" hidden={path === "/talk"}>
          {TABS.map((t) => {
            const on = t.to === path || (t.to === "/you" && ["/me", "/memory", "/shared", "/google"].includes(path));
            return <button key={t.to} className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={() => go(t.to)}><span aria-hidden>{t.icon}</span><span>{t.label}</span></button>;
          })}
        </nav>
      </div>
      {showAside && <DeskAside me={me} go={go} />}
      <HelpSheet open={help} onClose={() => setHelp(false)} parentLabel={me.parentLabel} helplines={me.helplines} />
    </div>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null | "signed-out">(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<Me>("/api/me").then(setMe).catch((e) => (e instanceof ApiError && e.status === 401 ? setMe("signed-out") : setErr((e as Error).message)));
    void registerServiceWorker();
  }, []);
  if (err) return <div className="main"><div className="screen narrow"><div className="notice">Kith can’t reach home right now. {err}</div></div></div>;
  if (me === null) return <div className="main" aria-busy="true" />;
  if (me === "signed-out") return <SignIn />;
  if (me.role === "parent") return <Parent me={me} />;
  return <ChildApp me={me} />;
}
