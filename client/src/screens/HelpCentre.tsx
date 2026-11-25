import { useMemo, useState } from "react";
import type { Me } from "../api";
import { Icon, type IconName } from "../components/Icons";

export interface Topic { icon: IconName; title: string; items: { q: string; a: React.ReactNode; words?: string }[] }

function textOf(n: React.ReactNode): string {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join(" ");
  if (typeof n === "object" && "props" in n) return textOf((n as { props: { children?: React.ReactNode } }).props.children);
  return "";
}

/** A searchable help centre: topics with questions that open up. */
export function HelpCentre({ topics, kid }: { topics: Topic[]; kid: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return topics;
    return topics.map((tp) => ({ ...tp, items: tp.items.filter((it) => `${it.q} ${textOf(it.a)} ${it.words ?? ""}`.toLowerCase().includes(t)) })).filter((tp) => tp.items.length);
  }, [q, topics]);
  return (
    <div className={`helpc ${kid ? "kid" : ""}`}>
      <label className="helpc-search"><Icon name="question" size={18} />
        <input className="input" placeholder={kid ? "What do you want to know?" : "Search help"} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search help" />
      </label>
      {shown.length === 0 && <div className="pempty-state"><Icon name="question" size={22} /><span>{kid ? "Hmm, nothing about that here. Ask in chat, or tap Grown-up?" : "Nothing matches. Try another word, or see docs/ in the project."}</span></div>}
      <div className="helpc-topics">
        {shown.map((tp) => (
          <section key={tp.title} className="card helpc-topic">
            <h3 className="psec-h"><span className="psec-ic"><Icon name={tp.icon} size={18} /></span>{tp.title}</h3>
            {tp.items.map((it) => {
              const id = `${tp.title}|${it.q}`;
              const isOpen = open === id || !!q.trim();
              return (
                <div key={it.q} className={`helpc-item ${isOpen ? "open" : ""}`}>
                  <button className="helpc-q" aria-expanded={isOpen} onClick={() => setOpen(open === id ? null : id)}>
                    <span>{it.q}</span><Icon name="arrow" size={16} style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
                  </button>
                  {isOpen && <div className="helpc-a">{it.a}</div>}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

/** The child's help centre: short, friendly answers. */
export function KidHelp({ me, go }: { me: Me; go: (to: string) => void }) {
  const n = me.profile.name, g = me.parentLabel;
  const topics: Topic[] = [
    { icon: "heart", title: `About ${n}`, items: [
      { q: `Is ${n} a real person?`, a: <>No. {n} is an AI: a computer program that’s good at chatting. It isn’t a person, and it can get things wrong sometimes, so check important stuff.</>, words: "ai robot human" },
      { q: `Where does ${n} live?`, a: <>On your family’s home server, a computer at home. Not out on the internet.</> },
      { q: `Can I change ${n}’s name or personality?`, a: <>Yes! Settings › Edit {n}. You can change the name, personality and voice any time. You can also write {n}’s soul in its profile (tap {n}’s picture › Who {n} is).</>, words: "rename voice look" },
    ] },
    { icon: "shield", title: "Privacy and safety", items: [
      { q: `Can ${g} read my chats?`, a: <>No. Your everyday chats are between you and {n}. {g} sees how much energy is used, the weekly summary you both see, and anything {n} is worried about.</>, words: "private secret mum dad parent see" },
      { q: `What if ${n} is worried about me?`, a: <>{n} will <b>tell you first</b>, then let {g} know. You won’t be in trouble. It’s to keep you safe.</>, words: "report tell" },
      { q: "What’s Grown-up?", a: <>It’s on every screen. Tap it to message {g}, or call Childline (0800 1111, free, any time) or 999 if you’re in danger.</>, words: "help emergency childline 999" },
      { q: "What does the heartbeat do?", a: <>Every half hour, {n} has a quick look at what’s coming up, like reminders and exams. Usually it does nothing. Sometimes it sends one gentle check-in. Never at night.</>, words: "heartbeat scheduled" },
    ] },
    { icon: "battery", title: "Energy", items: [
      { q: "What’s Full power and Low power?", a: <>{n} has energy each week. On Full power it’s at its smartest. When energy gets low it switches to Low power: still there to chat, just a bit simpler. It tops up again on its own.</>, words: "usage battery" },
      { q: "How do I see how much is left?", a: <>Type <b>/usage</b> in chat, or look in Settings.</> },
    ] },
    { icon: "chat2", title: "Chatting", items: [
      { q: "What are side chats?", a: <>A separate chat for a different topic, so you don’t lose your place. Tap any message › Side chat from here, or type <b>/new</b>.</>, words: "thread split" },
      { q: "What can I type after /?", a: <>Type <b>/</b> in chat to see everything: <b>/usage</b>, <b>/skills</b>, <b>/connectors</b>, <b>/memory</b>, <b>/help</b> and any commands {g} made for you.</>, words: "commands slash" },
      { q: `Can ${n} remember things?`, a: <>Yes, things that matter, like a test coming up, but {n} always asks first and only remembers it if you tap yes. {n} can’t change or forget memories itself: you can see and delete them in Settings › What {n} remembers, or type <b>/memory</b>.</>, words: "memory forget" },
      { q: "Can we talk out loud?", a: <>Yes: tap the phone button to call {n}. It listens, and talks back in the voice you picked.</>, words: "call voice talk" },
    ] },
    { icon: "desk", title: `${n}’s desk`, items: [
      { q: "What’s the desk?", a: <>{n}’s own little computer at home. It makes things you ask for there: quizzes, stories, games, flashcards. Tap {n}’s picture to see it.</> },
      { q: "Can I use the browser?", a: <>Yes: Take over on the desk’s bottom bar lets you click and type. Some sites are blocked, and signing in isn’t allowed.</>, words: "web internet" },
    ] },
    { icon: "study", title: "School", items: [
      { q: `Will ${n} do my homework?`, a: <>{n} helps you <b>learn</b> it: hints, explanations, quizzes. For coursework it only gives feedback and asks questions. That way it’s really your work.</>, words: "coursework cheat" },
      { q: "How do I revise with it?", a: <>Open Study: add your subjects and exam dates, and {n} makes a gentle plan, flashcards and practice questions.</> },
    ] },
    { icon: "bell", title: "Notifications", items: [
      { q: "How do I turn them on?", a: <>Settings › Notifications. On an iPhone, add Kith to your Home Screen first (Share › Add to Home Screen).</>, words: "iphone push" },
    ] },
  ];
  return (
    <div className="screen narrow">
      <h2 className="screen-title">Help</h2>
      <span className="hand sub">stuck? no worries</span>
      <HelpCentre topics={topics} kid />
      <div className="card" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <span className="psec-ic"><Icon name="chat2" size={18} /></span>
        <span style={{ flex: 1 }} className="small">Still stuck? Just ask {n} in chat, or tap <b>Grown-up?</b></span>
        <button className="btn ghost small" onClick={() => go("/")}>Ask {n}</button>
      </div>
    </div>
  );
}

/** The parent's help centre: how it all works, in detail. */
export function ParentHelp({ companion, child }: { companion: string; child: string }) {
  const n = companion;
  const code = (s: string) => <code className="hc-code">{s}</code>;
  const topics: Topic[] = [
    { icon: "home", title: "Getting started", items: [
      { q: "What do I need to set up?", a: <><p>Kith runs with Docker Compose on your home server. In <b>.env</b>: {code("KITH_SESSION_SECRET")}, {code("KITH_DESK_TOKEN")} and {code("KITH_SECRET_KEY")} (each {code("openssl rand -hex 32")}), {code("KITH_PUBLIC_URL")}, and sign-in (Pocket ID, below). Then {code("docker compose up -d")}.</p><p>Then add the Anthropic API key in Settings › Claude. The full walkthrough is in {code("docs/setup.md")}.</p></>, words: "install docker env" },
      { q: "Where does the Anthropic API key go?", a: <><p>Settings › Claude. It’s checked with Anthropic, stored encrypted with {code("KITH_SECRET_KEY")} and never shown again (only the last four characters). It overrides {code("ANTHROPIC_API_KEY")} in .env.</p><p>Use an <b>API organisation</b> under Anthropic’s Commercial Terms, and set a monthly spend limit in the Console as your real safety net (see {code("docs/minors-policy.md")}).</p></>, words: "api key claude anthropic console" },
      { q: "How do sign-ins work (Pocket ID)?", a: <><p>Sign-in is OpenID Connect, set in .env because changing it from inside the app could lock you out: {code("KITH_OIDC_ISSUER")}, {code("KITH_OIDC_CLIENT_ID")} (and secret, or a public client with PKCE).</p><p>Roles come from Pocket ID groups ({code("KITH_OIDC_CHILD_GROUP")}, {code("KITH_OIDC_PARENT_GROUP")}) or from listed emails/user IDs. Unverified emails are ignored unless {code("KITH_OIDC_TRUST_EMAIL")} is set. Signing out also signs out of Pocket ID.</p></>, words: "oidc login groups passkey" },
    ] },
    { icon: "fire", title: "Budgets and power", items: [
      { q: "How do Full power and Low power switch?", a: <><p><b>Full power</b> ({code("claude-sonnet-5-5")}) is used while more than your “Low power below” % is left in both this week’s chat budget and the current window (default 5 hours, with rollover from quieter windows).</p><p><b>Low power</b> ({code("claude-haiku-5-5")}) takes over when either runs low, and Full power comes back on its own as the window frees up or the week resets. Study always uses Low power. At the monthly <b>hard stop</b> everything rests (Grown-up? still works).</p></>, words: "sonnet haiku model money" },
      { q: "How is the money split?", a: <>The weekly budget is split between chat and calls, and the desk (Studio, browsing, journal, heartbeat). The desk gets a daily slice; unused days roll on within the week. The Overview shows spending, a month projection and where it went.</> },
    ] },
    { icon: "shield", title: "Safety and reports", items: [
      { q: "What gets reported to me?", a: <><p>Every message is checked (fixed rules plus a safety model). If something needs you, {n} <b>tells {child} first</b>, then sends a report at its level: <b>Right now</b>, <b>Today</b> or <b>Just so you know</b>, through your reporters (e.g. Home Assistant). {child} sees the same list.</p><p>Use “Send a test” under Reports to check delivery.</p></>, words: "report alert notify" },
      { q: "What are safeguards?", a: <>Rules that always come first, ahead of the soul and personality {child} writes, and ahead of any skill. Built-in ones are always on; add your family’s own in Settings › Safeguards. They’re not shown on {child}’s profile.</>, words: "rules" },
      { q: "Can I read their chats?", a: <>No, by design. You see money, reports, the weekly summary you both see, the desk, tools used, and the heartbeat log. That trust is what makes {child} willing to talk to {n} about hard things.</>, words: "privacy" },
      { q: "How long is data kept?", a: <>Chats (and their archived history) are deleted after your retention setting (max 30 days). Reports, weekly summaries and the journal are kept for a year. Spending for about 13 months.</>, words: "retention delete" },
    ] },
    { icon: "heart", title: "Heartbeat", items: [
      { q: "What is the heartbeat?", a: <><p>Every 30 minutes, always (it can’t be switched off), {n} looks at what’s coming up (reminders, exam dates, things it made, things {child} mentioned) against your checklist in Settings › Heartbeat, and decides if anything needs doing. Usually nothing.</p><p>When something does, it sends <b>one gentle check-in</b> (within your daily limit, never in quiet hours, never while they’re chatting, safety-checked) or writes a line in its journal.</p></>, words: "muse schedule" },
      { q: "What does it cost?", a: <>Very little: it runs on Low power from the desk’s budget, beats “asleep” in quiet hours without calling Claude, and skips calling Claude when nothing has changed since the last beat. Recent beats are listed under Settings › Heartbeat.</> },
    ] },
    { icon: "desk", title: "The desk and its browser", items: [
      { q: "What is the desk?", a: <>A locked-down container where {n} makes things (games, quizzes, stories, slides). It has no internet except its browser, and can’t touch the rest of your network.</> },
      { q: "How does the browser stay safe?", a: <><p>The whole web minus a block list (categories, your own list, and a public list fetched daily), enforced in three places: the server, the desk browser and the egress proxy. {n} only reads, stops at robot checks, and every page is safety-checked and logged.</p><p>When someone takes over they can click and type, but sign-ins are blocked. You can clear its saved data in Settings › Browser.</p></>, words: "block list proxy captcha" },
    ] },
    { icon: "sparkle", title: "Connectors and skills", items: [
      { q: "What are connectors?", a: <>Things {n} can use beyond chat: Home Assistant (only the entities you list), Kin, Jellyfin, any MCP server (only the tools you allow), Google Drive, websites. Each is “look only” or “can act”; anything that spends money, messages people or posts online is never offered. Tokens stay in .env. {child} sees what’s on.</>, words: "mcp home assistant tools" },
      { q: "What can it do in my child’s Google account?", a: <><p>By default it only saves what it makes into a Kith folder in their own Drive. In Connections › Google you can also switch on, separately: editing Docs, Sheets and Slides they pick (or Kith made), their Google Calendar, and a Homework list in Google Tasks.</p><p>Every change is shown to {child} first as a short summary, and only happens when they tap Yes. Google keeps every version of an edited file. Coursework is never edited. Calendar events never have guests, and Kith only changes events it added. Nothing is ever deleted, shared or emailed, and Gmail, contacts and photos are never used. Every read and write is in the tool log. Setup steps are in docs/google.md.</p></>, words: "google drive docs sheets slides calendar tasks homework edit" },
      { q: "What are skills and /commands?", a: <><p>How-tos you write (Skills page). {n} sees each name and when to use it, and loads the full text only when relevant. Give one a command and {child} can type it in chat, e.g. {code("/quiz")}.</p><p>Built-in commands ({code("/usage")}, {code("/connectors")}, {code("/skills")}, {code("/reload-skills")}, {code("/memory")}…) show a card without using energy.</p></>, words: "skill command slash" },
    ] },
    { icon: "bell", title: "Notifications", items: [
      { q: "How do I get notifications myself?", a: <><p>Settings › Notifications to you › “Let notifications reach this device”, on each phone or computer you want them on (they’re separate from {child}’s). Choose which reports reach you: “Right now” is on by default and comes through even in quiet hours; “Today” and “Just so you know” are off by default, and wait until quiet hours end. You can also get the weekly summary and budget alerts.</p><p>By default the lock screen only says something needs you. Turn on “Show the report’s one-line summary” if you’d rather see it there. {child}’s chat text is never sent.</p></>, words: "push alert phone parent" },
      { q: "Why does my Dock or Home Screen app say “Kith” instead of “Kith Parent”?", a: <>An installed app keeps the name it was installed with. Sign in as the parent first, then add it (Safari › File › Add to Dock, or Share › Add to Home Screen on iPhone). If you added it before this change, remove it and add it again.</>, words: "name dock home screen install title" },
      { q: "Why aren’t notifications working?", a: <>They need VAPID keys in .env ({code("KITH_VAPID_PUBLIC_KEY")}, {code("KITH_VAPID_PRIVATE_KEY")}). On an iPhone, Kith must be added to the Home Screen first. {child} chooses which kinds they get in Settings › Notifications.</>, words: "push vapid iphone" },
    ] },
    { icon: "warn", title: "Troubleshooting", items: [
      { q: `${n} says it isn’t switched on yet`, a: <>No API key is set. Add it in Settings › Claude (needs {code("KITH_SECRET_KEY")}).</> },
      { q: "The desk can’t save (EACCES)", a: <>The desk volume belongs to an older user. Run the one-off fix in {code("docs/setup.md")} (chown the desk volume to uid 1001).</> },
      { q: "A site won’t open in the desk browser", a: <>It may be on a block list, need sign-in (blocked), or show a robot check. Check “Every page today” on the desk.</> },
    ] },
  ];
  return <HelpCentre topics={topics} kid={false} />;
}
