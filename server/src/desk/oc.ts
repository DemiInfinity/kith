// The OC (original character) workshop: character sheets, relationships and a world (places and
// events for maps and timelines). Age-appropriate: friendships, rivalries and adventures yes;
// romance or anything sexual, no. Stories, comics, sketches and palettes starring the OCs are made
// by the Studio and kept in the gallery on the companion's desk.

import { z } from "zod";
import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { checkInputRules, checkOutputRules } from "../safety/rules.js";

const HEX = /^#[0-9a-fA-F]{6}$/;

export const RELATIONSHIPS = ["friend", "best friend", "rival", "family", "mentor", "teammate", "nemesis", "pet", "sidekick"] as const;

export const Sheet = z.object({
  name: z.string().trim().min(1).max(40),
  icon: z.string().max(8).default("⭐"),
  look: z.string().max(400).default(""),
  personality: z.string().max(400).default(""),
  powers: z.string().max(400).default(""),
  backstory: z.string().max(1200).default(""),
  likes: z.string().max(300).default(""),
  dislikes: z.string().max(300).default(""),
  palette: z.array(z.string().regex(HEX)).max(6).default([]),
  themeSong: z.string().max(200).default(""),
  relationships: z
    .array(z.object({ with: z.string().max(40), kind: z.enum(RELATIONSHIPS), note: z.string().max(200).default("") }))
    .max(12)
    .default([]),
});
export type Sheet = z.infer<typeof Sheet>;

export interface Character { id: number; ts: number; updated: number; sheet: Sheet }

export const WorldEntry = z.object({
  kind: z.enum(["place", "event", "group"]),
  name: z.string().trim().min(1).max(60),
  note: z.string().max(400).default(""),
  when: z.string().max(40).default(""),
});

/** Sheets are checked like messages: no romance, nothing sexual, no personal details. */
export function sheetProblems(sheet: Partial<Sheet>): string[] {
  const text = JSON.stringify(sheet);
  const inCats = checkInputRules(text).categories;
  const outCats = checkOutputRules(text);
  const bad = new Set<string>();
  if (inCats.includes("sexual") || outCats.includes("sexual")) bad.add("nothing sexual");
  if (inCats.includes("romance") || outCats.includes("romance") || /\b(girlfriend|boyfriend|crush|dating|in love)\b/i.test(text)) bad.add("no romance");
  if (inCats.includes("personal_info") || outCats.includes("shares_personal_info")) bad.add("no real personal details");
  return [...bad];
}

export function listCharacters(db: DB): Character[] {
  return all<{ id: number; ts: number; updated: number; sheet: string }>(db, "SELECT * FROM characters ORDER BY updated DESC")
    .map((r) => ({ ...r, sheet: Sheet.parse(JSON.parse(r.sheet)) }));
}

export function getCharacter(db: DB, id: number): Character | null {
  const r = get<{ id: number; ts: number; updated: number; sheet: string }>(db, "SELECT * FROM characters WHERE id = ?", id);
  return r ? { ...r, sheet: Sheet.parse(JSON.parse(r.sheet)) } : null;
}

/** Create or merge fields into a sheet. Returns problems instead of saving if it isn't okay. */
export function saveCharacter(db: DB, input: { id?: number; fields: Partial<Sheet> }): { ok: true; character: Character } | { ok: false; problems: string[] } {
  const existing = input.id ? getCharacter(db, input.id) : null;
  if (input.id && !existing) return { ok: false, problems: ["no character with that id"] };
  const merged = { ...(existing?.sheet ?? {}), ...input.fields };
  const parsed = Sheet.safeParse(merged);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const problems = sheetProblems(parsed.data);
  if (problems.length) return { ok: false, problems };
  const now = Date.now();
  if (existing) {
    run(db, "UPDATE characters SET sheet = ?, updated = ? WHERE id = ?", JSON.stringify(parsed.data), now, existing.id);
    return { ok: true, character: { ...existing, updated: now, sheet: parsed.data } };
  }
  const res = run(db, "INSERT INTO characters(ts, updated, sheet) VALUES (?,?,?)", now, now, JSON.stringify(parsed.data));
  return { ok: true, character: { id: Number(res.lastInsertRowid), ts: now, updated: now, sheet: parsed.data } };
}

export function deleteCharacter(db: DB, id: number) {
  return run(db, "DELETE FROM characters WHERE id = ?", id).changes > 0;
}

export function listWorld(db: DB) {
  return all<{ id: number; ts: number; kind: string; json: string }>(db, "SELECT * FROM world ORDER BY ts")
    .map((r) => ({ id: r.id, ...WorldEntry.parse(JSON.parse(r.json)) }));
}
export function addWorld(db: DB, entry: z.input<typeof WorldEntry>) {
  const e = WorldEntry.parse(entry);
  const problems = sheetProblems({ backstory: `${e.name} ${e.note}` });
  if (problems.length) return { ok: false as const, problems };
  const res = run(db, "INSERT INTO world(ts, kind, json) VALUES (?,?,?)", Date.now(), e.kind, JSON.stringify(e));
  return { ok: true as const, id: Number(res.lastInsertRowid) };
}
export function deleteWorld(db: DB, id: number) {
  return run(db, "DELETE FROM world WHERE id = ?", id).changes > 0;
}

export function charactersForPrompt(db: DB, ids: number[]): string {
  const chars = ids.length ? ids.map((id) => getCharacter(db, id)).filter((c): c is Character => !!c) : [];
  return chars
    .map((c) => {
      const s = c.sheet;
      return `- ${s.name} (id ${c.id}): ${[s.look && `looks: ${s.look}`, s.personality && `personality: ${s.personality}`, s.powers && `powers: ${s.powers}`, s.backstory && `backstory: ${s.backstory}`, s.palette.length ? `palette: ${s.palette.join(" ")}` : "", s.relationships.length ? `relationships: ${s.relationships.map((r) => `${r.kind} of ${r.with}`).join(", ")}` : ""].filter(Boolean).join("; ")}`;
    })
    .join("\n");
}

export function ocWorkshopNote(db: DB): string {
  const chars = listCharacters(db);
  const world = listWorld(db);
  return `You're in the OC workshop. Help build original characters by asking one good, specific question at a time
(look, personality, powers, backstory, likes, palette, theme song, relationships, their world). Save answers as you go
with save_character (merge only the fields that changed). Friendships, rivalries and adventures are great; romance and
anything sexual are not, so steer away kindly. Offer to make sketches, palettes, comics or scenes on the desk with
start_desk_project and character_ids. In role-play scenes, you can voice the characters, but you stay an AI and the
same rules apply.
Their characters so far: ${chars.length ? chars.map((c) => `${c.sheet.name} (id ${c.id})`).join(", ") : "none yet"}.
Their world: ${world.length ? world.map((w) => `${w.kind} ${w.name}`).join(", ") : "nothing yet"}.`;
}
