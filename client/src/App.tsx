import { withApp, wrongAppWords } from "./lib/appHint";
import { isInstalledApp, newHandoffId, prepareSignIn, preparedFresh, waitForHandoff, type PreparedSignIn } from "./lib/signin";
import { checkNativeActions, startNative } from "./lib/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type AppState, type Me, type Mood, type Profile, type Turn } from "./api";
import { Avatar, LogoMark } from "./components/Avatar";
import { doingText, HelpSheet, useRoute } from "./components/bits";
import { Icon, type IconName } from "./components/Icons";
import { Meet } from "./screens/Meet";
import { Chat, type ChatContext } from "./screens/Chat";
import { Languages } from "./screens/Languages";
import { SideChats, type ThreadRow } from "./screens/SideChats";
import { Talk } from "./screens/Talk";
import { Personality } from "./screens/Personality";
import { ProfilePanel, Settings } from "./screens/Profile";
import { Connectors } from "./screens/Connectors";
import { KidHelp } from "./screens/HelpCentre";
import { Remembers } from "./screens/Remembers";
import { Shared } from "./screens/Shared";
import { OC } from "./screens/OC";
import { Parent } from "./screens/Parent";
import { registerServiceWorker } from "./lib/push";
import { Google } from "./screens/Google";
import { AvatarLab } from "./screens/AvatarLab";
import { Notifications } from "./screens/Notifications";
import { Study } from "./screens/Study";
import { Art } from "./screens/Art";
import { Stories } from "./screens/Stories";

/** Shown in the sign-in window opened by an installed app, once it's done. */
function SignInDone({ error }: { error: string | null }) {
  useEffect(() => { const t = setTimeout(() => { try { window.close(); } catch { /* the browser decides */ } }, 600); return () => clearTimeout(t); }, []);
  return (
    <div className="main">
      <div className="screen narrow" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", gap: 16 }}>
        <LogoMark size={72} />
        <h2 style={{ fontSize: 30 }}>{error ? "That didn’t work" : "You’re signed in"}</h2>
        <span style={{ color: "var(--text-2)" }}>{error && wrongAppWords(error) ? wrongAppWords(error) : error === "not-allowed" ? "That account isn’t set up for Kith. Ask the grown-up who runs it." : error ? "Close this window and try again in the Kith app." : "You can close this window and go back to the Kith app."}</span>
      </div>
    </div>
  );
}

/** An installed app with someone else's session: say so, and offer to sign out. */
function WrongApp({ text }: { text: string }) {
  const signOut = async () => {
    const r = await fetch("/auth/logout", { method: "POST", headers: { "X-Kith": "1" }, credentials: "include" }).then((x) => x.json()).catch(() => ({ redirect: null })) as { redirect?: string | null };
    location.href = r.redirect || "/";
  };
  return (
    <div className="main">
      <div className="screen narrow" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", gap: 16 }}>
        <LogoMark size={72} />
        <h2 style={{ fontSize: 28 }}>{text}</h2>
        <button className="btn ghost" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}

function SignIn() {
  const [info, setInfo] = useState<{ oidc: boolean; label: string; dev: boolean } | null>(null);
  const [waiting, setWaiting] = useState<AbortController | null>(null);
  const [handoffErr, setHandoffErr] = useState("");
  const reason = new URLSearchParams(location.search).get("signin");
  // In an installed app, sign-in happens in the browser (passkeys work there) and the session is
  // handed over here. The provider's address is got ready before the click, so the click opens it
  // straight away in a normal browser tab.
  const prepared = useRef<PreparedSignIn | null>(null);
  useEffect(() => {
    if (!isInstalledApp() || !info?.oidc) return;
    const get = () => void prepareSignIn().then((p) => { prepared.current = p; });
    get();
    const t = setInterval(get, 9 * 60_000);
    return () => clearInterval(t);
  }, [info?.oidc]);
  const signInFromApp = async (e: React.MouseEvent) => {
    if (!isInstalledApp()) return; // a normal browser tab: just follow the link
    e.preventDefault();
    setHandoffErr("");
    const p = preparedFresh(prepared.current) ? prepared.current : null;
    prepared.current = null;
    const id = p?.id ?? newHandoffId();
    const ctrl = new AbortController();
    setWaiting(ctrl);
    if (p) window.open(p.url, "_blank");
    else window.open(withApp(`/auth/login?handoff=${id}`), "kith-signin", "popup,width=520,height=760"); // an older server
    void prepareSignIn().then((x) => { prepared.current = x; }); // ready for another try
    const r = await waitForHandoff(id, ctrl.signal);
    setWaiting(null);
    if (r.ok) { location.href = r.redirect; return; }
    if (r.error !== "cancelled") setHandoffErr(wrongAppWords(r.error) ?? (r.error === "not-allowed" ? "That account isn’t set up for Kith. Ask the grown-up who runs it." : "Sign-in didn’t finish. Try again?"));
  };
  useEffect(() => { api<{ oidc: boolean; label: string; dev: boolean }>("/api/public/signin").then(setInfo).catch(() => undefined); }, []);
  return (
    <div className="main">
      <div className="screen narrow" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", gap: 18 }}>
        <LogoMark size={88} />
        <h1 style={{ fontSize: 46 }}>kith</h1>
        <span className="hand">a companion that grows up with you, kept at home</span>
        {reason === "not-allowed" && <div className="notice">That account isn’t set up for Kith. Ask the grown-up who runs it.</div>}
        {reason === "failed" && <div className="notice">Sign-in didn’t work. Try again?</div>}
        {reason && wrongAppWords(reason) && <div className="notice">{wrongAppWords(reason)}</div>}
        {handoffErr && <div className="notice">{handoffErr}</div>}
        {info?.oidc && !waiting && <a className="btn primary" href={withApp("/auth/login")} onClick={signInFromApp} style={{ textDecoration: "none" }}>Sign in with {info.label}</a>}
        {waiting && (
          <div className="stack" style={{ alignItems: "center" }}>
            <span className="typing" aria-hidden><i /><i /><i /></span>
            <span>Finish signing in in your browser, then come back here.</span>
            <button className="btn ghost small" onClick={() => waiting.abort()}>Cancel</button>
          </div>
        )}
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
// The same sections as the phone's tab bar; on a computer, Create's parts are listed under it.
const NAV: { to: string; icon: IconName; label: string; sub?: boolean }[] = [
  { to: "/", icon: "chat", label: "Chat" },
  { to: "/study", icon: "study", label: "Study" },
  { to: "/languages", icon: "globe", label: "Languages" },
  { to: "/create", icon: "create", label: "Create" },
  { to: "/stories", icon: "stories", label: "Stories with a friend", sub: true },
  { to: "/art", icon: "art", label: "Art", sub: true },
  { to: "/oc", icon: "oc", label: "OC workshop", sub: true },
  { to: "/settings", icon: "settings", label: "Settings" },
];
const TABS: { to: string; icon: IconName; label: string }[] = [
  { to: "/", icon: "chat", label: "Chat" },
  { to: "/study", icon: "study", label: "Study" },
  { to: "/create", icon: "create", label: "Create" },
  { to: "/settings", icon: "settings", label: "Settings" },
];
const SETTINGS_PAGES = ["/settings", "/me", "/memory", "/shared", "/google", "/notifications", "/connectors", "/help"];

function CreateMenu({ me, go }: { me: Me; go: (to: string) => void }) {
  return (
    <div className="screen narrow dgrid">
      <span className="hand">make something</span>
      <h2 className="screen-title">Create</h2>
      {[["/stories", "pencil", "Stories with a friend", "Write together; every part credited"], ["/art", "art", "Art", "Challenges, sketchbook, mood board, feedback"], ["/oc", "oc", "OC workshop", "Your characters and their world"], ["/pip", "desk", `Ask ${me.profile.name} to make something`, "On its desk: quizzes, games, comics, slides and more"]].map(([to, ic, t, d]) => (
        <button key={to} className="card" style={{ flexDirection: "row", alignItems: "center", gap: 12, textAlign: "left" }} onClick={() => go(to)}>
          <span style={{ display: "inline-flex", color: "var(--lilac)" }}><Icon name={ic as IconName} size={26} /></span><span><b>{t}</b><br /><span className="small">{d}</span></span>
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
  const [drawer, setDrawer] = useState(false);
  // On a computer: side chats sit open beside the sidebar (closeable), and the companion's profile
  // opens in a panel on the right when its picture is tapped.
  const [dock, setDockRaw] = useState<boolean>(() => { try { return localStorage.getItem("kith-dock") !== "0"; } catch { return true; } });
  const setDock = (v: boolean) => { setDockRaw(v); try { localStorage.setItem("kith-dock", v ? "1" : "0"); } catch { /* fine */ } };
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<"desk" | "scheduled" | "who">("desk");
  // The profile isn't a page any more: it slides in over whatever you were doing. Old links to
  // /pip (and /desk) open it and leave you where you were.
  const lastPath = useRef("/");
  useEffect(() => {
    if (path === "/desk" || path.startsWith("/pip")) {
      const t = path.split("/")[2] ?? "desk";
      setProfileTab(t === "scheduled" ? "scheduled" : ["who", "soul", "personality", "memory"].includes(t) ? "who" : "desk");
      setProfileOpen(true);
      history.replaceState(null, "", lastPath.current);
      dispatchEvent(new PopStateEvent("popstate"));
    } else {
      lastPath.current = path + location.search;
    }
  }, [path]);
  const [thread, setThread] = useState<number>(() => {
    try { return Number(sessionStorage.getItem("kith-thread")) || 1; } catch { return 1; }
  });
  const [threadTitle, setThreadTitle] = useState("");
  const pickThread = (id: number) => {
    setThread(id);
    try { sessionStorage.setItem("kith-thread", String(id)); } catch { /* fine */ }
    setDrawer(false);
    if (location.pathname !== "/") go("/");
  };
  useEffect(() => {
    if (thread === 1) { setThreadTitle(""); return; }
    api<{ threads: ThreadRow[] }>("/api/threads").then((r) => {
      const t = r.threads.find((x) => x.id === thread);
      if (!t) pickThread(1); else setThreadTitle(t.title);
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread]);
  // "Ask Pip" from Study, Art or the OC workshop opens the main chat with a context chip.
  const q = new URLSearchParams(location.search);
  const qLang = q.get("lang");
  const chatContext: ChatContext | null = q.get("mode") === "language" && (qLang === "es" || qLang === "ja")
    ? { mode: "language", ctx: { lang: qLang, topic: q.get("topic")?.slice(0, 120) || undefined }, label: q.get("label") || (qLang === "es" ? "Español" : "日本語") }
    : q.get("mode") && ["study", "art", "oc"].includes(q.get("mode")!)
    ? {
        mode: q.get("mode") as ChatContext["mode"],
        ctx: { subjectId: Number(q.get("subject")) || undefined, coursework: q.get("coursework") === "1" || undefined },
        label: q.get("label") || (q.get("mode") === "study" ? "Studying" : q.get("mode") === "art" ? "Art" : "OC workshop"),
      }
    : null;
  const load = useCallback(() => api<AppState>("/api/state").then(setState).catch(() => undefined), []);
  useEffect(() => { void load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]);
  // In the Mac app: notifications, Calendar & Reminders, ⌃⌥Space to call, dropped documents.
  // Once: go only calls a stable setter.
  useEffect(() => startNative(go), []);

  const onSaved = (p: Profile) => setMe((m) => ({ ...m, profile: p }));
  if (!me.profile.setupDone) return <Meet me={me} onDone={onSaved} />;

  const energy = state?.energy;
  const baseMood: Mood = mood !== "happy" ? mood : energy?.mode === "low" ? "sleepy" : energy?.mode === "resting" ? "resting" : "happy";
  const onTurn = (t: Turn) => { setState((s) => (s ? { ...s, energy: t.energy } : s)); void load(); void checkNativeActions(); };
  const name = me.profile.name;
  const working = state?.desk.working;
  const doing = doingText(state, baseMood);
  const onProfile = false;
  const openHelp = () => setHelp(true);

  let screen: React.ReactNode;
  if (path === "/talk" && energy) screen = <Talk me={me} energy={energy} onTurn={onTurn} openHelp={openHelp} go={go} />;
  else if (path === "/oc") screen = <OC me={me} onTurn={onTurn} onMood={setMood} openHelp={openHelp} go={go} />;
  else if (path === "/memory") screen = <Remembers me={me} onSaved={onSaved} />;
  else if (path === "/me") screen = <Personality me={me} onSaved={onSaved} />;
  else if (path === "/shared") screen = <Shared me={me} />;
  else if (path === "/settings" || path === "/you") screen = <Settings me={me} go={go} state={state} />;
  else if (path === "/google") screen = <Google me={me} />;
  else if (path === "/study") screen = <Study me={me} onTurn={onTurn} onMood={setMood} openHelp={openHelp} go={go} />;
  else if (path === "/art") screen = <Art me={me} onTurn={onTurn} onMood={setMood} openHelp={openHelp} go={go} />;
  else if (path === "/stories") screen = <Stories me={me} />;
  else if (path === "/languages") screen = <Languages me={me} go={go} />;
  else if (path === "/create") screen = <CreateMenu me={me} go={go} />;
  else if (path === "/lab") screen = <AvatarLab />;
  else if (path === "/help") screen = <KidHelp me={me} go={go} />;
  else if (path === "/connectors") screen = <Connectors me={me} />;
  else if (path === "/notifications") screen = <Notifications me={me} onSaved={onSaved} />;
  else screen = (
    <>
      {thread !== 1 && (
        <div className="threadbar">
          <Icon name="sidechats" size={18} /><b style={{ flex: 1 }}>{threadTitle || "Side chat"}</b>
          <button className="chip" style={{ minHeight: 32 }} onClick={() => pickThread(1)}>Back to main chat</button>
        </div>
      )}
      <Chat key={thread} me={me} thread={thread} context={chatContext} onClearContext={() => go("/")} onSplit={pickThread}
        onTurn={onTurn} onMood={setMood} openHelp={openHelp} go={go} />
    </>
  );

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Sections">
        <button className="me brand" onClick={() => go("/")} aria-label="Kith home" style={{ border: 0, background: "none", color: "inherit", textAlign: "left", cursor: "pointer" }}>
          <img src="/icon-192.png" alt="" width={44} height={44} />
          <span><b>Kith</b></span>
        </button>
        {NAV.map((n) => {
          const on = n.to === path || (n.to === "/settings" && SETTINGS_PAGES.includes(path));
          return (
            <button key={n.to} className={`navbtn ${on ? "on" : ""} ${n.sub ? "sub" : ""}`} aria-current={on ? "page" : undefined} onClick={() => go(n.to)}>
              <span className="ic"><Icon name={n.icon} on={on} size={n.sub ? 18 : 22} /></span>{n.label}
            </button>
          );
        })}
        <button className="navbtn" style={{ color: "var(--ember)" }} onClick={openHelp}><span className="ic"><Icon name="grownup" size={22} /></span>Grown-up?</button>
        <div className="foot">
          <span className="small">{name} is an AI, not a person. It lives on your family’s home server.</span>
        </div>
      </nav>
      {dock && path === "/" && <SideChats me={me} open docked current={thread} onClose={() => setDock(false)} onPick={pickThread} />}
      <div className={`main ${!onProfile && path !== "/talk" ? "hang-m" : ""} ${path !== "/talk" && !onProfile ? "hang-d" : ""}`}>
        {path !== "/talk" && !onProfile && (
          <header className="topbar deskbar desktop-only">
            <span className="tb-left">{path === "/" && !dock && <button className="iconbtn" onClick={() => setDock(true)} aria-label="Show side chats"><Icon name="sidechats" size={22} on={thread !== 1} /></button>}</span>
            <button className={`tb-who ${profileOpen ? "gone" : ""}`} onClick={() => setProfileOpen(true)} tabIndex={profileOpen ? -1 : 0} aria-hidden={profileOpen}
              aria-label={`Open ${name}’s profile. ${name} is ${doing}.`}>
              <span className="tb-dp"><Avatar look={me.profile.look} mood={baseMood} size={64} variant="side" laptop={!!working} /></span>
              <span className="tb-label"><b>{name}</b><span aria-live="polite">{doing}</span></span>
            </button>
            <span className="tb-right">
              <button className="iconbtn call" onClick={() => go("/talk")} aria-label={`Call ${name}`}><Icon name="call" size={21} /></button>
            </span>
          </header>
        )}
        {path !== "/talk" && (
          <header className={`topbar mobile-only ${onProfile ? "slim" : ""}`}>
            <button className="tb-logo" onClick={() => go("/")} aria-label="Kith home"><img src="/icon-192.png" alt="" width={38} height={38} /></button>
            {!onProfile && (
              <button className={`tb-who ${profileOpen ? "gone" : ""}`} onClick={() => setProfileOpen(true)} aria-label={`Open ${name}’s profile. ${name} is ${doing}.`}>
                <span className="tb-dp"><Avatar look={me.profile.look} mood={baseMood} size={58} variant="side" laptop={!!working} /></span>
                <span className="tb-label"><b>{name}</b><span aria-live="polite">{doing}</span></span>
              </button>
            )}
            <span className="tb-right">
              <button className="iconbtn" onClick={() => setDrawer(true)} aria-label="Side chats"><Icon name="sidechats" size={22} on={thread !== 1} /></button>
              <button className="iconbtn call" onClick={() => go("/talk")} aria-label={`Call ${name}`}><Icon name="call" size={21} /></button>
            </span>
          </header>
        )}
        {screen}
        <nav className="tabbar" aria-label="Sections" hidden={path === "/talk"}>
          {TABS.map((t) => {
            const on = t.to === path || (t.to === "/study" && path === "/languages") || (t.to === "/create" && ["/stories", "/art", "/oc"].includes(path)) || (t.to === "/settings" && SETTINGS_PAGES.includes(path));
            return <button key={t.to} className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={() => go(t.to)}><Icon name={t.icon} on={on} /><span>{t.label}</span></button>;
          })}
          <button className="sos" onClick={openHelp}><Icon name="grownup" /><span>Grown-up?</span></button>
        </nav>
      </div>
      {path !== "/talk" && !onProfile && <ProfilePanel open={profileOpen} tab={profileTab} me={me} state={state} mood={baseMood} go={(to) => { setProfileOpen(false); go(to); }} onClose={() => setProfileOpen(false)} />}
      <SideChats me={me} open={drawer} current={thread} onClose={() => setDrawer(false)} onPick={pickThread} />
      <HelpSheet open={help} onClose={() => setHelp(false)} parentLabel={me.parentLabel} helplines={me.helplines} />
    </div>
  );
}

export function App() {
  const [me, setMe] = useState<Me | null | "signed-out">(null);
  const [err, setErr] = useState("");
  const [wrongApp, setWrongApp] = useState("");
  useEffect(() => {
    api<Me>("/api/me").then(setMe).catch((e) => {
      if (e instanceof ApiError && e.status === 401) setMe("signed-out");
      else if (e instanceof ApiError && e.code === "wrong-app") setWrongApp(e.message);
      else setErr((e as Error).message);
    });
    void registerServiceWorker();
  }, []);
  // The sign-in window an installed app opened: say it's done (whatever the session state here).
  const sp = new URLSearchParams(location.search).get("signin") ?? "";
  if (sp === "done" || sp.startsWith("done-")) return <SignInDone error={sp === "done" ? null : sp.slice(5)} />;
  if (wrongApp) return <WrongApp text={wrongApp} />;
  if (err) return <div className="main"><div className="screen narrow"><div className="notice">Kith can’t reach home right now. {err}</div></div></div>;
  if (me === null) return <div className="main" aria-busy="true" />;
  if (me === "signed-out") return <SignIn />;
  if (me.role === "parent") return <Parent me={me} />;
  return <ChildApp me={me} />;
}
