import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AppState, type Me, type Mood, type Profile, type Turn } from "./api";
import { Avatar, LogoMark } from "./components/Avatar";
import { HelpSheet, useRoute } from "./components/bits";
import { Icon, type IconName } from "./components/Icons";
import { Meet } from "./screens/Meet";
import { Chat } from "./screens/Chat";
import { Talk } from "./screens/Talk";
import { Personality } from "./screens/Personality";
import { DeskAside } from "./screens/Desk";
import { Profile as PipProfile, Settings } from "./screens/Profile";
import { Remembers } from "./screens/Remembers";
import { Shared } from "./screens/Shared";
import { OC } from "./screens/OC";
import { Parent } from "./screens/Parent";
import { registerServiceWorker } from "./lib/push";
import { Google } from "./screens/Google";
import { AvatarLab } from "./screens/AvatarLab";
import { Study } from "./screens/Study";
import { Art } from "./screens/Art";
import { Stories } from "./screens/Stories";

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

// Settings and the companion's profile hold the rest (personality, memories, What … sees, Google, the desk).
const NAV: { to: string; icon: IconName; label: string }[] = [
  { to: "/", icon: "chat", label: "Chat" },
  { to: "/study", icon: "study", label: "Study" },
  { to: "/stories", icon: "stories", label: "Stories with a friend" },
  { to: "/art", icon: "art", label: "Art" },
  { to: "/oc", icon: "oc", label: "OC workshop" },
  { to: "/settings", icon: "settings", label: "Settings" },
];
const TABS: { to: string; icon: IconName; label: string }[] = [
  { to: "/", icon: "chat", label: "Chat" },
  { to: "/study", icon: "study", label: "Study" },
  { to: "/create", icon: "create", label: "Create" },
  { to: "/settings", icon: "settings", label: "Settings" },
];
const SETTINGS_PAGES = ["/settings", "/me", "/memory", "/shared", "/google"];

function CreateMenu({ me, go }: { me: Me; go: (to: string) => void }) {
  return (
    <div className="screen narrow">
      <span className="hand">make something</span>
      <h2 className="screen-title">Create</h2>
      {[["/stories", "✍️", "Stories with a friend", "Write together; every part credited"], ["/art", "🎨", "Art", "Challenges, sketchbook, mood board, feedback"], ["/oc", "⭐", "OC workshop", "Your characters and their world"], ["/pip", "🖥️", `Ask ${me.profile.name} to make something`, "On its desk: quizzes, games, comics, slides and more"]].map(([to, ic, t, d]) => (
        <button key={to} className="card" style={{ flexDirection: "row", alignItems: "center", gap: 12, textAlign: "left" }} onClick={() => go(to)}>
          <span style={{ fontSize: 24 }}>{ic}</span><span><b>{t}</b><br /><span className="small">{d}</span></span>
        </button>
      ))}
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
  else if (path === "/desk" || path.startsWith("/pip")) {
    const t = path.split("/")[2] ?? "desk";
    screen = <PipProfile me={me} state={state} mood={baseMood} go={go} initialTab={t === "scheduled" ? "scheduled" : ["who", "soul", "personality", "memory"].includes(t) ? "who" : "desk"} />;
  }
  else if (path === "/oc") screen = <OC me={me} onTurn={onTurn} onMood={setMood} openHelp={openHelp} go={go} />;
  else if (path === "/memory") screen = <Remembers me={me} onSaved={onSaved} />;
  else if (path === "/me") screen = <Personality me={me} onSaved={onSaved} />;
  else if (path === "/shared") screen = <Shared me={me} />;
  else if (path === "/settings" || path === "/you") screen = <Settings me={me} go={go} state={state} />;
  else if (path === "/google") screen = <Google me={me} />;
  else if (path === "/study") screen = <Study me={me} onTurn={onTurn} onMood={setMood} openHelp={openHelp} go={go} />;
  else if (path === "/art") screen = <Art me={me} onTurn={onTurn} onMood={setMood} openHelp={openHelp} go={go} />;
  else if (path === "/stories") screen = <Stories me={me} />;
  else if (path === "/create") screen = <CreateMenu me={me} go={go} />;
  else if (path === "/lab") screen = <AvatarLab />;
  else screen = <Chat me={me} onTurn={onTurn} onMood={setMood} openHelp={openHelp} go={go} />;

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Sections">
        <button className="me" onClick={() => go("/pip")} aria-label={`${name}’s profile`} style={{ border: 0, background: "none", color: "inherit", textAlign: "left", cursor: "pointer" }}>
          <Avatar look={me.profile.look} mood={baseMood} size={52} variant="side" laptop={!!working} />
          <span><b>{name}</b><span>{moodText}</span></span>
        </button>
        {NAV.map((n) => {
          const on = n.to === path || (n.to === "/settings" && SETTINGS_PAGES.includes(path));
          return (
            <button key={n.to} className={`navbtn ${on ? "on" : ""}`} aria-current={on ? "page" : undefined} onClick={() => go(n.to)}>
              <span className="ic"><Icon name={n.icon} on={on} size={22} /></span>{n.label}
            </button>
          );
        })}
        <button className="navbtn" style={{ color: "var(--ember)" }} onClick={openHelp}><span className="ic"><Icon name="grownup" size={22} /></span>Need a grown-up?</button>
        <div className="foot">
          <span className="small">{name} is an AI, not a person. It lives on your family’s home server.</span>
          <button className="btn primary block" style={{ minHeight: 44, fontSize: 14 }} onClick={() => go("/talk")}><Icon name="call" size={18} /> Call {name}</button>
        </div>
      </nav>
      <div className="main">
        {path !== "/talk" && (
          <header className="topbar mobile-only">
            <button onClick={() => go("/pip")} aria-label={`${name}’s profile`} style={{ border: 0, background: "none", padding: 0 }}><Avatar look={me.profile.look} mood={baseMood} size={42} variant="side" laptop={!!working} /></button>
            <span className="who" onClick={() => go("/pip")}><b>{name}</b><span>AI, not a person · {moodText}</span></span>
            <button className="callbtn" onClick={() => go("/talk")} aria-label={`Call ${name}`}><Icon name="call" size={17} /> Call</button>
          </header>
        )}
        {screen}
        <nav className="tabbar" aria-label="Sections" hidden={path === "/talk"}>
          {TABS.map((t) => {
            const on = t.to === path || (t.to === "/create" && ["/stories", "/art", "/oc"].includes(path)) || (t.to === "/settings" && SETTINGS_PAGES.includes(path));
            return <button key={t.to} className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={() => go(t.to)}><Icon name={t.icon} on={on} /><span>{t.label}</span></button>;
          })}
          <button className="sos" onClick={openHelp}><Icon name="grownup" /><span>Need a grown-up?</span></button>
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
