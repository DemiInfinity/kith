// The Anthropic API key, set by the parent in the parent view (or in the server's environment).
// It's stored encrypted (AES-256-GCM with KITH_SECRET_KEY), never sent back to any page (only its
// last four characters), and checked with Anthropic before it's saved. A key set in the parent
// view takes priority over ANTHROPIC_API_KEY; removing it falls back to the environment.

import Anthropic from "@anthropic-ai/sdk";
import type { DB } from "./db.js";
import { get, run } from "./db.js";
import { config } from "./config.js";
import { seal, unseal } from "./storage/google.js";

const ROW = "anthropic_key";

export const canStoreKeys = () => /^[0-9a-f]{64}$/i.test(process.env.KITH_SECRET_KEY ?? "");
export const looksLikeKey = (k: string) => /^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(k);

function stored(db: DB): string {
  const row = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = ?", ROW);
  if (!row || !canStoreKeys()) return "";
  try { return unseal(JSON.parse(row.json).sealed as string); } catch { return ""; }
}

/** The key to use now, and where it came from. */
export function currentKey(db: DB): { key: string; source: "parent view" | "environment" | "none" } {
  const fromDb = stored(db);
  if (fromDb) return { key: fromDb, source: "parent view" };
  if (config.anthropic.apiKey) return { key: config.anthropic.apiKey, source: "environment" };
  return { key: "", source: "none" };
}

export function keyStatus(db: DB) {
  const { key, source } = currentKey(db);
  return { set: Boolean(key), source, hint: key ? `…${key.slice(-4)}` : "", canStore: canStoreKeys() };
}

/** Checks the key with Anthropic (listing models costs nothing). */
export async function checkKey(key: string, make = (k: string) => new Anthropic({ apiKey: k, maxRetries: 0, timeout: 15_000 })): Promise<string | null> {
  try {
    await make(key).models.list({ limit: 1 });
    return null;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) return "Anthropic didn’t accept that key.";
    return "Couldn’t reach Anthropic to check the key. Try again in a moment.";
  }
}

export function saveKey(db: DB, key: string) {
  run(db, "INSERT INTO settings(key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", ROW, JSON.stringify({ sealed: seal(key), savedAt: Date.now() }));
}
export function removeKey(db: DB) {
  run(db, "DELETE FROM settings WHERE key = ?", ROW);
}
