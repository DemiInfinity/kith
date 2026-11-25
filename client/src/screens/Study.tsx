import { Icon, IL } from "../components/Icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Me, type Mood, type Turn } from "../api";
import { Toggle } from "../components/bits";
import { action } from "../lib/action";

interface Subject { name: string; board: string; coursework: boolean; courseworkNote: string; confidence: number; dates: { kind: "mock" | "exam" | "deadline"; label: string; date: string }[] }
interface SubjectRow { id: number; subject: Subject }
interface Countdown { subjectId: number; subject: string; kind: string; label: string; date: string; days: number }
interface PlanDay { date: string; sessions: { subjectId: number; subject: string; minutes: number; why: string }[] }
interface StudyView {
  profile: { curriculum: string; year: string; latestStudy: string }; boards: string[]; subjects: SubjectRow[];
  countdowns: Countdown[]; plan: PlanDay[]; cards: { subject_id: number | null; total: number; due: number }[];
  focusMinutesToday: number; tooLate: boolean; helpLogCount: number;
}
interface Card { id: number; front: string; back: string; topic: string }
interface Practice { question: string; marks: number; markScheme: string[]; commandWord: string }
interface Marked { score: number; outOf: number; points: { point: string; met: boolean }[]; nextStep: string; encouragement: string }

const BLANK: Subject = { name: "", board: "AQA", coursework: false, courseworkNote: "", confidence: 3, dates: [] };
const day = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function SubjectEditor({ row, boards, onDone }: { row: SubjectRow | null; boards: string[]; onDone: () => void }) {
  const [s, setS] = useState<Subject>(row?.subject ?? BLANK);
  const [err, setErr] = useState("");
  const save = async () => {
    try {
      if (row) await api(`/api/study/subjects/${row.id}`, { method: "PUT", body: s });
      else await api("/api/study/subjects", { body: s });
      onDone();
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="card" style={{ gap: 10 }}>
      <label className="field">Subject<input className="input" value={s.name} maxLength={60} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="e.g. Biology" /></label>
      <label className="field">Exam board<select className="select" value={s.board} onChange={(e) => setS({ ...s, board: e.target.value })}>{boards.map((b) => <option key={b}>{b}</option>)}</select></label>
      <label className="slider"><span className="ends"><span>How confident? Not yet</span><span>Very</span></span>
        <input type="range" min={1} max={5} value={s.confidence} style={{ ["--v" as string]: `${(s.confidence - 1) * 25}%` }} onChange={(e) => setS({ ...s, confidence: Number(e.target.value) })} /></label>
      <Toggle label="Some of this is coursework (NEA)" checked={s.coursework} onChange={(v) => setS({ ...s, coursework: v })} />
      {s.coursework && <span className="small">For coursework I’m a tutor only: I’ll explain, ask questions and give feedback, but the work has to be all yours. That’s an exam board rule.</span>}
      <b style={{ fontSize: "0.875rem" }}>Mocks, exams and deadlines</b>
      {s.dates.map((d, i) => (
        <div key={i} className="row">
          <select className="select" style={{ width: 120 }} value={d.kind} onChange={(e) => setS({ ...s, dates: s.dates.map((x, j) => (j === i ? { ...x, kind: e.target.value as "mock" } : x)) })}><option>mock</option><option>exam</option><option>deadline</option></select>
          <input className="input" type="date" value={d.date} onChange={(e) => setS({ ...s, dates: s.dates.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
          <button className="x" aria-label="Remove date" onClick={() => setS({ ...s, dates: s.dates.filter((_, j) => j !== i) })}><Icon name="close" size={16} /></button>
        </div>
      ))}
      <button className="btn ghost small" onClick={() => setS({ ...s, dates: [...s.dates, { kind: "exam", label: "", date: new Date().toISOString().slice(0, 10) }] })}>+ date</button>
      {err && <span className="small" style={{ color: "var(--ember)" }}>{err}</span>}
      <div className="row"><button className="btn primary small" disabled={!s.name.trim()} onClick={save}>Save</button><button className="btn ghost small" onClick={onDone}>Cancel</button></div>
    </div>
  );
}

function Focus({ subjects, tooLate, full = false }: { subjects: SubjectRow[]; tooLate: boolean; full?: boolean }) {
  const [len, setLen] = useState(25);
  // The session's end time, not a count of ticks: a phone that sleeps or a tab in the background
  // still finishes on time, and the "done" call happens once, outside any state update.
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [subjectId, setSubjectId] = useState<number | null>(subjects[0]?.id ?? null);
  const [msg, setMsg] = useState("");
  const session = useRef<{ minutes: number; subjectId: number | null } | null>(null);
  useEffect(() => {
    if (endsAt === null) return;
    const tick = () => setNow(Date.now());
    const t = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [endsAt]);
  useEffect(() => {
    if (endsAt === null || now < endsAt) return;
    const done = session.current;
    session.current = null;
    setEndsAt(null);
    if (!done) return;
    api<{ minutesToday: number; tooLate: boolean }>("/api/study/focus", { body: { minutes: done.minutes, subjectId: done.subjectId } })
      .then((r) => setMsg(`Nice focus! ${r.minutesToday} minutes today. Have a proper break: stretch, water, look out of a window.${r.tooLate ? " It’s getting late, so maybe call it a day." : ""}`))
      .catch(() => setMsg("Nice focus! Have a proper break: stretch, water, look out of a window. (I couldn’t save the minutes just now.)"));
  }, [now, endsAt]);
  const left = endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));
  const start = () => {
    setMsg("");
    session.current = { minutes: len, subjectId };
    const t = Date.now();
    setNow(t);
    setEndsAt(t + len * 60_000);
  };
  const stop = () => { session.current = null; setEndsAt(null); };
  return (
    <div className={`card ${full ? "full" : ""}`}>
      <b>Focus session</b>
      {tooLate && <span className="small">It’s late. Rest is revision too: your brain sorts things out while you sleep.</span>}
      {left === null ? (
        <>
          <div className="chips">{[15, 25, 40].map((m) => <button key={m} className={`chip ${len === m ? "on" : ""}`} onClick={() => setLen(m)}>{m} min</button>)}</div>
          {subjects.length > 0 && <select className="select" value={subjectId ?? ""} onChange={(e) => setSubjectId(Number(e.target.value) || null)}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.subject.name}</option>)}</select>}
          <button className="btn primary small" onClick={start}>Start</button>
        </>
      ) : (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b style={{ fontFamily: "var(--serif)", fontSize: "2.5rem" }} aria-live="off">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b>
          <button className="btn ghost small" onClick={stop}>Stop</button>
        </div>
      )}
      {msg && <span className="small" style={{ color: "var(--text-3)" }}>{msg}</span>}
    </div>
  );
}

function Cards({ v, reload }: { v: StudyView; reload: () => void }) {
  const [subjectId, setSubjectId] = useState<number | null>(v.subjects[0]?.id ?? null);
  const [due, setDue] = useState<Card[] | null>(null);
  const [flip, setFlip] = useState(false);
  const [topic, setTopic] = useState("");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => api<{ cards: Card[] }>(`/api/study/cards/due${subjectId ? `?subjectId=${subjectId}` : ""}`).then((r) => { setDue(r.cards); setFlip(false); }), [subjectId]);
  useEffect(() => { void load(); }, [load]);
  const grade = action(async (g: string) => {
    if (!due?.[0]) return;
    await api(`/api/study/cards/${due[0].id}/review`, { body: { grade: g } });
    setDue(due.slice(1));
    setFlip(false);
    reload();
  }, "save that card");
  const generate = async () => {
    setMsg("Making cards on Low power…");
    try { const r = await api<{ added: number }>("/api/study/cards/generate", { body: { subjectId, topic, count: 12 } }); setMsg(`Added ${r.added} cards.`); setTopic(""); void load(); reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const add = action(async () => {
    await api("/api/study/cards", { body: { subjectId, topic: "", cards: [{ front, back }] } });
    setFront(""); setBack(""); void load(); reload();
  }, "add that card");
  const c = due?.[0];
  return (
    <>
      {v.subjects.length > 0 && <select className="select" value={subjectId ?? ""} onChange={(e) => setSubjectId(Number(e.target.value) || null)}><option value="">All subjects</option>{v.subjects.map((s) => <option key={s.id} value={s.id}>{s.subject.name}</option>)}</select>}
      {c ? (
        <button className="card" style={{ minHeight: 180, justifyContent: "center", alignItems: "center", textAlign: "center", fontSize: "1.125rem" }} onClick={() => setFlip(!flip)} aria-label="Flip card">
          <span className="eyebrow">{flip ? "answer" : "question"} · {due!.length} due</span>
          <span style={{ fontSize: "1.1875rem", lineHeight: 1.4 }}>{flip ? c.back : c.front}</span>
          {!flip && <span className="small">tap to flip</span>}
        </button>
      ) : <div className="notice" style={{ alignSelf: "stretch" }}>{due ? "Nothing due. Nice!" : "…"}</div>}
      {c && flip && (
        <div className="grid2" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          {[["again", "Again"], ["hard", "Hard"], ["good", "Good"], ["easy", "Easy"]].map(([g, l]) => <button key={g} className="btn ghost small" onClick={() => grade(g)}>{l}</button>)}
        </div>
      )}
      <div className="card">
        <b>Make cards</b>
        <div className="row"><input className="input" placeholder="Topic, e.g. cell structure" value={topic} onChange={(e) => setTopic(e.target.value)} /><button className="btn primary small" disabled={topic.trim().length < 2} onClick={generate}>Make 12</button></div>
        <span className="small">Or write your own (often the best way to learn it):</span>
        <input className="input" placeholder="Front" value={front} onChange={(e) => setFront(e.target.value)} maxLength={300} />
        <input className="input" placeholder="Back" value={back} onChange={(e) => setBack(e.target.value)} maxLength={600} />
        <button className="btn ghost small" disabled={!front.trim() || !back.trim()} onClick={add}>Add card</button>
        {msg && <span className="small">{msg}</span>}
      </div>
    </>
  );
}

function PracticeQ({ v }: { v: StudyView }) {
  const [subjectId, setSubjectId] = useState<number | null>(v.subjects.find((s) => !s.subject.coursework)?.id ?? v.subjects[0]?.id ?? null);
  const [topic, setTopic] = useState("");
  const [marks, setMarks] = useState(4);
  const [q, setQ] = useState<Practice | null>(null);
  const [answer, setAnswer] = useState("");
  const [marked, setMarked] = useState<Marked | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const ask = async () => {
    setBusy(true); setMsg(""); setMarked(null); setAnswer("");
    try { setQ(await api<Practice>("/api/study/practice", { body: { subjectId, topic, marks } })); } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  const mark = async () => {
    if (!q) return;
    setBusy(true);
    try { setMarked(await api<Marked>("/api/study/practice/mark", { body: { subjectId, question: q.question, marks: q.marks, markScheme: q.markScheme, answer } })); } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };
  if (!v.subjects.length) return <span className="small">Add your subjects first.</span>;
  return (
    <>
      <div className="card">
        <b>Exam-style practice</b>
        <select className="select" value={subjectId ?? ""} onChange={(e) => setSubjectId(Number(e.target.value))}>{v.subjects.map((s) => <option key={s.id} value={s.id}>{s.subject.name}</option>)}</select>
        <input className="input" placeholder="Topic, e.g. osmosis" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <div className="chips">{[2, 4, 6, 9].map((m) => <button key={m} className={`chip ${marks === m ? "on" : ""}`} onClick={() => setMarks(m)}>{m} marks</button>)}</div>
        <button className="btn primary small" disabled={busy || topic.trim().length < 2 || !subjectId} onClick={ask}>Give me a question</button>
      </div>
      {q && (
        <div className="card">
          <span className="eyebrow">{q.marks} marks · {q.commandWord}</span>
          <span style={{ fontSize: "1rem" }}>{q.question}</span>
          <textarea className="textarea" placeholder="Your answer…" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <button className="btn primary small" disabled={busy || !answer.trim()} onClick={mark}>Mark it</button>
        </div>
      )}
      {marked && (
        <div className="card glow">
          <b style={{ fontFamily: "var(--serif)", fontSize: "1.375rem" }}>{marked.score} / {marked.outOf}</b>
          {marked.points.map((p, i) => <span key={i} style={{ fontSize: "0.875rem" }}><Icon name={p.met ? "check" : "clock"} size={14} style={{ verticalAlign: -2 }} /> {p.point}</span>)}
          <span style={{ fontSize: "0.875rem" }}><b>Next time:</b> {marked.nextStep}</span>
          <span className="small" style={{ color: "var(--text-3)" }}>{marked.encouragement}</span>
        </div>
      )}
      {msg && <span className="small" style={{ color: "var(--ember)" }}>{msg}</span>}
    </>
  );
}

/** GCSE study: plan, subjects, flashcards, practice, asking for help, and the coursework help log. */
export function Study({ me, onTurn, onMood, openHelp, go }: { me: Me; onTurn: (t: Turn) => void; onMood: (m: Mood) => void; openHelp: () => void; go: (to: string) => void }) {
  const [v, setV] = useState<StudyView | null>(null);
  const [tab, setTab] = useState<"plan" | "subjects" | "cards" | "practice" | "ask" | "log">("plan");
  const [editing, setEditing] = useState<SubjectRow | "new" | null>(null);
  const [askSubject, setAskSubject] = useState<number | undefined>();
  const [coursework, setCoursework] = useState(false);
  const [log, setLog] = useState<{ id: number; ts: number; subject: string; asked: string; help: string }[]>([]);
  const load = useCallback(() => api<StudyView>("/api/study").then(setV).catch(() => undefined), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tab === "log") api<{ entries: typeof log }>("/api/study/help-log").then((r) => setLog(r.entries)).catch(() => undefined); }, [tab]);
  const name = me.profile.name;
  const subj = v?.subjects.find((s) => s.id === askSubject);
  const isCoursework = coursework || !!subj?.subject.coursework;
  const due = v?.cards.reduce((t, c) => t + c.due, 0) ?? 0;

  const tabs = (
    <div className="chips" role="tablist">
      {([["plan", "calendar", "Plan"], ["subjects", "study", "Subjects"], ["cards", "cards", `Cards${due ? ` (${due})` : ""}`], ["practice", "pencil", "Practice"], ["ask", "chat2", `Ask ${name}`], ["log", "scroll", "Help log"]] as const).map(([k, ic, l]) => (
        <button key={k} role="tab" aria-selected={tab === k} className={`chip ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}><IL i={ic}>{l}</IL></button>
      ))}
    </div>
  );
  const head = (
    <div className="spread" style={{ alignItems: "flex-end" }}>
      <div><span className="hand">revision, your way</span><h2 className="screen-title" style={{ marginTop: 0 }}>Study</h2></div>
      {/* On a phone the tab bar has no room for Languages, so it lives here too. */}
      <button className="chip" onClick={() => go("/languages")}><IL i="globe">Languages</IL></button>
    </div>
  );

  const askInChat = () => {
    const label = `Studying${subj ? ` ${subj.subject.name}` : ""}${isCoursework ? " · coursework" : ""}`;
    go(`/?mode=study${askSubject ? `&subject=${askSubject}` : ""}${isCoursework ? "&coursework=1" : ""}&label=${encodeURIComponent(label)}`);
  };

  return (
    <div className="screen narrow dgrid">
      {head}{tabs}
      {!v && <span className="small">…</span>}
      {v && tab === "plan" && (
        <>
          {v.subjects.length === 0 && <div className="card"><b>Let’s set up your subjects</b><span className="small">Add each subject with its exam board and your mock and exam dates. I’ll make a gentle plan that counts back to them.</span><button className="btn primary small" onClick={() => setTab("subjects")}>Add subjects</button></div>}
          {v.countdowns.slice(0, 4).map((c) => (
            <div key={c.subjectId + c.date + c.kind} className="memrow"><span className="hic"><Icon name={c.kind === "mock" ? "note" : c.kind === "exam" ? "cap" : "pin"} size={18} /></span><span className="t"><b>{c.subject}</b> {c.kind}{c.label ? ` · ${c.label}` : ""}</span><b style={{ paddingRight: 10 }}>{c.days === 0 ? "today" : `${c.days} days`}</b></div>
          ))}
          {v.tooLate ? <div className="notice" style={{ alignSelf: "stretch" }}>It’s late, so no plan tonight. Sleep helps memory more than one more hour. See you tomorrow.</div> : v.plan.length > 0 && v.subjects.length > 0 && (
            <div className="card">
              <b>This week</b>
              {v.plan.map((d) => (
                <div key={d.date} className="row" style={{ alignItems: "flex-start", fontSize: "0.875rem" }}>
                  <b style={{ width: 92, flex: "none" }}>{day(d.date)}</b>
                  <span style={{ color: "var(--text-3)" }}>{d.sessions.length ? d.sessions.map((s) => `${s.subject} (${s.minutes}m, ${s.why})`).join(" · ") : "Rest day"}</span>
                </div>
              ))}
              <span className="small">Short sessions, one rest day, nothing after {v.profile.latestStudy}. Move things around: it’s a guide, not a rule.</span>
            </div>
          )}
          <Focus subjects={v.subjects} tooLate={v.tooLate} full={v.tooLate || v.plan.length === 0 || v.subjects.length === 0} />
          <span className="small">Focus today: {v.focusMinutesToday} minutes. Revision runs on Low power to save energy for chats and calls.</span>
        </>
      )}
      {v && tab === "subjects" && (
        <>
          <div className="card">
            <b>About you</b>
            <div className="grid2">
              <label className="field">Course<input className="input" value={v.profile.curriculum} onChange={(e) => setV({ ...v, profile: { ...v.profile, curriculum: e.target.value } })} onBlur={action(() => api("/api/study/profile", { method: "PUT", body: v.profile }), "save that")} /></label>
              <label className="field">Year<input className="input" value={v.profile.year} placeholder="e.g. Year 10" onChange={(e) => setV({ ...v, profile: { ...v.profile, year: e.target.value } })} onBlur={action(() => api("/api/study/profile", { method: "PUT", body: v.profile }), "save that")} /></label>
            </div>
          </div>
          {editing ? <SubjectEditor row={editing === "new" ? null : editing} boards={v.boards} onDone={() => { setEditing(null); void load(); }} /> : <button className="btn primary small" onClick={() => setEditing("new")}>+ Add a subject</button>}
          {v.subjects.map((s) => (
            <div key={s.id} className="memrow">
              <span className="hic"><Icon name={s.subject.coursework ? "art" : "study"} size={18} /></span>
              <span className="t"><b>{s.subject.name}</b> · {s.subject.board}{s.subject.coursework ? " · coursework" : ""}</span>
              <button className="btn ghost small" onClick={() => setEditing(s)}>Edit</button>
              <button className="x" aria-label={`Remove ${s.subject.name}`} onClick={action(async () => { if (confirm(`Remove ${s.subject.name}?`)) { await api(`/api/study/subjects/${s.id}`, { method: "DELETE" }); void load(); } }, "remove that subject")}>✕</button>
            </div>
          ))}
        </>
      )}
      {tab === "ask" && (
        <div className="card" style={{ gap: 10 }}>
          <b>Ask {name} in chat</b>
          <span className="small">It opens your chat with {name}, set up for studying: revision help runs on Low power to save energy.</span>
          <select className="select" value={askSubject ?? ""} onChange={(e) => setAskSubject(Number(e.target.value) || undefined)}><option value="">Any subject</option>{v?.subjects.map((s) => <option key={s.id} value={s.id}>{s.subject.name}</option>)}</select>
          <Toggle label="This is coursework" checked={isCoursework} onChange={setCoursework} />
          {isCoursework && <span className="small" style={{ color: "var(--ember)" }}>Coursework: {name} explains, asks questions and gives feedback, but won’t write or make any of it. It goes in your help log.</span>}
          <button className="btn primary" onClick={askInChat}>Ask {name} →</button>
        </div>
      )}
      {v && tab === "cards" && <Cards v={v} reload={load} />}
      {v && tab === "practice" && <PracticeQ v={v} />}
      {tab === "log" && (
        <>
          <span className="small">Every time you asked {name} for help with coursework. Show this to your teacher if they ask how you used AI. {name} only explained, asked questions and gave feedback.</span>
          <button className="btn ghost small" onClick={() => window.print()}>Print</button>
          {log.length === 0 && <span className="small">Nothing yet.</span>}
          {log.map((l) => (
            <div key={l.id} className="card">
              <span className="spread"><b>{l.subject}</b><span className="small">{new Date(l.ts).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span></span>
              <span style={{ fontSize: "0.875rem" }}>Asked: {l.asked}</span>
              <span className="small">{l.help}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
