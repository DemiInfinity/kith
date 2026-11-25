// The art companion: prompts and challenges, technique tips, artist and movement references, a
// sketchbook log and a mood board, with kind, specific feedback when the child describes their work.
// Photo uploads of artwork stay off until image moderation exists (same rule as OC uploads); the UI
// is ready for it. GCSE Art and Design is mostly coursework, so coursework rules apply when it's
// marked as such: the companion never draws or designs the work for them.

import { z } from "zod";
import type { DB } from "../db.js";
import { all, run } from "../db.js";
import { redactPersonal } from "../safety/rules.js";
import { COURSEWORK_RULES, listSubjects } from "./study.js";

export const SketchEntry = z.object({
  title: z.string().trim().min(1).max(80),
  medium: z.string().max(60).default(""),
  minutes: z.number().int().min(0).max(1440).default(0),
  notes: z.string().max(1000).default(""),
  forCoursework: z.boolean().default(false),
  tags: z.array(z.string().max(30)).max(10).default([]),
});
export const MoodItem = z.object({
  kind: z.enum(["colour", "word", "reference", "note"]),
  value: z.string().trim().min(1).max(200),
  note: z.string().max(200).default(""),
});

export function listSketchbook(db: DB) {
  return all<{ id: number; ts: number; json: string }>(db, "SELECT * FROM sketchbook ORDER BY ts DESC LIMIT 200").map((r) => ({ id: r.id, ts: r.ts, ...SketchEntry.parse(JSON.parse(r.json)) }));
}
export function addSketch(db: DB, input: unknown) {
  const e = SketchEntry.parse(input);
  e.notes = redactPersonal(e.notes).text;
  const res = run(db, "INSERT INTO sketchbook(ts, json) VALUES (?,?)", Date.now(), JSON.stringify(e));
  return { id: Number(res.lastInsertRowid), ...e };
}
export function deleteSketch(db: DB, id: number) { run(db, "DELETE FROM sketchbook WHERE id = ?", id); }

export function listMood(db: DB) {
  return all<{ id: number; ts: number; json: string }>(db, "SELECT * FROM moodboard ORDER BY ts").map((r) => ({ id: r.id, ...MoodItem.parse(JSON.parse(r.json)) }));
}
export function addMood(db: DB, input: unknown) {
  const m = MoodItem.parse(input);
  if (m.kind === "colour" && !/^#[0-9a-fA-F]{6}$/.test(m.value)) throw new Error("Colours look like #D9A3E0.");
  const res = run(db, "INSERT INTO moodboard(ts, json) VALUES (?,?)", Date.now(), JSON.stringify(m));
  return { id: Number(res.lastInsertRowid), ...m };
}
export function deleteMood(db: DB, id: number) { run(db, "DELETE FROM moodboard WHERE id = ?", id); }

/** A few gentle prompts, so there's always something to try without spending energy. */
export const CHALLENGES = [
  "Draw the same object three times: 1 minute, 5 minutes, 20 minutes.",
  "Draw your hand in five different poses, no erasing.",
  "Make a value study: only three tones (light, mid, dark).",
  "Draw something from your window, using only lines (no shading).",
  "Pick one colour and make a page of every shade of it you can mix.",
  "Draw a character from one of your OCs in a new outfit.",
  "Do a 10-minute study of a crumpled piece of paper.",
  "Draw a mug using negative space: shade around it, not it.",
  "Make a small thumbnail sketch of the same scene at morning, noon and night.",
  "Copy a small section of a painting you love, then make your own version.",
];

export function challengeOfTheDay(date: string) {
  const n = date.split("-").reduce((t, x) => t + Number(x), 0);
  return CHALLENGES[n % CHALLENGES.length];
}

export function artNote(db: DB): string {
  const art = listSubjects(db).find((s) => /\bart\b|design|photograph|textile/i.test(s.subject.name));
  const recent = listSketchbook(db).slice(0, 5).map((e) => `${e.title}${e.medium ? ` (${e.medium})` : ""}`).join("; ");
  const mood = listMood(db).slice(0, 10).map((m) => (m.kind === "colour" ? m.value : m.value)).join(", ");
  return [
    "You're the art companion: suggest prompts and challenges, technique tips (composition, value, colour, line, texture), and artists and art movements worth looking at. When they describe their work, give kind, specific feedback: one thing that works and why, one thing to try next. Never mock or compare them to others.",
    "You can't see their artwork (photo uploads are off for now), so ask them to describe it.",
    "Their original characters live in the OC workshop; suggest it when it fits.",
    recent ? `Their sketchbook lately: ${recent}.` : "",
    mood ? `Their mood board: ${mood}.` : "",
    art?.subject.coursework ? `${art.subject.name} is coursework for them. When they're working on their portfolio or set task, these apply:\n${COURSEWORK_RULES}` : "",
  ].filter(Boolean).join("\n");
}
