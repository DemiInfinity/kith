import { useEffect, useRef, useState } from "react";
import { api, type Me, type Message, type Mode, type ModeCtx, type Mood, type ReportInfo, type Turn } from "../api";
import { dayLabel } from "../components/bits";
import { Icon } from "../components/Icons";

/** What the chat is about right now (set by "Ask Pip" buttons in Study, Art, the OC workshop…). */
export interface ChatContext { mode: Mode; ctx: ModeCtx; label: string }

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

function sessionNoticeNeeded(messages: Message[]) {
  let seen = false;
  try { seen = sessionStorage.getItem("kith-ai-notice") === "1"; } catch { /* private mode */ }
  const last = messages[messages.length - 1];
  return !seen || !last || Date.now() - last.ts > SESSION_GAP;
}

const QUICK: Record<string, string[][]> = {
  chat: [["📚", "Can you help with my homework?"], ["💭", "Can I talk something through?"], ["✨", "Write me a story"], ["🗂️", "Make me some flashcards"]],
  study: [["🧠", "Quiz me on what I revised today"], ["❓", "Explain this simply"], ["📝", "How do I answer an 'evaluate' question?"], ["😮‍💨", "I'm stressed about exams"]],
  art: [["💡", "Give me a drawing prompt"], ["🖌️", "How do I shade skin tones?"], ["🏛️", "Who should I look at for bold colour?"], ["🗣️", "Here's what I drew today…"]],
  oc: [["✨", "Help me make a new OC"], ["🎨", "Make a palette for my OC"], ["🗺️", "Let's build their world"], ["🎭", "Let's play a scene"]],
};

export function Chat({ me, thread, context, onClearContext, onSplit, onTurn, onMood, openHelp, go }: Props) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [made, setMade] = useState<Record<number, Turn["effects"]>>({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const name = me.profile.name;
  const mode: Mode = context?.mode ?? "chat";

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

  const send = async (t = text) => {
    const body = t.trim();
    if (!body || busy) return;
    setText("");
    setErr("");
    setBusy(true);
    onMood("thinking");
    const temp: Message = { id: -Date.now(), ts: Date.now(), role: "child", text: body, mode, meta: null };
    setMessages((m) => [...(m ?? []), temp]);
    try {
      const turn = await api<Turn>("/api/chat", { body: { text: body, mode, ctx: context?.ctx ?? {}, thread } });
      setMessages((m) => [...(m ?? []).filter((x) => x.id !== temp.id), turn.child, turn.reply]);
      if (turn.effects.jobs.length) setMade((x) => ({ ...x, [turn.reply.id]: turn.effects }));
      onTurn(turn);
      onMood(turn.mood);
      if (turn.openHelp) openHelp();
    } catch (e) {
      setMessages((m) => (m ?? []).filter((x) => x.id !== temp.id));
      setText(body);
      setErr((e as Error).message);
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
  const quick = QUICK[mode] ?? QUICK.chat;

  return (
    <>
      <div className="messages" aria-live="polite" onClick={(e) => { if ((e.target as HTMLElement).classList.contains("messages")) setPicked(null); }}>
        {notice && (
          <div className="notice">
            I’m {name}, an AI, not a person. I live on your family’s home server. Our everyday chats stay between us; if something worries me, I’ll tell you first before I tell {me.parentLabel}.
          </div>
        )}
        {messages === null && !err && <div className="daymark">…</div>}
        {shown.map((m, i) => {
          const prev = shown[i - 1];
          const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
          const meta = m.meta ? (JSON.parse(m.meta) as { report?: ReportInfo; checkin?: string }) : null;
          return (
            <div key={m.id} style={{ display: "contents" }}>
              {newDay && <span className="daymark">{dayLabel(m.ts)}</span>}
              <div className={`msg ${m.role === "child" ? "me" : "pip"}`}>
                <div className="bubble" onClick={() => m.id > 0 && setPicked(picked === m.id ? null : m.id)}>{m.text}</div>
              </div>
              {picked === m.id && (
                <div className={`msgactions ${m.role === "child" ? "me" : ""}`}>
                  <button className="chip" onClick={() => split(m.id)}><Icon name="split" size={16} /> Side chat from here</button>
                </div>
              )}
              {meta?.report && (
                <div className="reportcard" role="note">
                  <b>💬 {name} is letting {me.parentLabel} know</b>
                  <span>“{meta.report.parentText}”</span>
                  <span className="small" style={{ color: "var(--text-3)" }}>You’re not in trouble. You can see everything that’s shared in “What {me.parentLabel} sees”.</span>
                </div>
              )}
              {made[m.id]?.jobs.map((j) => (
                <button key={j.id} className="filecard" onClick={() => go("/pip")}>
                  <span style={{ fontSize: 22 }}>📄</span>
                  <span style={{ display: "flex", flexDirection: "column" }}><b style={{ fontSize: 14 }}>{j.title}</b><span style={{ fontSize: 12, color: "var(--muted)" }}>on {name}’s desk · making it now</span></span>
                </button>
              ))}
            </div>
          );
        })}
        {busy && <div className="msg pip"><div className="bubble" aria-label={`${name} is thinking`}><span className="typing"><i /><i /><i /></span></div></div>}
        {err && <div className="notice" style={{ borderColor: "var(--ember)" }}>{err}</div>}
        <div ref={end} />
      </div>
      {context && (
        <div className="ctxchip">
          <span>{context.label}</span>
          {context.ctx.coursework && <span className="small" style={{ color: "var(--ember)" }}>tutor only</span>}
          <button className="x" aria-label="Back to everyday chat" onClick={onClearContext}><Icon name="close" size={16} /></button>
        </div>
      )}
      {context?.ctx.coursework && (
        <div className="notice" style={{ margin: "6px 16px 0" }}>Coursework: I’ll explain, ask questions and give feedback, but I won’t write or make any of it. Tell your teacher about any AI help; this chat goes in your help log.</div>
      )}
      {shown.length < 3 && (
        <div className="quick">
          {quick.map(([ic, t]) => <button key={t} onClick={() => send(t)}>{ic} {t}</button>)}
        </div>
      )}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea
          aria-label={`Message ${name}`} placeholder={`Message ${name}…`} value={text} rows={1} maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
        />
        <button type="button" className="roundbtn" aria-label="Talk instead" onClick={() => go("/talk")}><Icon name="mic" size={22} /></button>
        <button type="submit" className="roundbtn send" aria-label="Send" disabled={busy || !text.trim()}><Icon name="send" size={22} /></button>
      </form>
    </>
  );
}
