// GCSE study: subjects with exam boards and dates, a revision planner that counts back to the
// exams, spaced-repetition flashcards, exam-style practice with mark-scheme feedback, focus
// sessions and a wellbeing guard. Nothing about the child is hardcoded: their year, curriculum and
// subjects are settings they fill in.
//
// Academic integrity is a hard rule: for anything marked as coursework (non-exam assessment), the
// companion is a tutor only. It explains, asks questions and gives feedback, and never writes, draws
// or produces the work. It reminds them the work must be their own and that AI help should be
// acknowledged, and keeps a help log they can show their teacher. (JCQ treats AI misuse in
// coursework as malpractice.)

import { z } from "zod";
import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { config } from "../config.js";
import { inQuietHours, localDate, localParts } from "../budget/time.js";
import { loadParentSettings } from "../settings.js";
import { redactPersonal } from "../safety/rules.js";

export const BOARDS = ["AQA", "Pearson Edexcel", "OCR", "WJEC Eduqas", "WJEC", "CCEA", "Other"] as const;

export const StudyProfile = z.object({
  curriculum: z.string().max(60).default("GCSE"),
  year: z.string().max(30).default(""),
  // Last time to suggest studying, local time. Planner and nudges stop here.
  latestStudy: z.string().regex(/^\d\d:\d\d$/).default("21:00"),
});
export type StudyProfile = z.infer<typeof StudyProfile>;

export const Subject = z.object({
  name: z.string().trim().min(1).max(60),
  board: z.enum(BOARDS).default("AQA"),
  // Some or all of the subject is coursework (NEA). For Art and Design, most of it is.
  coursework: z.boolean().default(false),
  courseworkNote: z.string().max(200).default(""),
  confidence: z.number().int().min(1).max(5).default(3),
  dates: z.array(z.object({ kind: z.enum(["mock", "exam", "deadline"]), label: z.string().max(80).default(""), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).max(20).default([]),
});
export type Subject = z.infer<typeof Subject>;
export interface SubjectRow { id: number; subject: Subject }

export function loadStudyProfile(db: DB): StudyProfile {
  const r = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'study_profile'");
  return StudyProfile.parse(r ? JSON.parse(r.json) : {});
}
export function saveStudyProfile(db: DB, p: unknown) {
  const v = StudyProfile.parse(p);
  run(db, "INSERT INTO settings(key, json) VALUES('study_profile', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(v));
  return v;
}

export function listSubjects(db: DB): SubjectRow[] {
  return all<{ id: number; json: string }>(db, "SELECT id, json FROM subjects ORDER BY id").map((r) => ({ id: r.id, subject: Subject.parse(JSON.parse(r.json)) }));
}
export function getSubject(db: DB, id: number | undefined): SubjectRow | null {
  if (!id) return null;
  const r = get<{ id: number; json: string }>(db, "SELECT id, json FROM subjects WHERE id = ?", id);
  return r ? { id: r.id, subject: Subject.parse(JSON.parse(r.json)) } : null;
}
export function saveSubject(db: DB, id: number | null, input: unknown): SubjectRow {
  const s = Subject.parse(input);
  if (id) {
    run(db, "UPDATE subjects SET json = ? WHERE id = ?", JSON.stringify(s), id);
    return { id, subject: s };
  }
  const res = run(db, "INSERT INTO subjects(json, created) VALUES (?,?)", JSON.stringify(s), Date.now());
  return { id: Number(res.lastInsertRowid), subject: s };
}
export function deleteSubject(db: DB, id: number) {
  run(db, "DELETE FROM subjects WHERE id = ?", id);
  run(db, "UPDATE cards SET subject_id = NULL WHERE subject_id = ?", id);
}

// ── Revision planner ────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

export interface PlanDay { date: string; sessions: { subjectId: number; subject: string; minutes: number; why: string }[] }
export interface Countdown { subjectId: number; subject: string; kind: string; label: string; date: string; days: number }

export function countdowns(subjects: SubjectRow[], today: string): Countdown[] {
  const t = Date.parse(today);
  return subjects
    .flatMap((s) => s.subject.dates.map((d) => ({ subjectId: s.id, subject: s.subject.name, kind: d.kind, label: d.label, date: d.date, days: Math.round((Date.parse(d.date) - t) / DAY) })))
    .filter((c) => c.days >= 0)
    .sort((a, b) => a.days - b.days);
}

/**
 * A gentle week's plan: short sessions, more for subjects with an exam coming up or low confidence,
 * a rest day each week, never more than 2 sessions on a school day or 3 at the weekend, and nothing
 * scheduled after the latest study time. Pure, so it's testable.
 */
export function planWeek(subjects: SubjectRow[], today: string, opts: { sessionMinutes?: number } = {}): PlanDay[] {
  const minutes = opts.sessionMinutes ?? 25;
  const upcoming = countdowns(subjects, today);
  const weight = (s: SubjectRow) => {
    const next = upcoming.find((c) => c.subjectId === s.id && c.kind !== "deadline");
    const urgency = next ? (next.days <= 14 ? 4 : next.days <= 42 ? 2.5 : next.days <= 120 ? 1.5 : 1) : 0.75;
    return urgency * (1 + (5 - s.subject.confidence) * 0.25);
  };
  const pool = subjects.map((s) => ({ s, w: weight(s), credit: 0 }));
  const days: PlanDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.parse(today) + i * DAY);
    const date = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const slots = dow === 5 ? 0 : dow === 0 || dow === 6 ? 3 : 2; // Friday off
    const sessions: PlanDay["sessions"] = [];
    for (let k = 0; k < slots && pool.length; k++) {
      for (const p of pool) p.credit += p.w;
      const pick = pool.filter((p) => !sessions.some((x) => x.subjectId === p.s.id)).sort((a, b) => b.credit - a.credit)[0];
      if (!pick) break;
      pick.credit -= pool.reduce((t, p) => t + p.w, 0);
      const next = upcoming.find((c) => c.subjectId === pick.s.id && c.kind !== "deadline");
      sessions.push({
        subjectId: pick.s.id, subject: pick.s.subject.name, minutes,
        why: next ? `${next.kind} in ${next.days} days` : pick.s.subject.confidence <= 2 ? "building confidence" : "keeping it fresh",
      });
    }
    days.push({ date, sessions });
  }
  return days;
}

// ── Spaced repetition (SM-2) ────────────────────────────────────────────────────────────────

export type Grade = "again" | "hard" | "good" | "easy";
const Q: Record<Grade, number> = { again: 1, hard: 3, good: 4, easy: 5 };

/** One SM-2 step. Pure. */
export function review(card: { ease: number; interval_days: number; reps: number }, grade: Grade, now: number) {
  const q = Q[grade];
  let { ease, interval_days: interval, reps } = card;
  if (q < 3) {
    reps = 0;
    interval = 1 / 144; // ten minutes: see it again this session
  } else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(interval * ease * (grade === "hard" ? 0.8 : grade === "easy" ? 1.3 : 1));
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  return { ease, interval_days: interval, reps, due: now + interval * DAY };
}

export interface Card { id: number; subject_id: number | null; topic: string; front: string; back: string; ease: number; interval_days: number; reps: number; due: number }

export function addCards(db: DB, subjectId: number | null, topic: string, cards: { front: string; back: string }[]) {
  const now = Date.now();
  for (const c of cards.slice(0, 60)) {
    const front = redactPersonal(c.front.trim()).text.slice(0, 300);
    const back = redactPersonal(c.back.trim()).text.slice(0, 600);
    if (front && back) run(db, "INSERT INTO cards(subject_id, topic, front, back, due, created) VALUES (?,?,?,?,?,?)", subjectId, topic.slice(0, 80), front, back, now, now);
  }
}
export function dueCards(db: DB, subjectId: number | null, limit = 20): Card[] {
  return subjectId
    ? all<Card>(db, "SELECT * FROM cards WHERE subject_id = ? AND lang IS NULL AND due <= ? ORDER BY due LIMIT ?", subjectId, Date.now(), limit)
    : all<Card>(db, "SELECT * FROM cards WHERE lang IS NULL AND due <= ? ORDER BY due LIMIT ?", Date.now(), limit);
}
export function gradeCard(db: DB, id: number, grade: Grade) {
  const c = get<Card>(db, "SELECT * FROM cards WHERE id = ?", id);
  if (!c) return null;
  const n = review(c, grade, Date.now());
  run(db, "UPDATE cards SET ease = ?, interval_days = ?, reps = ?, due = ? WHERE id = ?", n.ease, n.interval_days, n.reps, n.due, id);
  return { ...c, ...n };
}
export function cardStats(db: DB) {
  return all<{ subject_id: number | null; total: number; due: number }>(db, "SELECT subject_id, COUNT(*) AS total, SUM(CASE WHEN due <= ? THEN 1 ELSE 0 END) AS due FROM cards WHERE lang IS NULL GROUP BY subject_id", Date.now());
}

// ── Coursework help log (to show a teacher) ─────────────────────────────────────────────────

export function logHelp(db: DB, subject: string, asked: string, help: string) {
  run(db, "INSERT INTO help_log(ts, subject, asked, help) VALUES (?,?,?,?)", Date.now(), subject.slice(0, 60), redactPersonal(asked).text.slice(0, 300), help.slice(0, 300));
}
export function helpLog(db: DB) {
  return all<{ id: number; ts: number; subject: string; asked: string; help: string }>(db, "SELECT * FROM help_log ORDER BY ts DESC LIMIT 500");
}

// ── Wellbeing guard ─────────────────────────────────────────────────────────────────────────

/** Late, or in quiet hours: no study nudges, and the companion suggests rest instead of more. */
export function tooLateToStudy(db: DB, now = Date.now()): boolean {
  const p = loadStudyProfile(db);
  const tz = config.timezone;
  const t = localParts(now, tz);
  const [h, m] = p.latestStudy.split(":").map(Number);
  return t.hour * 60 + t.minute >= h * 60 + m || inQuietHours(now, tz, loadParentSettings(db).quietHours);
}

export function logFocus(db: DB, minutes: number, subjectId: number | null) {
  run(db, "INSERT INTO focus_sessions(ts, minutes, subject_id) VALUES (?,?,?)", Date.now(), Math.max(1, Math.min(120, Math.round(minutes))), subjectId);
}
export function focusToday(db: DB) {
  const today = localDate(Date.now(), config.timezone);
  return all<{ ts: number; minutes: number }>(db, "SELECT ts, minutes FROM focus_sessions WHERE ts > ?", Date.now() - DAY)
    .filter((r) => localDate(r.ts, config.timezone) === today)
    .reduce((t, r) => t + r.minutes, 0);
}

// ── What the companion is told in study mode ────────────────────────────────────────────────

export const COURSEWORK_RULES = `COURSEWORK (non-exam assessment) RULES. These are hard rules, whatever they ask:
- You are a tutor only. Explain ideas, ask questions that help them think, point to what the mark scheme rewards, and give
  feedback on work THEY wrote or made. Never write, rewrite, draw, design or produce any part of the coursework itself
  (no paragraphs, no plans written for them, no finished sentences to copy, no artwork or design ideas worked out for them).
- If they ask you to do it for them, kindly say no and explain why: work submitted for coursework must be their own, and
  using AI to produce it counts as malpractice under the exam boards' (JCQ) rules.
- Remind them, now and then, to acknowledge any AI help as their teacher asks, and that this help is noted in their help log
  so they can show their teacher.`;

export function studyNote(db: DB, ctx: { subjectId?: number; coursework?: boolean }): string {
  const p = loadStudyProfile(db);
  const subject = getSubject(db, ctx.subjectId);
  const today = localDate(Date.now(), config.timezone);
  const next = subject ? countdowns([subject], today)[0] : countdowns(listSubjects(db), today)[0];
  const coursework = ctx.coursework || (subject?.subject.coursework ?? false);
  return [
    `You're in study mode: a ${p.curriculum}${p.year ? ` student in ${p.year}` : " student"}.${subject ? ` Subject: ${subject.subject.name} (${subject.subject.board}).` : ""}${next ? ` Next: ${next.subject} ${next.kind} in ${next.days} days.` : ""}`,
    "Help them learn it: short explanations, check their understanding with a question, use worked examples for maths and science, and exam technique (command words, how marks are given). Encourage, never pressure. Suggest a short break after a while.",
    "If they seem stressed or overwhelmed, slow down, be kind, suggest a break or talking to someone they trust, and remember the safety rules (Grown-up?, Childline).",
    tooLateToStudy(db) ? "It's late. Don't push more revision: gently suggest rest and picking it up tomorrow (no nagging, no guilt). If they want to carry on briefly, keep it light." : "",
    coursework ? COURSEWORK_RULES : "",
  ].filter(Boolean).join("\n");
}
