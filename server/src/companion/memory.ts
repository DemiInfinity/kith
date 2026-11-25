import type { DB } from "../db.js";
import { all, run } from "../db.js";
import { redactPersonal } from "../safety/rules.js";

export interface Memory { id: number; ts: number; icon: string; text: string; about_date: string | null; asked: number }

export function listMemories(db: DB): Memory[] {
  return all<Memory>(db, "SELECT id, ts, icon, text, about_date, asked FROM memories ORDER BY ts DESC");
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

/** Why a memory can't be saved (empty, personal details, already remembered), or null. Saves nothing. */
export function memoryProblem(db: DB, raw: string): string | null {
  const text = raw.trim().slice(0, 140);
  if (!text) return "empty";
  if (redactPersonal(text).found.length) return "Memories never hold personal details.";
  if (listMemories(db).some((x) => norm(x.text) === norm(text))) return "Already remembered.";
  return null;
}

/** Saves a memory unless it holds personal details or is already remembered. */
export function addMemory(db: DB, m: { icon?: string; text: string; aboutDate?: string | null }): { ok: boolean; reason?: string; id?: number } {
  const text = m.text.trim().slice(0, 140);
  const problem = memoryProblem(db, text);
  if (problem) return { ok: false, reason: problem };
  const date = m.aboutDate && /^\d{4}-\d{2}-\d{2}$/.test(m.aboutDate) ? m.aboutDate : null;
  const res = run(db, "INSERT INTO memories(ts, icon, text, about_date) VALUES (?,?,?,?)", Date.now(), (m.icon ?? "💭").slice(0, 8), text, date);
  return { ok: true, id: Number(res.lastInsertRowid) };
}

export function deleteMemory(db: DB, id: number) {
  return run(db, "DELETE FROM memories WHERE id = ?", id).changes > 0;
}

export function memoriesForPrompt(db: DB): string {
  const ms = listMemories(db).slice(0, 40);
  if (!ms.length) return "You don't remember anything about them yet.";
  return "What you remember (they can see and delete these):\n" + ms.map((m) => `- ${m.text}${m.about_date ? ` (${m.about_date})` : ""}`).join("\n");
}
