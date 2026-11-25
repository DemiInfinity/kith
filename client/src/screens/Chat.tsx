import { useEffect, useRef, useState } from "react";
import { ConfirmCard } from "../components/ConfirmCard";
import { api, type Me, type Message, type Mode, type ModeCtx, type Mood, type ReportInfo, type Turn } from "../api";
import { dayLabel, EnergyCard } from "../components/bits";
import type { AppState, Memory } from "../api";
import { Icon, type IconName } from "../components/Icons";
import { isMacApp, pickDocument, type SharedFile } from "../lib/native";
import { hasKana, parseLesson, say, voiceFor } from "../lib/kana";
import { CharacterCard } from "../components/CharacterCard";
import { refreshCharacters } from "../lib/characters";

/** What the chat is about right now (set by "Ask Pip" buttons in Study, Art, the OC workshop…). */
export interface ChatContext { mode: Mode; ctx: ModeCtx; label: string; voice?: string }

interface Props {
  me: Me;
  thread: number;
  context: ChatContext | null;
  onClearContext: () => void;
  onSplit: (threadId: number) => void;
  onTurn: (t: Turn) => void;
  onMood: (m: Mood) => void;
  openHelp: () => void;
  go: (to: string) => void;
}

const SESSION_GAP = 6 * 3_600_000;

/** Built-in "/" commands. Info ones show a card in the chat (no energy used); the rest just do the thing. */
export const BUILTIN: { cmd: string; name: string; desc: string; icon: IconName }[] = [
  { cmd: "help", name: "Commands", desc: "Everything you can type after /", icon: "question" },
  { cmd: "usage", name: "Usage", desc: "How much energy is left", icon: "battery" },
  { cmd: "connectors", name: "Connectors", desc: "What’s connected, like MCP servers", icon: "sparkle" },
  { cmd: "skills", name: "Skills", desc: "Skills and their commands", icon: "bulb" },
  { cmd: "reload-skills", name: "Reload skills", desc: "Get the latest skills from your grown-up", icon: "newchat" },
  { cmd: "memory", name: "Memory", desc: "What’s remembered about you", icon: "brain" },
  { cmd: "schedule", name: "Scheduled", desc: "Reminders and things you asked for", icon: "calendar" },
  { cmd: "es", name: "Español", desc: "A side chat in Spanish", icon: "globe" },
  { cmd: "ja", name: "日本語", desc: "A side chat in Japanese", icon: "globe" },
  { cmd: "desk", name: "Desk", desc: "Open the desk", icon: "desk" },
  { cmd: "new", name: "New side chat", desc: "Start a side chat", icon: "newchat" },
  { cmd: "call", name: "Call", desc: "Start a call", icon: "call" },
  { cmd: "grownup", name: "Grown-up?", desc: "Message a grown-up or a helpline", icon: "grownup" },
  { cmd: "settings", name: "Settings", desc: "Open settings", icon: "settings" },
];
type Card = { id: number; cmd: string; body: React.ReactNode };

function sessionNoticeNeeded(messages: Message[]) {
  let seen = false;
  try { seen = sessionStorage.getItem("kith-ai-notice") === "1"; } catch { /* private mode */ }
  const last = messages[messages.length - 1];
  return !seen || !last || Date.now() - last.ts > SESSION_GAP;
}

const QUICK: Record<string, string[][]> = {
  chat: [["study", "Can you help with my homework?"], ["chat2", "Can I talk something through?"], ["sparkle", "Write me a story"], ["cards", "Make me some flashcards"]],
  study: [["brain", "Quiz me on what I revised today"], ["question", "Explain this simply"], ["note", "How do I answer an 'evaluate' question?"], ["breath", "I'm stressed about exams"]],
  art: [["bulb", "Give me a drawing prompt"], ["brush", "How do I shade skin tones?"], ["landmark", "Who should I look at for bold colour?"], ["chat2", "Here's what I drew today…"]],
  es: [["chat2", "¡Hola! ¿Qué tal?"], ["question", "¿Cómo se dice “dragon”?"], ["cards", "Quiz me on my words"], ["note", "Can you explain the past tense?"]],
  ja: [["chat2", "こんにちは！"], ["question", "How do I say “I like drawing”?"], ["cards", "Quiz me on hiragana"], ["note", "Let’s practise ordering ramen"]],
  anylang: [["chat2", "Hi! Let’s chat"], ["question", "How do I say “dragon”?"], ["cards", "Quiz me on my words"], ["note", "Explain a bit of grammar"]],
  oc: [["sparkle", "Help me make a new OC"], ["art", "Make a palette for my OC"], ["map", "Let's build their world"], ["mask", "Let's play a scene"]],
};

export function Chat({ me, thread, context, onClearContext, onSplit, onTurn, onMood, openHelp, go }: Props) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [made, setMade] = useState<Record<number, Turn["effects"]>>({});
  // Only one character preview animates at a time ("message id:character id"); the newest by default.
  const [liveCard, setLiveCard] = useState<string | null>(null);
  const [text, setText] = useState("");
  // A document shared from the Mac app (picked, or dropped on the window): its text only.
  const [file, setFile] = useState<SharedFile | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ ok: boolean; file?: SharedFile; error?: string }>).detail;
      if (d.ok && d.file) { setFile(d.file); setErr(""); } else setErr(d.error ?? "Couldn't read that file.");
    };
    addEventListener("kith-file", on);
    return () => removeEventListener("kith-file", on);
  }, []);
  const attach = async () => {
    try { const f = await pickDocument(); if (f) { setFile(f); setErr(""); } } catch (e) { setErr((e as Error).message ?? String(e)); }
  };
  // "/" commands from the skills their grown-up wrote.
  const [cmds, setCmds] = useState<{ id: number; name: string; description: string; command: string | null }[]>([]);
  const [slashPick, setSlashPick] = useState(0);
  const loadSkills = () => api<{ skills: typeof cmds }>("/api/skills").then((r) => { setCmds(r.skills.filter((k) => k.command)); return r.skills; });
  useEffect(() => { void loadSkills().catch(() => undefined); }, []);
  type Item = { key: string; cmd: string; name: string; desc: string; icon: IconName; skill: boolean };
  const allCommands: Item[] = [
    ...BUILTIN.map((b) => ({ key: `b-${b.cmd}`, cmd: b.cmd, name: b.name, desc: b.desc, icon: b.icon, skill: false })),
    ...cmds.map((k) => ({ key: `s-${k.id}`, cmd: k.command!, name: k.name, desc: k.description, icon: "bulb" as IconName, skill: true })),
  ];
  const slashMatches = /^\/[a-z0-9-]*$/i.test(text) ? allCommands.filter((k) => k.cmd.startsWith(text.slice(1).toLowerCase())) : [];
  const [cards, setCards] = useState<Card[]>([]);
  useEffect(() => setCards([]), [thread]);
  useEffect(() => setSlashPick(0), [text]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // One quiet status line for screen readers: it says only the newest reply (or what went wrong).
  const [announce, setAnnounce] = useState("");
  const name = me.profile.name;
  const mode: Mode = context?.mode ?? "chat";
  // Language practice: English hints shown, or one tap away (her choice, remembered on this device).
  const [hints, setHints] = useState(() => { try { return localStorage.getItem("kith-hints") !== "0"; } catch { return true; } });
  const setHintsSaved = (v: boolean) => { setHints(v); try { localStorage.setItem("kith-hints", v ? "1" : "0"); } catch { /* fine */ } };

  useEffect(() => {
    setMessages(null);
    setPicked(null);
    api<{ messages: Message[] }>(`/api/messages?thread=${thread}`).then((r) => {
      setMessages(r.messages);
      if (thread === 1 && sessionNoticeNeeded(r.messages)) {
        setNotice(true);
        try { sessionStorage.setItem("kith-ai-notice", "1"); } catch { /* fine */ }
      }
    }).catch((e) => setErr((e as Error).message));
  }, [thread]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages, busy]);
  // The composer grows with what's typed (up to its max height), and shrinks again after sending.
  useEffect(() => {
    const t = box.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight + 3}px`;
  }, [text]);
  // The command card floats over the chat; Esc or a click elsewhere closes it.
  useEffect(() => {
    if (!cards.length) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setCards([]); };
    const c = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.(".cmdpop, .composer, .slashmenu")) setCards([]); };
    addEventListener("keydown", k);
    addEventListener("mousedown", c);
    return () => { removeEventListener("keydown", k); removeEventListener("mousedown", c); };
  }, [cards.length]);

  /** Runs a built-in command. Returns false if it isn't one. */
  const runBuiltin = async (raw: string): Promise<boolean> => {
    const m = /^\/([a-z0-9-]+)\s*$/i.exec(raw.trim());
    if (!m) return false;
    const cmd = m[1].toLowerCase();
    if (!BUILTIN.some((b) => b.cmd === cmd)) return false;
    setText("");
    const card = (body: React.ReactNode) => setCards([{ id: Date.now(), cmd, body }]);
    try {
      // /es and /ja open a side chat in that language (the main chat stays as it is).
      if (cmd === "es" || cmd === "ja") onSplit((await api<{ id: number }>("/api/threads", { body: { lang: cmd, title: cmd === "es" ? "Español" : "日本語" } })).id);
      else if (cmd === "desk") go("/pip");
      else if (cmd === "schedule") go("/pip/scheduled");
      else if (cmd === "call") go("/talk");
      else if (cmd === "settings") go("/settings");
      else if (cmd === "grownup") openHelp();
      else if (cmd === "new") { const t = await api<{ id: number }>("/api/threads", { body: {} }); onSplit(t.id); }
      else if (cmd === "help") card(<div className="stack" style={{ gap: 4 }}>{allCommands.map((k) => <span key={k.key} className="row" style={{ gap: 8 }}><span className="pcmd">/{k.cmd}</span><span className="small">{k.desc}</span></span>)}</div>);
      else if (cmd === "usage") {
        const st = await api<AppState>("/api/state");
        card(<><EnergyCard energy={st.energy} /><span className="small">{name}’s desk has {st.desk.percent}% of today’s energy left, separate from chat.</span></>);
      } else if (cmd === "connectors") {
        const r = await api<{ connectors: { id: string; name: string; level: string; kind: string }[] }>("/api/connectors");
        card(r.connectors.length ? <div className="stack" style={{ gap: 6 }}>{r.connectors.map((c) => <span key={c.id} className="row" style={{ gap: 8 }}><b style={{ flex: 1 }}>{c.name}</b><span className={`clevel ${c.level}`}>{c.level === "act" ? "can act" : "look only"}</span></span>)}<button className="btn ghost small" onClick={() => go("/connectors")}>See what each one does</button></div>
          : <span className="small">Nothing’s connected yet. {me.parentLabel} chooses connectors.</span>);
      } else if (cmd === "reload-skills") {
        const list = await loadSkills();
        card(<span style={{ fontSize: "0.875rem" }}>{list.length ? <>Got the latest: <b>{list.length}</b> skill{list.length === 1 ? "" : "s"} on{list.some((k) => k.command) ? <>, with {list.filter((k) => k.command).map((k) => `/${k.command}`).join(", ")}</> : null}.</> : "No skills are on right now."}</span>);
      } else if (cmd === "skills") {
        const r = await api<{ skills: { id: number; name: string; description: string; command: string | null }[] }>("/api/skills");
        card(r.skills.length ? <div className="stack" style={{ gap: 6 }}>{r.skills.map((k) => <span key={k.id} className="row" style={{ gap: 8 }}>{k.command ? <span className="pcmd">/{k.command}</span> : <Icon name="bulb" size={16} />}<span><b>{k.name}</b><span className="small"> · {k.description}</span></span></span>)}</div>
          : <span className="small">No skills yet. {me.parentLabel} can add some.</span>);
      } else if (cmd === "memory") {
        const r = await api<{ memories: Memory[] }>("/api/memories");
        card(<div className="stack" style={{ gap: 6 }}>{r.memories.length ? r.memories.slice(0, 12).map((mm) => <span key={mm.id} style={{ fontSize: "0.875rem" }}>{mm.icon} {mm.text}</span>) : <span className="small">Nothing yet.</span>}<button className="btn ghost small" onClick={() => go("/memory")}>See and delete memories</button></div>);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
    return true;
  };
  const pickCommand = (k: { cmd: string; skill: boolean }, run = false) => {
    if (!k.skill && run) void runBuiltin(`/${k.cmd}`);
    else setText(`/${k.cmd} `);
  };

  const send = async (t = text) => {
    const shared = file;
    const body = t.trim() || (shared ? "Can you have a look at this?" : "");
    if (!body || busy) return;
    if (!shared && await runBuiltin(body)) return;
    setText("");
    setFile(null);
    setErr("");
    setBusy(true);
    onMood("thinking");
    const temp: Message = { id: -Date.now(), ts: Date.now(), role: "child", text: shared ? `${body}\n\n📄 ${shared.name}` : body, mode, meta: null };
    setMessages((m) => [...(m ?? []), temp]);
    try {
      const turn = await api<Turn>("/api/chat", { body: { text: body, mode, ctx: context?.ctx ?? {}, thread, file: shared ? { name: shared.name, text: shared.text } : undefined } });
      setMessages((m) => [...(m ?? []).filter((x) => x.id !== temp.id), turn.child, turn.reply]);
      if (turn.effects.jobs.length || turn.effects.confirms?.length) setMade((x) => ({ ...x, [turn.reply.id]: turn.effects }));
      // A character made or changed: its card comes to life (and shows the new look).
      if (turn.effects.characters.length) { refreshCharacters(); setLiveCard(`${turn.reply.id}:${turn.effects.characters[0]}`); }
      onTurn(turn);
      onMood(turn.mood);
      setAnnounce(`${name}: ${turn.reply.text}`);
      if (turn.openHelp) openHelp();
    } catch (e) {
      setMessages((m) => (m ?? []).filter((x) => x.id !== temp.id));
      setText(t.trim());
      setFile(shared);
      setErr((e as Error).message);
      setAnnounce((e as Error).message);
      onMood("happy");
    } finally {
      setBusy(false);
    }
  };

  const split = async (messageId: number) => {
    try {
      const t = await api<{ id: number }>("/api/threads", { body: { fromMessageId: messageId } });
      onSplit(t.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const shown = messages ?? [];
  // The newest character card is the live one until another is tapped.
  const newestCard = (() => {
    for (let i = shown.length - 1; i >= 0; i--) {
      const m = shown[i];
      if (m.role !== "companion" || !m.meta?.includes("characters")) continue;
      try { const ids = (JSON.parse(m.meta) as { characters?: number[] }).characters; if (ids?.length) return `${m.id}:${ids[0]}`; } catch { /* not a card */ }
    }
    return null;
  })();
  const lang = context?.mode === "language" ? context.ctx.lang : undefined;
  const quick = (lang ? QUICK[lang] ?? QUICK.anylang : QUICK[mode]) ?? QUICK.chat;

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announce}</div>
      <div className="messages" onClick={(e) => { if ((e.target as HTMLElement).classList.contains("messages")) setPicked(null); }}>
        {notice && (
          <div className="notice">
            I’m {name}, an AI, not a person. I live on your family’s home server. Our everyday chats stay between us; if something worries me, I’ll tell you first before I tell {me.parentLabel}.
          </div>
        )}
        {messages === null && !err && <div className="daymark">…</div>}
        {shown.map((m, i) => {
          const prev = shown[i - 1];
          const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
          const meta = m.meta ? (JSON.parse(m.meta) as { report?: ReportInfo; checkin?: string; characters?: number[] }) : null;
          return (
            <div key={m.id} style={{ display: "contents" }}>
              {newDay && <span className="daymark">{dayLabel(m.ts)}</span>}
              <div className={`msg ${m.role === "child" ? "me" : "pip"}`}>
                <div className="bubble" onClick={() => m.id > 0 && setPicked(picked === m.id ? null : m.id)}>
                  {m.mode === "language" && m.role === "companion" ? <Lesson text={m.text} hints={hints} lang={lang} voice={context?.voice} /> : m.text}
                </div>
                {m.id > 0 && (
                  <button type="button" className={`msgmore ${picked === m.id ? "on" : ""}`} aria-label="More for this message" aria-expanded={picked === m.id}
                    onClick={() => setPicked(picked === m.id ? null : m.id)}>…</button>
                )}
              </div>
              {picked === m.id && (
                <div className={`msgactions ${m.role === "child" ? "me" : ""}`}>
                  <button className="chip" onClick={() => split(m.id)}><Icon name="split" size={16} /> Side chat from here</button>
                </div>
              )}
              {meta?.report && (
                <div className="reportcard" role="note">
                  <b style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Icon name="heart" size={16} />{name} is letting {me.parentLabel} know</b>
                  <span>“{meta.report.parentText}”</span>
                  <span className="small" style={{ color: "var(--text-3)" }}>You’re not in trouble. You can see everything that’s shared in “What {me.parentLabel} sees”.</span>
                </div>
              )}
              {m.role === "companion" && Array.isArray(meta?.characters) && meta.characters.filter((c) => Number.isInteger(c)).slice(0, 4).map((cid) => {
                const k = `${m.id}:${cid}`;
                return <CharacterCard key={k} id={cid} live={(liveCard ?? newestCard) === k} onWake={() => setLiveCard(k)} go={go} />;
              })}
              {made[m.id]?.confirms?.map((p) => <ConfirmCard key={p.id} p={p} />)}
              {made[m.id]?.jobs.map((j) => (
                <button key={j.id} className="filecard" onClick={() => go("/pip")}>
                  <span style={{ display: "inline-flex" }}><Icon name="note" size={22} /></span>
                  <span style={{ display: "flex", flexDirection: "column" }}><b style={{ fontSize: "0.875rem" }}>{j.title}</b><span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>on {name}’s desk · making it now</span></span>
                </button>
              ))}
            </div>
          );
        })}
        {busy && <div className="msg pip"><div className="bubble" role="img" aria-label={`${name} is thinking`}><span className="typing"><i /><i /><i /></span></div></div>}
        {err && <div className="notice" style={{ borderColor: "var(--ember)" }}>{err}</div>}
        <div ref={end} />
      </div>
      {context && (
        <div className="ctxchip">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name={context.mode === "study" ? "study" : context.mode === "art" ? "art" : context.mode === "language" ? "globe" : "oc"} size={15} />{context.label.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, "")}</span>
          {context.ctx.coursework && <span className="small" style={{ color: "var(--ember)" }}>tutor only</span>}
          {context.mode === "language" && <button className={`chip ${hints ? "on" : ""}`} style={{ minHeight: 32, padding: "0 10px" }} aria-pressed={hints} onClick={() => setHintsSaved(!hints)}>English hints</button>}
          <button className="x" aria-label="Back to everyday chat" onClick={onClearContext}><Icon name="close" size={16} /></button>
        </div>
      )}
      {context?.ctx.coursework && (
        <div className="notice" style={{ margin: "6px 16px 0" }}>Coursework: I’ll explain, ask questions and give feedback, but I won’t write or make any of it. Tell your teacher about any AI help; this chat goes in your help log.</div>
      )}
      {shown.length < 3 && (
        <div className="quick">
          {quick.map(([ic, t]) => <button key={t} onClick={() => send(t)}><Icon name={ic as IconName} size={15} style={{ verticalAlign: -3, marginRight: 4 }} />{t}</button>)}
        </div>
      )}
      <div className="composewrap">
      {cards.length > 0 && slashMatches.length === 0 && (() => {
        const c = cards[0];
        const b = BUILTIN.find((x) => x.cmd === c.cmd);
        return (
          <div className="cmdpop" role="dialog" aria-label={b?.name ?? c.cmd}>
            <div className="spread"><span className="il" style={{ fontWeight: 900, fontSize: "0.8125rem" }}>{b && <Icon name={b.icon} size={16} />}<span className="pcmd">/{c.cmd}</span>{b?.name}</span>
              <button className="x" aria-label="Close" onClick={() => setCards([])}><Icon name="close" size={14} /></button></div>
            <div className="cmdpop-body">{c.body}</div>
            <span className="small" style={{ color: "var(--faint)" }}>Only you see this. {name} wasn’t asked, so no energy was used.</span>
          </div>
        );
      })()}
      {slashMatches.length > 0 && (
        <div className="slashmenu" role="listbox" aria-label="Commands">
          {slashMatches.map((k, i) => (
            <div key={k.key} style={{ display: "contents" }}>
              {(i === 0 || slashMatches[i - 1].skill !== k.skill) && <span className="slashhead">{k.skill ? `Skills from ${me.parentLabel}` : "Kith"}</span>}
              <button role="option" aria-selected={i === slashPick} className={i === slashPick ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); pickCommand(k); }}>
                <span className="slashic"><Icon name={k.icon} size={16} /></span><span className="pcmd">/{k.cmd}</span><span className="slashtext"><b>{k.name}</b><span className="small"> · {k.desc}</span></span>
              </button>
            </div>
          ))}
        </div>
      )}
      {file && (
        <div className="filechip" role="status">
          <Icon name="note" size={16} />
          <span><b>{file.name}</b>{file.truncated ? <span className="small"> · {name} will read the first part</span> : null}</span>
          <button type="button" className="iconbtn" aria-label="Remove the document" onClick={() => setFile(null)}><Icon name="close" size={14} /></button>
        </div>
      )}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea
          ref={box}
          aria-label={`Message ${name}`} placeholder={`Message ${name}…`} value={text} rows={1} maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (slashMatches.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setSlashPick((p) => (p + (e.key === "ArrowDown" ? 1 : slashMatches.length - 1)) % slashMatches.length); return; }
            if (slashMatches.length > 0 && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) { e.preventDefault(); pickCommand(slashMatches[slashPick] ?? slashMatches[0], e.key === "Enter"); return; }
            if (slashMatches.length > 0 && e.key === "Escape") { e.preventDefault(); setText(""); return; }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
        />
        {isMacApp() && <button type="button" className="roundbtn" aria-label={`Show ${name} a document`} title="Show a document (PDF, Word, text)" onClick={attach}><Icon name="note" size={22} /></button>}
        <button type="button" className="roundbtn" aria-label="Talk instead" onClick={() => go("/talk")}><Icon name="mic" size={22} /></button>
        <button type="submit" className="roundbtn send" aria-label="Send" disabled={busy || (!text.trim() && !file)}><Icon name="send" size={22} /></button>
      </form>
      </div>
    </>
  );
}

/** A practice-chat reply: hints she can show or tap, gentle corrections, and phrases to save as cards. */
function Lesson({ text, hints, lang, voice }: { text: string; hints: boolean; lang?: string; voice?: string }) {
  const pieces = parseLesson(text);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState<Record<number, string>>({});
  const plain = pieces.filter((p) => p.t === "text").map((p) => (p as { text: string }).text).join(" ");
  const speakLang = lang ?? (hasKana(plain) ? "ja" : "es");
  const save = async (i: number, p: { front: string; back: string; reading: string }) => {
    const l = lang ?? (hasKana(p.front) ? "ja" : "es");
    try {
      const r = await api<{ added: number }>(`/api/languages/${l}/cards`, { body: { topic: "From chat", cards: [{ front: p.front, back: p.back, reading: p.reading || undefined }] } });
      setSaved((s) => ({ ...s, [i]: r.added ? "Saved as a card" : "Already a card" }));
    } catch (e) { setSaved((s) => ({ ...s, [i]: (e as Error).message })); }
  };
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <span className="lesson" lang={speakLang}>
      {pieces.map((p, i) => {
        if (p.t === "text") return <span key={i}>{p.text}</span>;
        if (p.t === "hint") return hints || open[i]
          ? <span key={i} className="hint" lang="en">{p.text}</span>
          : <button key={i} className="hinttap" lang="en" onClick={(e) => { stop(e); setOpen((o) => ({ ...o, [i]: true })); }} aria-label="Show the English hint">EN</button>;
        if (p.t === "fix") return (
          <span key={i} className="fixnote" lang="en">
            <b>One tweak:</b> <s lang={speakLang}>{p.wrote}</s> → <b lang={speakLang}>{p.better}</b>{p.why ? <span className="small"> · {p.why}</span> : null}
          </span>
        );
        return (
          <button key={i} className="savechip" disabled={!!saved[i]} onClick={(e) => { stop(e); void save(i, p); }}>
            {saved[i] ? `✓ ${p.front} · ${saved[i]}` : <>+ <span lang={speakLang}>{p.front}</span> <span className="small" lang="en">({p.back})</span></>}
          </button>
        );
      })}
      <button className="hinttap speak" onClick={(e) => { stop(e); say(plain, voice || voiceFor(speakLang)); }} aria-label="Hear it"><Icon name="speaker" size={14} /></button>
    </span>
  );
}
