// Languages: Spanish and Japanese. One card per language with today's ten minutes, flashcards with
// sound and a reading toggle, a kana trainer (learn, trace, quiz, write from memory) whose chart
// fills in as she learns, and practice chats with the companion. A week count instead of a streak,
// so missing a day never feels like failing. Flashcards and kana use no AI at all.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Me } from "../api";
import { Icon } from "../components/Icons";
import { Toggle } from "../components/bits";
import { rows, say, toRomaji } from "../lib/kana";

type Lang = "es" | "ja";
interface LangProfile {
  enabled: boolean; level: "A1" | "A2" | "B1"; goal: "school" | "fun"; board: string; tier: "Foundation" | "Higher";
  variety: "spain" | "latam"; immersion: "light" | "half" | "full"; romaji: boolean; interests: string;
}
interface LangWeek { days: number; chats: number; reviews: number; kana: number; topics: string[] }
interface LangInfo { lang: Lang; name: string; profile: LangProfile; cards: { total: number; due: number; known: number }; week: LangWeek; topic: string }
interface Summary { lang: Lang; name: string; level: string; words: number; week: LangWeek; hiragana?: number; katakana?: number }
interface View { languages: LangInfo[]; kana: { kana: string; learned: number; streak: number }[]; summary: Summary[] }
interface LangCard { id: number; lang: Lang; front: string; back: string; reading: string }

export const NATIVE: Record<Lang, { title: string; badge: string; hello: string }> = {
  es: { title: "Español", badge: "Ñ", hello: "¡Hola!" },
  ja: { title: "日本語", badge: "あ", hello: "こんにちは" },
};

type Screen = { k: "home" } | { k: "cards"; lang: Lang } | { k: "kana"; script: "hiragana" | "katakana" } | { k: "settings"; lang: Lang };

export function Languages({ me, go }: { me: Me; go: (to: string) => void }) {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState("");
  const [screen, setScreen] = useState<Screen>({ k: "home" });
  const load = useCallback(() => api<View>("/api/languages").then(setV).catch((e) => setErr((e as Error).message)), []);
  useEffect(() => { void load(); }, [load]);
  const back = () => { setScreen({ k: "home" }); void load(); };
  const name = me.profile.name;

  if (err) return <div className="screen narrow"><div className="notice">{err}</div></div>;
  if (!v) return <div className="screen narrow"><span className="small">…</span></div>;
  const info = (l: Lang) => v.languages.find((x) => x.lang === l)!;

  if (screen.k === "cards") return <Cards info={info(screen.lang)} onBack={back} />;
  if (screen.k === "kana") return <KanaTrainer script={screen.script} progress={v.kana} onBack={back} onScript={(script) => setScreen({ k: "kana", script })} />;
  if (screen.k === "settings") return <LangSettings info={info(screen.lang)} onBack={back} />;

  const chat = (l: LangInfo) => {
    const q = new URLSearchParams({ mode: "language", lang: l.lang, topic: l.topic, label: `${NATIVE[l.lang].title} · ${l.topic}` });
    go(`/?${q}`);
  };
  const hira = rows("hiragana");
  const learned = new Set(v.kana.filter((k) => k.learned).map((k) => k.kana));
  const nextRow = hira.find((r) => r.kana.some((k) => !learned.has(k)));
  const enabled = v.languages.filter((l) => l.profile.enabled);
  const days = Math.max(0, ...enabled.map((l) => l.week.days));

  return (
    <div className="screen narrow dgrid">
      <div><span className="hand">a little every day</span><h2 className="screen-title" style={{ marginTop: 0 }}>Languages</h2></div>
      {enabled.length === 0 && <div className="notice">Both languages are switched off. Turn one on in its settings below.</div>}
      {v.languages.map((l) => {
        const n = NATIVE[l.lang];
        const minutes = Math.max(1, Math.round(l.cards.due * 0.3));
        if (!l.profile.enabled) return (
          <button key={l.lang} className="card" style={{ flexDirection: "row", alignItems: "center", gap: 12, textAlign: "left", opacity: 0.7 }} onClick={() => setScreen({ k: "settings", lang: l.lang })}>
            <span className="langbadge">{n.badge}</span><span style={{ flex: 1 }}><b>{n.title}</b><br /><span className="small">Switched off. Tap to turn it on.</span></span>
          </button>
        );
        return (
          <div key={l.lang} className="card langcard">
            <div className="row" style={{ alignItems: "center", gap: 12 }}>
              <span className="langbadge" aria-hidden>{n.badge}</span>
              <span style={{ flex: 1 }}>
                <b style={{ fontSize: 18 }}>{n.title}</b> <span className="small">{l.name}</span><br />
                <span className="small">{l.profile.goal === "school" ? (l.lang === "es" ? `GCSE · ${l.profile.tier}` : "JLPT N5 path") : "For fun"}{l.lang === "ja" && nextRow ? ` · Hiragana: ${nextRow.name} row` : ""}</span>
              </span>
              <span className="levelchip">{l.profile.level}</span>
              <button className="iconbtn" aria-label={`${l.name} settings`} onClick={() => setScreen({ k: "settings", lang: l.lang })}><Icon name="settings" size={20} /></button>
            </div>
            <span className="eyebrow">today’s ten minutes</span>
            <div className="stack" style={{ gap: 8 }}>
              {l.cards.total === 0 ? (
                <button className="todo" onClick={async () => { await api(`/api/languages/${l.lang}/starter`, { method: "POST" }); setScreen({ k: "cards", lang: l.lang }); }}>
                  <Icon name="cards" size={20} /><span><b>Start with 25 useful words</b><br /><span className="small">{n.hello} and friends</span></span>
                </button>
              ) : (
                <button className="todo" onClick={() => setScreen({ k: "cards", lang: l.lang })}>
                  <Icon name="cards" size={20} /><span><b>{l.cards.due ? `${l.cards.due} cards due · ${minutes} min` : "Flashcards: nothing due"}</b><br /><span className="small">{l.cards.known} words you know · {l.cards.total} cards</span></span>
                </button>
              )}
              {l.lang === "ja" && nextRow && (
                <button className="todo" onClick={() => setScreen({ k: "kana", script: "hiragana" })}>
                  <span className="kanamini" aria-hidden>{nextRow.kana[0]}</span><span><b>Learn {nextRow.kana.join(" ")}</b><br /><span className="small">{learned.size ? `${[...learned].filter((k) => /[ぁ-ゖ]/.test(k)).length} of 46 hiragana` : "Your first hiragana"}</span></span>
                </button>
              )}
              {l.lang === "ja" && !nextRow && (
                <button className="todo" onClick={() => setScreen({ k: "kana", script: "katakana" })}>
                  <span className="kanamini" aria-hidden>カ</span><span><b>Katakana</b><br /><span className="small">All hiragana learned. Amazing!</span></span>
                </button>
              )}
              <button className="todo" onClick={() => chat(l)}>
                <Icon name="chat2" size={20} /><span><b>Chat with {name}: {l.topic}</b><br /><span className="small">In {l.name}, at your level. Tap hints when you need them.</span></span>
              </button>
            </div>
          </div>
        );
      })}
      <div className="notice" style={{ alignSelf: "stretch" }}>
        {days ? `This week: ${days} ${days === 1 ? "day" : "days"} of practice.` : "Nothing yet this week, and that’s fine."} No streaks to lose.
      </div>
      <details className="card">
        <summary><b>What your grown-up sees</b></summary>
        <span className="small">Your level, how many words you know, and the topics you chatted about. Never your practice chats.</span>
        {v.summary.map((s) => (
          <div key={s.lang} className="memrow">
            <span className="t"><b>{NATIVE[s.lang].title} · {s.level}</b> · {s.words} words learned{s.hiragana !== undefined ? ` · ${s.hiragana} of 46 hiragana` : ""}<br />
              <span className="small">{s.week.chats} practice chats{s.week.topics.length ? ` · ${s.week.topics.join(", ")}` : ""}</span></span>
          </div>
        ))}
      </details>
    </div>
  );
}

// ── Flashcards ──────────────────────────────────────────────────────────────────────────────

function Cards({ info, onBack }: { info: LangInfo; onBack: () => void }) {
  const { lang, profile } = info;
  const [due, setDue] = useState<LangCard[] | null>(null);
  const [flip, setFlip] = useState(false);
  const [romaji, setRomaji] = useState(profile.romaji);
  const [reverse, setReverse] = useState(false);
  const [topic, setTopic] = useState("");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [reading, setReading] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => api<{ cards: LangCard[] }>(`/api/languages/${lang}/cards/due`).then((r) => { setDue(r.cards); setFlip(false); }), [lang]);
  useEffect(() => { void load(); }, [load]);
  const c = due?.[0];
  const hear = (t: string) => { if (!say(t, lang, profile.variety)) setMsg("This device can’t speak that language yet."); };
  const grade = async (g: string) => {
    if (!c) return;
    await api(`/api/languages/cards/${c.id}/review`, { body: { grade: g } });
    setDue(due!.slice(1));
    setFlip(false);
  };
  const generate = async () => {
    setMsg("Making cards on Low power…");
    try { const r = await api<{ added: number }>(`/api/languages/${lang}/cards/generate`, { body: { topic, count: 10 } }); setMsg(`Added ${r.added} cards.`); setTopic(""); void load(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const add = async () => {
    try { await api(`/api/languages/${lang}/cards`, { body: { cards: [{ front, back, reading: reading || undefined }] } }); setFront(""); setBack(""); setReading(""); void load(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const readingLine = (x: LangCard) => lang === "ja" && x.reading ? (x.reading !== x.front ? `${x.reading}${romaji ? ` · ${toRomaji(x.reading)}` : ""}` : romaji ? toRomaji(x.reading) : "") : "";
  const showFront = c && !reverse;
  return (
    <div className="screen narrow dgrid">
      <div className="row" style={{ alignItems: "center" }}>
        <button className="iconbtn" onClick={onBack} aria-label="Back"><Icon name="back" size={22} /></button>
        <h2 className="screen-title" style={{ margin: 0, flex: 1 }}>{NATIVE[lang].title} cards</h2>
      </div>
      <div className="chips">
        <button className={`chip ${!reverse ? "on" : ""}`} onClick={() => { setReverse(false); setFlip(false); }}>{NATIVE[lang].title} → English</button>
        <button className={`chip ${reverse ? "on" : ""}`} onClick={() => { setReverse(true); setFlip(false); }}>English → {NATIVE[lang].title}</button>
        {lang === "ja" && <button className={`chip ${romaji ? "on" : ""}`} onClick={() => setRomaji(!romaji)} aria-pressed={romaji}>Romaji</button>}
      </div>
      {c ? (
        <>
          <button className="card flashcard" onClick={() => setFlip(!flip)} aria-label="Flip card">
            <span className="eyebrow">{flip ? "answer" : "question"} · {due!.length} due</span>
            {(showFront ? !flip : flip) ? (
              <>
                <span className={`fc-word ${lang === "ja" ? "jp" : ""}`} lang={lang}>{c.front}</span>
                {readingLine(c) && <span className="small" lang={lang}>{readingLine(c)}</span>}
              </>
            ) : <span className="fc-word" style={{ fontSize: 22 }}>{c.back}</span>}
            {!flip && <span className="small">tap to flip</span>}
          </button>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn ghost small" onClick={() => hear(c.front)}><Icon name="speaker" size={18} /> Hear it</button>
          </div>
          {flip && (
            <div className="grid2" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              {[["again", "Again"], ["hard", "Hard"], ["good", "Good"], ["easy", "Easy"]].map(([g, l]) => <button key={g} className="btn ghost small" onClick={() => grade(g)}>{l}</button>)}
            </div>
          )}
        </>
      ) : <div className="notice" style={{ alignSelf: "stretch" }}>{due ? "Nothing due. ¡Genial! すごい!" : "…"}</div>}
      <div className="card">
        <b>More words</b>
        <div className="row"><input className="input" placeholder="Topic, e.g. food, animals, school" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} /><button className="btn primary small" disabled={topic.trim().length < 2} onClick={generate}>Make 10</button></div>
        <span className="small">Or add your own:</span>
        <input className="input" lang={lang} placeholder={lang === "ja" ? "Japanese, e.g. ねこ" : "Spanish, e.g. el gato"} value={front} onChange={(e) => setFront(e.target.value)} maxLength={200} />
        {lang === "ja" && <input className="input" lang="ja" placeholder="Reading in hiragana (optional)" value={reading} onChange={(e) => setReading(e.target.value)} maxLength={120} />}
        <input className="input" placeholder="English" value={back} onChange={(e) => setBack(e.target.value)} maxLength={300} />
        <button className="btn ghost small" disabled={!front.trim() || !back.trim()} onClick={add}>Add card</button>
        {msg && <span className="small">{msg}</span>}
      </div>
    </div>
  );
}

// ── Kana trainer ────────────────────────────────────────────────────────────────────────────

function DrawPad({ ghost, clearKey }: { ghost?: string; clearKey: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    cv.width = r.width * devicePixelRatio;
    cv.height = r.height * devicePixelRatio;
    const g = cv.getContext("2d")!;
    g.scale(devicePixelRatio, devicePixelRatio);
    g.lineWidth = 9; g.lineCap = "round"; g.lineJoin = "round";
    g.strokeStyle = getComputedStyle(cv).color;
  }, [clearKey]);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  return (
    <div className="drawpad">
      {ghost && <span className="ghost" lang="ja" aria-hidden>{ghost}</span>}
      <canvas key={clearKey} ref={ref} aria-label="Draw here"
        onPointerDown={(e) => { drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const g = e.currentTarget.getContext("2d")!; const [x, y] = pos(e); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.1, y); g.stroke(); }}
        onPointerMove={(e) => { if (!drawing.current) return; const g = e.currentTarget.getContext("2d")!; const [x, y] = pos(e); g.lineTo(x, y); g.stroke(); }}
        onPointerUp={() => { drawing.current = false; }} />
    </div>
  );
}

function KanaTrainer({ script, progress, onBack, onScript }: { script: "hiragana" | "katakana"; progress: View["kana"]; onBack: () => void; onScript: (s: "hiragana" | "katakana") => void }) {
  const all = rows(script);
  const [learned, setLearned] = useState(() => new Set(progress.filter((k) => k.learned).map((k) => k.kana)));
  const [rowIdx, setRowIdx] = useState(() => Math.max(0, all.findIndex((r) => r.kana.some((k) => !learned.has(k)))));
  const [step, setStep] = useState<"learn" | "quiz" | "recall">("learn");
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [clears, setClears] = useState(0);
  const row = all[rowIdx];
  const kana = row.kana[i % row.kana.length];
  const romaji = row.romaji[i % row.kana.length];
  useEffect(() => { setI(0); setPicked(null); setShown(false); setClears((c) => c + 1); }, [rowIdx, step, script]);

  const mark = async (correct: boolean) => {
    try {
      const r = await api<{ learned: boolean }>("/api/languages/kana", { body: { kana, correct } });
      if (r.learned) setLearned((s) => new Set(s).add(kana));
    } catch { /* offline: just carry on */ }
  };
  const next = () => { setI(i + 1); setPicked(null); setShown(false); setClears((c) => c + 1); };
  // Choices come from this row and the rows before it.
  const pool = all.slice(0, rowIdx + 1).flatMap((r) => r.romaji);
  const choices = (() => {
    const others = [...new Set(pool.filter((x) => x !== romaji))];
    let seed = i * 7 + rowIdx * 13;
    const pick: string[] = [];
    while (pick.length < Math.min(3, others.length)) { seed = (seed * 31 + 17) % 997; const o = others[seed % others.length]; if (!pick.includes(o)) pick.push(o); }
    const out = [...pick];
    out.splice((i * 3 + rowIdx) % (out.length + 1), 0, romaji);
    return out;
  })();

  return (
    <div className="screen narrow dgrid">
      <div className="row" style={{ alignItems: "center" }}>
        <button className="iconbtn" onClick={onBack} aria-label="Back"><Icon name="back" size={22} /></button>
        <h2 className="screen-title" style={{ margin: 0, flex: 1 }}>{script === "hiragana" ? "Hiragana" : "Katakana"} · {row.name} row</h2>
      </div>
      <div className="chips">
        <button className={`chip ${script === "hiragana" ? "on" : ""}`} onClick={() => onScript("hiragana")}>ひらがな</button>
        <button className={`chip ${script === "katakana" ? "on" : ""}`} onClick={() => onScript("katakana")}>カタカナ</button>
      </div>
      <div className="chips" role="tablist">
        {([["learn", "Learn and trace"], ["quiz", "Quiz"], ["recall", "Write from memory"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={step === k} className={`chip ${step === k ? "on" : ""}`} onClick={() => setStep(k)}>{l}</button>
        ))}
      </div>

      {step === "learn" && (
        <div className="card" style={{ alignItems: "center", gap: 10 }}>
          <span className="kanabig" lang="ja">{kana}</span>
          <b style={{ fontSize: 20 }}>{romaji}</b>
          <button className="btn ghost small" onClick={() => say(kana, "ja")}><Icon name="speaker" size={18} /> Hear it</button>
          <span className="small">Trace over it with your finger, then try it without looking.</span>
          <DrawPad ghost={kana} clearKey={`${kana}-${clears}`} />
          <div className="row"><button className="btn ghost small" onClick={() => setClears((c) => c + 1)}>Clear</button><button className="btn primary small" onClick={next}>Next</button></div>
        </div>
      )}

      {step === "quiz" && (
        <div className="card" style={{ alignItems: "center", gap: 12 }}>
          <span className="kanabig" lang="ja">{kana}</span>
          <div className="grid2" style={{ width: "100%" }}>
            {choices.map((c) => (
              <button key={c} className={`btn ${picked ? (c === romaji ? "primary" : c === picked ? "ghost wrong" : "ghost") : "ghost"}`} disabled={!!picked}
                onClick={() => { setPicked(c); void mark(c === romaji); say(kana, "ja"); }}>{c}</button>
            ))}
          </div>
          {picked && <><span className="small">{picked === romaji ? "Yes! ✨" : `It’s ${romaji}. You’ll get it next time.`}</span><button className="btn primary small" onClick={next}>Next</button></>}
        </div>
      )}

      {step === "recall" && (
        <div className="card" style={{ alignItems: "center", gap: 10 }}>
          <span className="small">Write the {script} for</span>
          <b style={{ fontSize: 34 }}>{romaji}</b>
          <DrawPad clearKey={`${romaji}-${clears}`} />
          {!shown ? <button className="btn primary small" onClick={() => setShown(true)}>Show me</button> : (
            <>
              <span className="kanabig" lang="ja" style={{ fontSize: 72 }}>{kana}</span>
              <div className="row">
                <button className="btn ghost small" onClick={() => { void mark(false); next(); }}>Not yet</button>
                <button className="btn primary small" onClick={() => { void mark(true); next(); }}>I’ve got it</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="card">
        <b>Your chart</b>
        <span className="small">Each one fills in once you’ve got it right three times in a row. Tap a row to practise it.</span>
        <div className="kanachart">
          {all.map((r, ri) => (
            <button key={r.name} className={`kanarow ${ri === rowIdx ? "on" : ""}`} onClick={() => setRowIdx(ri)} aria-label={`${r.name} row`}>
              {r.kana.map((k) => <span key={k} lang="ja" className={learned.has(k) ? "got" : ""}>{k}</span>)}
            </button>
          ))}
        </div>
        <span className="small">{all.flatMap((r) => r.kana).filter((k) => learned.has(k)).length} of 46 learned</span>
      </div>
    </div>
  );
}

// ── Settings for one language ───────────────────────────────────────────────────────────────

function LangSettings({ info, onBack }: { info: LangInfo; onBack: () => void }) {
  const [p, setP] = useState<LangProfile>(info.profile);
  const [msg, setMsg] = useState("");
  const set = (patch: Partial<LangProfile>) => setP({ ...p, ...patch });
  const save = async () => {
    try { await api(`/api/languages/${info.lang}`, { method: "PUT", body: p }); setMsg("Saved."); onBack(); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="screen narrow dgrid">
      <div className="row" style={{ alignItems: "center" }}>
        <button className="iconbtn" onClick={onBack} aria-label="Back"><Icon name="back" size={22} /></button>
        <h2 className="screen-title" style={{ margin: 0, flex: 1 }}>{NATIVE[info.lang].title} settings</h2>
      </div>
      <div className="card">
        <Toggle label={`Learn ${info.name}`} checked={p.enabled} onChange={(v) => set({ enabled: v })} />
        <label className="field">Your level
          <select className="select" value={p.level} onChange={(e) => set({ level: e.target.value as LangProfile["level"] })}>
            <option value="A1">A1 · just starting</option><option value="A2">A2 · getting going</option><option value="B1">B1 · chatting comfortably</option>
          </select>
        </label>
        <label className="field">What it’s for
          <select className="select" value={p.goal} onChange={(e) => set({ goal: e.target.value as LangProfile["goal"] })}>
            <option value="fun">For fun</option><option value="school">{info.lang === "es" ? "School (GCSE)" : "Aiming for JLPT N5"}</option>
          </select>
        </label>
        {info.lang === "es" && p.goal === "school" && (
          <div className="grid2">
            <label className="field">Exam board<input className="input" value={p.board} maxLength={40} placeholder="e.g. AQA" onChange={(e) => set({ board: e.target.value })} /></label>
            <label className="field">Tier<select className="select" value={p.tier} onChange={(e) => set({ tier: e.target.value as LangProfile["tier"] })}><option>Foundation</option><option>Higher</option></select></label>
          </div>
        )}
        {info.lang === "es" && (
          <label className="field">Which Spanish
            <select className="select" value={p.variety} onChange={(e) => set({ variety: e.target.value as LangProfile["variety"] })}>
              <option value="spain">Spain (what GCSE uses, with vosotros)</option><option value="latam">Latin America</option>
            </select>
          </label>
        )}
        <label className="field">How much English in chats
          <select className="select" value={p.immersion} onChange={(e) => set({ immersion: e.target.value as LangProfile["immersion"] })}>
            <option value="light">Lots: a translation for every line</option><option value="half">Some: hints for new or tricky bits</option><option value="full">Hardly any: only if I’m stuck</option>
          </select>
        </label>
        {info.lang === "ja" && <Toggle label="Show romaji (you can switch it off when you’re reading kana)" checked={p.romaji} onChange={(v) => set({ romaji: v })} />}
        <label className="field">Things you love (so chats are about them)
          <input className="input" value={p.interests} maxLength={200} placeholder="e.g. anime, drawing, dragons, music" onChange={(e) => set({ interests: e.target.value })} />
        </label>
        <div className="row"><button className="btn primary small" onClick={save}>Save</button><button className="btn ghost small" onClick={onBack}>Cancel</button></div>
        {msg && <span className="small">{msg}</span>}
      </div>
    </div>
  );
}
