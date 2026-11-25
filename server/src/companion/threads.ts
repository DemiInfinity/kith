// Side chats: the child can split off a second (third…) conversation, from any message or from
// scratch, and switch back. Each has its own messages, rolling summary and history archive.
// Thread 1 is always the main chat.

import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { redactPersonal } from "../safety/rules.js";

export const MAIN_THREAD = 1;

// A side chat can be in Spanish or Japanese: every turn in it is then language practice.
export type ThreadLang = "es" | "ja";
export interface Thread { id: number; ts: number; title: string; parent_id: number | null; from_text: string | null; archived: number; updated: number; lang: ThreadLang | null; topic: string | null }

export function listThreads(db: DB, includeArchived = false): (Thread & { messages: number; last: string | null })[] {
  return all(db, `SELECT t.*, (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS messages,
      (SELECT text FROM messages m WHERE m.thread_id = t.id ORDER BY id DESC LIMIT 1) AS last
    FROM threads t ${includeArchived ? "" : "WHERE t.archived = 0"} ORDER BY (t.id = 1) DESC, t.updated DESC`);
}

export function getThread(db: DB, id: number): Thread | undefined {
  return get<Thread>(db, "SELECT * FROM threads WHERE id = ?", id);
}

export function createThread(db: DB, opts: { title?: string; parentId?: number; fromText?: string; lang?: ThreadLang | null; topic?: string }): Thread {
  const now = Date.now();
  const from = opts.fromText ? redactPersonal(opts.fromText).text.slice(0, 600) : null;
  const title = (opts.title?.trim() || (from ? from.slice(0, 40) + (from.length > 40 ? "…" : "") : "Side chat")).slice(0, 60);
  const res = run(db, "INSERT INTO threads(ts, title, parent_id, from_text, updated, lang, topic) VALUES (?,?,?,?,?,?,?)",
    now, title, opts.parentId ?? MAIN_THREAD, from, now, opts.lang ?? null, opts.topic ? redactPersonal(opts.topic).text.slice(0, 120) : null);
  return getThread(db, Number(res.lastInsertRowid))!;
}

export function updateThread(db: DB, id: number, patch: { title?: string; archived?: boolean; lang?: ThreadLang | null }) {
  if (id === MAIN_THREAD && (patch.archived || patch.lang)) return false;
  if (patch.lang !== undefined) run(db, "UPDATE threads SET lang = ? WHERE id = ?", patch.lang, id);
  if (patch.title !== undefined) run(db, "UPDATE threads SET title = ? WHERE id = ?", patch.title.trim().slice(0, 60) || "Side chat", id);
  if (patch.archived !== undefined) run(db, "UPDATE threads SET archived = ? WHERE id = ?", patch.archived ? 1 : 0, id);
  return true;
}

/** A plain chat turn in a Spanish or Japanese side chat becomes language practice in that language. */
export function inThreadLanguage<M extends string, C extends { lang?: ThreadLang; topic?: string }>(db: DB, b: { thread?: number; mode: M; ctx: C }): { mode: M | "language"; ctx: C } {
  const t = b.thread ? getThread(db, b.thread) : undefined;
  if (!t?.lang || b.mode !== "chat") return { mode: b.mode, ctx: b.ctx };
  return { mode: "language", ctx: { ...b.ctx, lang: t.lang, topic: b.ctx.topic ?? t.topic ?? undefined } };
}

export function touchThread(db: DB, id: number) {
  run(db, "UPDATE threads SET updated = ? WHERE id = ?", Date.now(), id);
}

/** What the companion is told about a side chat. */
export function threadNote(db: DB, id: number): string {
  if (id === MAIN_THREAD) return "";
  const t = getThread(db, id);
  if (!t) return "";
  return `This is a side chat ("${t.title}") that they split off from the main chat${t.from_text ? `, starting from this message: "${t.from_text}"` : ""}. Keep to what this side chat is about; the main chat carries on separately.`;
}
