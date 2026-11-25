// Keeps each turn's input small (~10–15k tokens): recent messages go in word for word, older ones
// are folded into a short rolling summary by the small model. The summary lives on the home server
// only and is deleted with the chats it came from (see retention in scheduler.ts).

import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { config } from "../config.js";
import { textOf, type LLM } from "../llm.js";
import { redactPersonal } from "../safety/rules.js";

export interface Msg { id: number; ts: number; role: string; text: string; mode: string }
export interface Rolling { upToId: number; text: string; ts: number }

/** Rough token count (about 4 characters a token in English). */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

export const HISTORY_MAX_TOKENS = 7000;   // above this, older messages are summarised…
export const HISTORY_KEEP_TOKENS = 3500;  // …until the verbatim part is about this big

const key = (thread: number) => (thread === 1 ? "rolling_summary" : `rolling_summary:${thread}`);

export function loadRolling(db: DB, thread = 1): Rolling | null {
  const r = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = ?", key(thread));
  return r ? (JSON.parse(r.json) as Rolling) : null;
}
export function saveRolling(db: DB, r: Rolling | null, thread = 1) {
  if (!r) run(db, "DELETE FROM settings WHERE key = ?", key(thread));
  else run(db, "INSERT INTO settings(key, json) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", key(thread), JSON.stringify(r));
}
export function allRollingKeys(db: DB) {
  return all<{ key: string; json: string }>(db, "SELECT key, json FROM settings WHERE key LIKE 'rolling_summary%'");
}

/** Splits messages into the part to summarise (oldest) and the part to keep word for word. Pure. */
export function splitForSummary(msgs: Msg[], max = HISTORY_MAX_TOKENS, keep = HISTORY_KEEP_TOKENS): { fold: Msg[]; keep: Msg[] } {
  const total = msgs.reduce((t, m) => t + estimateTokens(m.text) + 4, 0);
  if (total <= max) return { fold: [], keep: msgs };
  let kept = 0;
  let i = msgs.length;
  while (i > 0 && kept + estimateTokens(msgs[i - 1].text) + 4 <= keep) {
    kept += estimateTokens(msgs[i - 1].text) + 4;
    i--;
  }
  // Keep turns whole: start the verbatim part on a message from the child.
  while (i < msgs.length && msgs[i].role !== "child") i++;
  return { fold: msgs.slice(0, i), keep: msgs.slice(i) };
}

/**
 * The conversation context for a turn: a rolling summary plus recent messages, for one thread.
 * This is the compactor: when the thread gets long, the oldest messages are folded into the summary
 * (small model) and their full text is archived to a history .md file for recall later.
 */
export async function conversationContext(
  db: DB, llm: LLM, companionName: string, thread = 1, archive?: (folded: Msg[], summary: string) => void,
): Promise<{ summary: string; recent: Msg[] }> {
  let rolling = loadRolling(db, thread);
  const since = rolling?.upToId ?? 0;
  const msgs = all<Msg>(db, "SELECT id, ts, role, text, mode FROM messages WHERE thread_id = ? AND id > ? ORDER BY id", thread, since);
  const { fold, keep } = splitForSummary(msgs);
  if (fold.length && llm.available) {
    try {
      const transcript = fold.map((m) => `${m.role === "child" ? "Them" : companionName}: ${redactPersonal(m.text).text}`).join("\n");
      const msg = await llm.call({
        bucket: "chat",
        kind: "summary",
        params: {
          model: config.anthropic.lowModel,
          max_tokens: 1200,
          output_config: { effort: "low" },
          system: `You keep a short running summary of a conversation between a teenager and ${companionName}, their AI companion, so ${companionName} can carry on naturally. Under 250 words. Keep: what they're working on, plans and dates, how they were feeling, anything ${companionName} promised. Never include personal details (address, school, full names of other people, phone numbers). Plain sentences.`,
          messages: [{ role: "user", content: `Summary so far:\n${rolling?.text || "(none)"}\n\nNewer messages to fold in:\n${transcript}` }],
        } as never,
      });
      const text = textOf(msg);
      if (text) {
        rolling = { upToId: fold[fold.length - 1].id, text: text.slice(0, 3000), ts: Date.now() };
        saveRolling(db, rolling, thread);
        try { archive?.(fold, rolling.text); } catch (err) { console.warn("[context] couldn't write history", (err as Error).message); }
        return { summary: rolling.text, recent: keep };
      }
    } catch (err) {
      console.warn("[context] summary failed; sending recent messages only", (err as Error).message);
    }
    // Without a summary, still keep the input bounded.
    return { summary: rolling?.text ?? "", recent: keep };
  }
  return { summary: rolling?.text ?? "", recent: msgs };
}
