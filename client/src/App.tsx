import { appHint, withApp, wrongAppWords } from "./lib/appHint";
import { doneWords, handoffDevice, handoffWords, isInstalledApp, signinWords, prepareSignIn, preparedFresh, startHandoff, waitForHandoff, type Handoff, type PreparedSignIn } from "./lib/signin";
import { checkNativeActions, startNative } from "./lib/native";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, OFFLINE_WORDS, type AppState, type Me, type Mood, type Profile, type Turn } from "./api";
import { LogoMark } from "./components/Avatar";
import { CompanionPic, setPipPicture } from "./components/CompanionPic";
import { doingText, HelpSheet, useRoute } from "./components/bits";
import { Icon, type IconName } from "./components/Icons";
import { Meet } from "./screens/Meet";
import { Chat, type ChatContext } from "./screens/Chat";
import { SideChats, type ChatLang, type ThreadRow } from "./screens/SideChats";
import { Talk } from "./screens/Talk";
import { Personality } from "./screens/Personality";
import { ProfilePanel, Settings } from "./screens/Profile";
import { Connectors } from "./screens/Connectors";
import { KidHelp } from "./screens/HelpCentre";
import { Remembers } from "./screens/Remembers";
import { Shared } from "./screens/Shared";
import { OC } from "./screens/OC";
import { registerServiceWorker, resyncPush } from "./lib/push";
import { Google } from "./screens/Google";
import { Notifications } from "./screens/Notifications";
import { Art } from "./screens/Art";
import { Stories } from "./screens/Stories";
import { usePoll } from "./lib/poll";
import { action, Toaster } from "./lib/action";
import { WorrySheet } from "./components/WorrySheet";

// The bigger screens load when they're first opened, so the chat starts quickly on a phone.
const Parent = lazy(() => import("./screens/Parent").then((m) => ({ default: m.Parent })));
const Languages = lazy(() => import("./screens/Languages").then((m) => ({ default: m.Languages })));
const Study = lazy(() => import("./screens/Study").then((m) => ({ default: m.Study })));
const MyPip = lazy(() => import("./screens/MyPip").then((m) => ({ default: m.MyPip })));
// The avatar lab is a tool for working on Kith, so it isn't in the app people install.
const AvatarLab = import.meta.env.DEV ? lazy(() => import("./screens/AvatarLab").then((m) => ({ default: m.AvatarLab }))) : null;

/** While a lazily loaded screen arrives. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="screen narrow" style={{ alignItems: "center", justifyContent: "center" }} aria-busy="true">
      <span className="typing" aria-hidden><i /><i /><i /></span>
      <span className="sr-only" role="status">{label}</span>
    </div>
  );
}

/** Opening /talk straight away, before the app knows its energy: Grown-up? is still right there. */
function TalkLoading({ name, openHelp, go }: { name: string; openHelp: () => void; go: (to: string) => void }) {
  return (
    <div className="talk">
      <div className="head">
        <span style={{ fontSize: "0.875rem", fontWeight: 800, color: "var(--muted)" }}>Calling {name}…</span>
        <button className="grownup" onClick={openHelp}>Grown-up?</button>
      </div>
      <div className="stage" aria-busy="true">
        <span className="typing" aria-hidden><i /><i /><i /></span>
        <span role="status" style={{ fontWeight: 800, color: "var(--lilac-soft)" }}>Getting ready…</span>
      </div>
      <div className="controls">
        <button className="end" aria-label="End call" onClick={() => go("/")}><Icon name="endcall" size={26} /></button>
      </div>
    </div>
  );
}

/** Shown in the sign-in window opened by an installed app, once it's done. */
function SignInDone({ error }: { error: string | null }) {
  useEffect(() => { const t = setTimeout(() => { try { window.close(); } catch { /* the browser decides */ } }, 600); return () => clearTimeout(t); }, []);
  const w = doneWords(error, wrongAppWords);
  return (
    <div className="main">
      <div className="screen narrow" role="status" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", gap: 16 }}>
        <LogoMark size={72} />
        <h2 style={{ fontSize: "1.875rem" }}>{w.title}</h2>
        <span style={{ color: "var(--text-2)" }}>{w.text}</span>
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
        <h2 style={{ fontSize: "1.75rem" }}>{text}</h2>
        <button className="btn ghost" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}

function SignIn() {
  const [info, setInfo] = useState<{ oidc: boolean; label: string; dev: boolean } | null>(null);
  const [waiting, setWaiting] = useState<AbortController | null>(null);
  // The 4-digit code the browser's "Finish signing in?" page shows too.
  const [code, setCode] = useState("");
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
    const ctrl = new AbortController();
    setWaiting(ctrl);
    let h: Handoff;
    if (p) { h = p; setCode(p.code); window.open(p.url, "_blank"); }
    else {
      // Nothing ready (it failed earlier, or went stale): open the window now, inside the tap so
      // Safari allows it, then start a handoff and send the window to it.
      const w = window.open("", "kith-signin", "popup,width=520,height=760");
      const started = await startHandoff(appHint(), fetch, Date.now(), handoffDevice());
      if (!started) { w?.close(); setWaiting(null); setHandoffErr("Can’t reach home right now. Try again in a moment."); return; }
      h = started;
      setCode(started.code);
      const url = withApp(`/auth/login?handoff=${h.id}`);
      if (w) w.location.href = url; else window.open(url, "kith-signin", "popup,width=520,height=760");
    }
    void prepareSignIn().then((x) => { prepared.current = x; }); // ready for another try
    const r = await waitForHandoff(h, ctrl.signal);
    setWaiting(null);
    setCode("");
    if (r.ok) { location.href = r.redirect; return; }
    if (r.error !== "stopped") setHandoffErr(handoffWords(r.error, wrongAppWords));
  };
  useEffect(() => { api<{ oidc: boolean; label: string; dev: boolean }>("/api/public/signin").then(setInfo).catch(() => undefined); }, []);
  return (
    <div className="main">
      <div className="screen narrow" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", gap: 18 }}>
        <LogoMark size={88} />
        <h1 style={{ fontSize: "2.875rem" }}>kith</h1>
        <span className="hand">a companion that grows up with you, kept at home</span>
        {signinWords(reason, wrongAppWords) && <div className="notice" role="status">{signinWords(reason, wrongAppWords)}</div>}
        {handoffErr && <div className="notice" role="status">{handoffErr}</div>}
        {info?.oidc && !waiting && <a className="btn primary" href={withApp("/auth/login")} onClick={signInFromApp} style={{ textDecoration: "none" }}>Sign in with {info.label}</a>}
        {waiting && (
          <div className="stack" role="status" style={{ alignItems: "center" }}>
            <span className="typing" aria-hidden><i /><i /><i /></span>
            {code ? <>
              <span>Finish signing in in your browser. Check it shows this code, then tap <b>Yes</b>:</span>
              <span className="signin-code" role="img" aria-label={`Code ${code.split("").join(" ")}`}>{code}</span>
              <span className="small">If the browser shows a different code, tap No.</span>
            </> : <span>Finish signing in in your browser, then come back here.</span>}
            <button className="btn ghost small" onClick={() => waiting.abort()}>Cancel</button>
          </div>
        )}
        {info && !info.oidc && !info.dev && <span className="small">Sign-in isn’t set up yet. See the <a href="/setup">setup guide</a>.</span>}
        {info?.dev && (
          <div className="stack" style={{ width: "100%" }}>
            <span className="small">Local testing (KITH_DEV_LOGIN is on)</span>
            <a className="btn ghost" href="/auth/dev?role=child" style={{ textDecoration: "none" }}>Try as the child</a>
            <a className="btn ghost" href="/auth/dev?role=parent" style={{ textDecoration: "none" }}>Try as the parent</a>
          </div>
        )}
        <span className="small signin-print">By signing in you agree to the <a href="/terms" target="_blank" rel="noopener">terms of use</a>. The <a href="/privacy" target="_blank" rel="noopener">privacy policy</a> says what’s kept and who sees it.</span>
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
  // The label says the companion's own name ("My Pip").
  { to: "/my-pip", icon: "star", label: "My Pip", sub: true },
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
      {[["/stories", "pencil", "Stories with a friend", "Write together; every part credited"], ["/art", "art", "Art", "Challenges, sketchbook, mood board, feedback"], ["/oc", "oc", "OC workshop", "Your characters and their world"], ["/my-pip", "star", `My ${me.profile.name}`, `Make ${me.profile.name} in 3D: there’s only one`], ["/pip", "desk", `Ask ${me.profile.name} to make something`, "On its desk: quizzes, games, comics, slides and more"]].map(([to, ic, t, d]) => (
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
  const [threadLang, setThreadLang] = useState<string | null>(null);
  const [chatLangs, setChatLangs] = useState<ChatLang[]>([]);
  const narrow = typeof window !== "undefined" && window.innerWidth < 600;
  const pickThread = (id: number) => {
    setThread(id);
    try { sessionStorage.setItem("kith-thread", String(id)); } catch { /* fine */ }
    setDrawer(false);
    if (location.pathname !== "/") go("/");
  };
  useEffect(() => {
    if (thread === 1) { setThreadTitle(""); setThreadLang(null); return; }
    api<{ threads: ThreadRow[]; languages?: ChatLang[] }>("/api/threads").then((r) => {
      const t = r.threads.find((x) => x.id === thread);
      setChatLangs(r.languages ?? []);
      if (!t) pickThread(1); else { setThreadTitle(t.title); setThreadLang(t.lang ?? null); }
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread]);
  // "Ask Pip" from Study, Art or the OC workshop opens the main chat with a context chip.
  const q = new URLSearchParams(location.search);
  // A side chat in Spanish or Japanese is language practice all the way through.
  // (Only languages she's learning now: one her grown-up removed is an ordinary side chat again.)
  const tl = chatLangs.find((l) => l.code === threadLang);
  const chatContext: ChatContext | null = thread !== 1 && tl
    ? { mode: "language", ctx: { lang: tl.code }, label: tl.native, voice: tl.voice }
    : q.get("mode") && ["study", "art", "oc"].includes(q.get("mode")!)
    ? {
        mode: q.get("mode") as ChatContext["mode"],
        ctx: { subjectId: Number(q.get("subject")) || undefined, coursework: q.get("coursework") === "1" || undefined },
        label: q.get("label") || (q.get("mode") === "study" ? "Studying" : q.get("mode") === "art" ? "Art" : "OC workshop"),
      }
    : null;
  const load = useCallback(() => api<AppState>("/api/state").then(setState).catch(() => undefined), []);
  usePoll(load, 20_000);
  // The 3D Pip's chat picture, when there is one, stands in for the 2D avatar in small places.
  useEffect(() => { setPipPicture(state ? state.pipPicture : me.pipPicture); }, [me.pipPicture, state?.pipPicture]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // The 3D makers: the title sits right under the header (no room left for the hanging picture).
  const makerPage = path === "/my-pip" || path === "/oc";
  const openHelp = () => setHelp(true);
  // A worry typed outside chat: its words are already in the main chat.
  const goToChat = () => { setProfileOpen(false); pickThread(1); go("/"); };

  let screen: React.ReactNode;
  if (path === "/talk") screen = energy ? <Talk me={me} energy={energy} onTurn={onTurn} openHelp={openHelp} go={go} /> : <TalkLoading name={name} openHelp={openHelp} go={go} />;
  else if (path === "/oc") screen = <OC me={me} onTurn={onTurn} onMood={setMood} openHelp={openHelp} go={go} />;
  else if (path === "/my-pip") screen = <MyPip me={me} onSaved={onSaved} />;
  else if (path === "/memory") screen = <Remembers me={me} onSaved={onSaved} />;
  else if (path === "/me") screen = <Personality me={me} onSaved={onSaved} />;
  else if (path === "/shared") screen = <Shared me={me} />;
  else if (path === "/settings" || path === "/you") screen = <Settings me={me} go={go} state={state} />;
  else if (path === "/google") screen = <Google me={me} />;
  else if (path === "/study") screen = <Study me={me} onTurn={onTurn} onMood={setMood} openHelp={openHelp} go={go} />;
  else if (path === "/art") screen = <Art me={me} onTurn={onTurn} onMood={setMood} openHelp={openHelp} go={go} />;
  else if (path === "/stories") screen = <Stories me={me} />;
  else if (path === "/languages") screen = <Languages me={me} go={go} openThread={pickThread} />;
  else if (path === "/create") screen = <CreateMenu me={me} go={go} />;
  else if (path === "/lab" && AvatarLab) screen = <AvatarLab />;
  else if (path === "/help") screen = <KidHelp me={me} go={go} />;
  else if (path === "/connectors") screen = <Connectors me={me} />;
  else if (path === "/notifications") screen = <Notifications me={me} onSaved={onSaved} />;
  else screen = (
    <>
      {thread !== 1 && (
        <div className="threadbar">
          <Icon name="sidechats" size={18} /><b>{threadTitle || "Side chat"}</b>
          <select className="select" style={{ width: "auto", minHeight: 32, padding: "0 10px" }} aria-label="Language for this side chat" value={threadLang ?? ""}
            onChange={action(async (e) => { const lang = e.target.value || null; await api(`/api/threads/${thread}`, { method: "PATCH", body: { lang } }); setThreadLang(lang); }, "change the language")}>
            {/* Short names on a phone, where the picture takes the middle of the bar. */}
            <option value="">{narrow ? "Eng" : "English"}</option>
            {chatLangs.map((l) => <option key={l.code} value={l.code}>{narrow && l.native.length > 6 ? l.native.slice(0, 3) : l.native}</option>)}
          </select>
        </div>
      )}
      <Chat key={thread} me={me} thread={thread} context={chatContext}
        onClearContext={action(async () => {
          // In a language side chat, the ✕ switches that side chat back to English.
          if (thread !== 1 && threadLang) { await api(`/api/threads/${thread}`, { method: "PATCH", body: { lang: null } }); setThreadLang(null); }
          else go("/");
        }, "switch back to English")} onSplit={pickThread}
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
              <span className="ic"><Icon name={n.icon} on={on} size={n.sub ? 18 : 22} /></span>{n.to === "/my-pip" ? `My ${name}` : n.label}
            </button>
          );
        })}
        <button className="navbtn" style={{ color: "var(--ember)" }} onClick={openHelp}><span className="ic"><Icon name="grownup" size={22} /></span>Grown-up?</button>
        <div className="foot">
          <span className="small">{name} is an AI, not a person. It lives on your family’s home server.</span>
        </div>
      </nav>
      {dock && path === "/" && <SideChats me={me} open docked current={thread} onClose={() => setDock(false)} onPick={pickThread} />}
      <div className={`main ${!onProfile && path !== "/talk" && !makerPage ? "hang-m" : ""} ${path !== "/talk" && !onProfile && !makerPage ? "hang-d" : ""}`}>
        {path !== "/talk" && !onProfile && (
          <header className="topbar deskbar desktop-only">
            <span className="tb-left">{path === "/" && !dock && <button className="iconbtn" onClick={() => setDock(true)} aria-label="Show side chats"><Icon name="sidechats" size={22} on={thread !== 1} /></button>}</span>
            {/* My Pip shows Pip itself in 3D, so its picture isn't repeated up here. */}
            {path !== "/my-pip" && <button className={`tb-who ${profileOpen ? "gone" : ""}`} onClick={() => setProfileOpen(true)} tabIndex={profileOpen ? -1 : 0} aria-hidden={profileOpen}
              aria-label={`Open ${name}’s profile. ${name} is ${doing}.`}>
              <span className="tb-dp"><CompanionPic look={me.profile.look} mood={baseMood} size={64} variant="side" laptop={!!working} live={profileOpen ? "off" : "on"} /></span>
              <span className="tb-label"><b>{name}</b><span>{doing}</span></span>
            </button>}
            <span className="tb-right">
              <button className="iconbtn call" onClick={() => go("/talk")} aria-label={`Call ${name}`}><Icon name="call" size={21} /></button>
            </span>
          </header>
        )}
        {path !== "/talk" && (
          <header className={`topbar mobile-only ${onProfile ? "slim" : ""}`}>
            <button className="tb-logo" onClick={() => go("/")} aria-label="Kith home"><img src="/icon-192.png" alt="" width={38} height={38} /></button>
            {/* On a phone the 3D makers need the room: no picture up here on My Pip or the OC workshop. */}
            {!onProfile && !makerPage && (
              <button className={`tb-who ${profileOpen ? "gone" : ""}`} onClick={() => setProfileOpen(true)} aria-label={`Open ${name}’s profile. ${name} is ${doing}.`}>
                <span className="tb-dp"><CompanionPic look={me.profile.look} mood={baseMood} size={58} variant="side" laptop={!!working} live={profileOpen ? "off" : "on"} /></span>
                <span className="tb-label"><b>{name}</b><span>{doing}</span></span>
              </button>
            )}
            <span className="tb-right">
              <button className="iconbtn" onClick={() => setDrawer(true)} aria-label="Side chats"><Icon name="sidechats" size={22} on={thread !== 1} /></button>
              <button className="iconbtn call" onClick={() => go("/talk")} aria-label={`Call ${name}`}><Icon name="call" size={21} /></button>
            </span>
          </header>
        )}
        <Suspense fallback={<Loading />}>{screen}</Suspense>
        <nav className="tabbar" aria-label="Sections" hidden={path === "/talk"}>
          {TABS.map((t) => {
            const on = t.to === path || (t.to === "/study" && path === "/languages") || (t.to === "/create" && ["/stories", "/art", "/oc", "/my-pip"].includes(path)) || (t.to === "/settings" && SETTINGS_PAGES.includes(path));
            return <button key={t.to} className={on ? "on" : ""} aria-current={on ? "page" : undefined} onClick={() => go(t.to)}><Icon name={t.icon} on={on} /><span>{t.label}</span></button>;
          })}
          <button className="sos" onClick={openHelp}><Icon name="grownup" /><span>Grown-up?</span></button>
        </nav>
      </div>
      {path !== "/talk" && !onProfile && <ProfilePanel open={profileOpen} tab={profileTab} me={me} state={state} mood={baseMood} go={(to) => { setProfileOpen(false); go(to); }} onClose={() => setProfileOpen(false)} />}
      <SideChats me={me} open={drawer} current={thread} onClose={() => setDrawer(false)} onPick={pickThread} />
      <WorrySheet name={me.profile.name} goToChat={goToChat} openHelp={openHelp} />
      <HelpSheet open={help} onClose={() => setHelp(false)} parentLabel={me.parentLabel} helplines={me.helplines} />
    </div>
  );
}

/** Home couldn't be reached at start-up: try again on a tap, when the network comes back, or when Kith is opened again. */
function CantReach({ text, retry }: { text: string; retry: () => void }) {
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) retry(); };
    addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVisible);
    return () => { removeEventListener("online", retry); document.removeEventListener("visibilitychange", onVisible); };
  }, [retry]);
  return (
    <div className="main">
      <div className="screen narrow" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", gap: 16 }}>
        <LogoMark size={72} />
        <div className="notice" role="alert">{text}</div>
        <button className="btn primary" onClick={retry}>Try again</button>
        <span className="small">Kith tries again by itself when the internet comes back.</span>
      </div>
    </div>
  );
}

function Root() {
  const [me, setMe] = useState<Me | null | "signed-out">(null);
  const [err, setErr] = useState("");
  const [wrongApp, setWrongApp] = useState("");
  const busy = useRef(false);
  const loadMe = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    api<Me>("/api/me").then((m) => { setErr(""); setPipPicture(m.pipPicture); setMe(m); }).catch((e) => {
      if (e instanceof ApiError && e.status === 401) { setErr(""); setMe("signed-out"); }
      else if (e instanceof ApiError && e.code === "wrong-app") setWrongApp(e.message);
      else setErr((e as Error).message || OFFLINE_WORDS);
    }).finally(() => { busy.current = false; });
  }, []);
  useEffect(() => {
    loadMe();
    void registerServiceWorker();
  }, [loadMe]);
  // Notifications belong to the session that turned them on: re-register this device for this one.
  const signedIn = Boolean(me && me !== "signed-out");
  useEffect(() => { if (signedIn) void resyncPush(); }, [signedIn]);
  // The welcome page's Sign in goes to /signin; once signed in, that's just the app's home.
  useEffect(() => {
    if (me && me !== "signed-out" && location.pathname === "/signin") history.replaceState(null, "", `/${location.search}`);
  }, [me]);
  // The sign-in window an installed app opened: say it's done (whatever the session state here).
  const sp = new URLSearchParams(location.search).get("signin") ?? "";
  if (sp === "done" || sp.startsWith("done-")) return <SignInDone error={sp === "done" ? null : sp.slice(5)} />;
  if (wrongApp) return <WrongApp text={wrongApp} />;
  if (err) return <CantReach text={err === OFFLINE_WORDS ? err : `Kith can’t reach home right now. ${err}`} retry={loadMe} />;
  if (me === null) return <div className="main" aria-busy="true" />;
  if (me === "signed-out") return <SignIn />;
  if (me.role === "parent") return <Suspense fallback={<div className="main"><Loading /></div>}><Parent me={me} /></Suspense>;
  return <ChildApp me={me} />;
}

export function App() {
  return <><Root /><Toaster /></>;
}
