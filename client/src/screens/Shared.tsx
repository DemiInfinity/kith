import { useEffect, useState } from "react";
import { api, type Me, type Transparency } from "../api";
import { dayLabel, when } from "../components/bits";

const LEVEL_WORDS: Record<string, string> = { now: "right now", today: "today", fyi: "just so you know" };

/** Nothing secret here: exactly what the grown-up can see, and everything that's been shared. */
export function Shared({ me }: { me: Me }) {
  const [t, setT] = useState<Transparency | null>(null);
  useEffect(() => { api<Transparency>("/api/transparency").then(setT).catch(() => undefined); }, []);
  const name = me.profile.name;
  const parent = me.parentLabel;
  const sees: [boolean, string, string][] = [
    [true, "A weekly summary", `A few lines about what you and ${name} got up to. You see the same one.`],
    [true, "Worrying things", `If someone’s hurting you, asks you to keep secrets from ${parent}, or you’re really not okay. ${name} tells you first.`],
    [true, `What’s on ${name}’s desk`, `The things ${name} makes for you, and ${name}’s journal.`],
    [true, "Tools used", `When ${name} uses something ${parent} switched on (like your room lights), it’s listed below.`],
    [false, "Your everyday chats", `Homework, stories, things you’re thinking about: those stay between you and ${name}.`],
    [false, "Anything behind your back", "There are no secret reports. Ever."],
  ];
  const latest = t?.summaries[0];

  return (
    <div className="screen narrow">
      <span className="hand">nothing secret here</span>
      <h2 className="screen-title">What {parent} can see</h2>
      <div className="card" style={{ gap: 12 }}>
        {sees.map(([yes, title, d]) => (
          <div key={title} className="row" style={{ alignItems: "flex-start" }}>
            <span className={`check ${yes ? "yes" : "no"}`} aria-label={yes ? "can see" : "can’t see"}>{yes ? "✓" : "✕"}</span>
            <span><b style={{ fontSize: 15 }}>{title}</b><br /><span style={{ fontSize: 13.5, color: "var(--text-3)" }}>{d}</span></span>
          </div>
        ))}
      </div>

      <div className="card glow">
        <span className="eyebrow">This week · you and {parent} both see this</span>
        <span style={{ fontSize: 15, lineHeight: 1.5 }}>{latest ? latest.text : `The first summary arrives on Sunday evening.`}</span>
      </div>

      <div className="card">
        <b>If {name} ever has to tell {parent}</b>
        {[`${name} tells you what it’s going to say and why.`, `It tells ${parent} on the family board (urgent things straight to their phone).`, `${parent} checks in with you, kindly. You’re not in trouble.`].map((s, i) => (
          <div key={i} className="row" style={{ alignItems: "flex-start", fontSize: 14 }}><b style={{ color: "var(--lilac)" }}>{i + 1}</b><span>{s}</span></div>
        ))}
      </div>

      <b>Everything that’s been shared</b>
      {t && t.reports.length === 0 && <span className="small">{name} hasn’t needed to tell {parent} anything.</span>}
      {t?.reports.map((r) => (
        <div key={r.id} className="card">
          <span className="spread"><span className={`level ${r.level}`}>{LEVEL_WORDS[r.level] ?? r.level}</span><span className="small">{dayLabel(r.ts)} {when(r.ts)}</span></span>
          <span style={{ fontSize: 14 }}>“{r.parentText}”</span>
        </div>
      ))}

      <b>Tools {name} used</b>
      {t && t.toolLog.length === 0 && <span className="small">None yet.</span>}
      {t?.toolLog.slice(0, 20).map((l) => (
        <div key={l.id} className="row" style={{ fontSize: 13.5, color: "var(--text-3)" }}>
          <span>{l.ok ? "•" : "⚠️"}</span><span style={{ flex: 1 }}><b>{l.connection}</b> · {l.tool.replace(/_/g, " ")}</span><span className="small">{when(l.ts)}</span>
        </div>
      ))}

      <div className="card" style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <span style={{ fontSize: 22 }}>🌙</span>
        <span><b>Quiet hours {me.quietHours.start}–{me.quietHours.end}</b><br /><span style={{ fontSize: 13.5, color: "var(--text-3)" }}>{name} sleeps too. “Need a grown-up?” always works.</span></span>
      </div>
      <span className="small">Chats are kept for {t?.retentionDays ?? 30} days on the home server, then deleted. They’re never used to train an AI. To think, {name} sends messages to Anthropic’s Claude API, which deletes them within 30 days (longer only if something breaks its safety rules).</span>
    </div>
  );
}
