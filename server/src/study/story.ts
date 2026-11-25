// Writing a story with a friend. Every passage is credited (the child, the friend, or the
// companion's suggestion) and only passages the child accepts go into the story.
//
// The friend's parts come in only the way the child chooses: pasting, or a Google Doc they pick
// with the Picker. The companion never contacts the friend, keeps no profile of them (just the
// label the child gives), and the friend's text is used for that story only. It helps with ideas,
// continuity notes, a story bible and gentle edits, but doesn't take the story over.

import { z } from "zod";
import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { redactPersonal } from "../safety/rules.js";

export const StoryMeta = z.object({
  title: z.string().trim().min(1).max(80),
  // How the child refers to their co-writer in this story (e.g. a first name). Nothing else is kept.
  friendLabel: z.string().trim().max(30).default("my friend"),
  // "light": only small fixes and suggestions; "medium": also smoother sentences. Never a rewrite.
  voice: z.enum(["light", "medium"]).default("light"),
  bible: z.string().max(4000).default(""),
});
export type StoryMeta = z.infer<typeof StoryMeta>;

export type Author = "child" | "friend" | "pip";
export interface Passage { id: number; story_id: number; ts: number; author: Author; text: string; status: "accepted" | "suggested" | "rejected"; kind: "passage" | "edit"; replaces: number | null }

export function listStories(db: DB) {
  return all<{ id: number; ts: number; json: string }>(db, "SELECT * FROM stories ORDER BY ts DESC").map((r) => ({ id: r.id, ts: r.ts, ...StoryMeta.parse(JSON.parse(r.json)) }));
}
export function getStory(db: DB, id: number | undefined) {
  if (!id) return null;
  const r = get<{ id: number; ts: number; json: string }>(db, "SELECT * FROM stories WHERE id = ?", id);
  return r ? { id: r.id, ts: r.ts, ...StoryMeta.parse(JSON.parse(r.json)) } : null;
}
export function saveStory(db: DB, id: number | null, input: unknown) {
  const m = StoryMeta.parse(input);
  if (id) {
    run(db, "UPDATE stories SET json = ? WHERE id = ?", JSON.stringify(m), id);
    return { id, ...m };
  }
  const res = run(db, "INSERT INTO stories(ts, json) VALUES (?,?)", Date.now(), JSON.stringify(m));
  return { id: Number(res.lastInsertRowid), ...m };
}
export function deleteStory(db: DB, id: number) {
  run(db, "DELETE FROM passages WHERE story_id = ?", id);
  run(db, "DELETE FROM stories WHERE id = ?", id);
}

export function passages(db: DB, storyId: number): Passage[] {
  return all<Passage>(db, "SELECT * FROM passages WHERE story_id = ? ORDER BY ts, id", storyId);
}

/** The child's and friend's passages go straight in; the companion's are only suggestions. */
export function addPassage(db: DB, storyId: number, author: Author, text: string, opts: { kind?: "passage" | "edit"; replaces?: number } = {}) {
  const clean = redactPersonal(text.trim()).text.slice(0, 20_000);
  if (!clean) throw new Error("empty");
  const status = author === "pip" ? "suggested" : "accepted";
  const res = run(db, "INSERT INTO passages(story_id, ts, author, text, status, kind, replaces) VALUES (?,?,?,?,?,?,?)", storyId, Date.now(), author, clean, status, opts.kind ?? "passage", opts.replaces ?? null);
  return Number(res.lastInsertRowid);
}

/** Accepting an edit swaps it in for the passage it replaces (the original is kept as rejected history). */
export function decide(db: DB, passageId: number, accept: boolean) {
  const p = get<Passage>(db, "SELECT * FROM passages WHERE id = ?", passageId);
  if (!p || p.status !== "suggested") return false;
  if (accept && p.kind === "edit" && p.replaces) {
    const orig = get<Passage>(db, "SELECT * FROM passages WHERE id = ?", p.replaces);
    if (orig) {
      // The edited passage keeps its original author and place; the companion is credited for the edit.
      run(db, "UPDATE passages SET status = 'rejected' WHERE id = ?", orig.id);
      run(db, "UPDATE passages SET status = 'accepted', ts = ?, author = ? WHERE id = ?", orig.ts, orig.author, p.id);
      return true;
    }
  }
  run(db, "UPDATE passages SET status = ? WHERE id = ?", accept ? "accepted" : "rejected", passageId);
  return true;
}

export function accepted(db: DB, storyId: number) {
  return passages(db, storyId).filter((p) => p.status === "accepted");
}

export function creditName(author: Author, friendLabel: string, childName: string, companionName: string) {
  return author === "child" ? childName || "Me" : author === "friend" ? friendLabel : `${companionName} (suggestion)`;
}

/** Markdown with each passage credited, for export to a Google Doc. */
export function storyMarkdown(db: DB, storyId: number, childName: string, companionName: string): string {
  const s = getStory(db, storyId);
  if (!s) return "";
  const body = accepted(db, storyId).map((p) => `${p.text}\n\n_— ${creditName(p.author, s.friendLabel, childName, companionName)}_`).join("\n\n");
  return `# ${s.title}\n\n_Written by ${childName || "me"} and ${s.friendLabel}, with ideas from ${companionName}._\n\n${body}`;
}

export function storyNote(db: DB, storyId?: number): string {
  const s = getStory(db, storyId);
  if (!s) return "You're helping write a story together.";
  const text = accepted(db, s.id).map((p) => `[${p.author === "child" ? "them" : p.author === "friend" ? s.friendLabel : "your accepted suggestion"}] ${p.text}`).join("\n\n");
  const tail = text.length > 12000 ? `…${text.slice(-12000)}` : text;
  return `You're helping with "${s.title}", a story they're writing with ${s.friendLabel}. It's THEIR story: offer ideas, continuity notes and ${s.voice === "light" ? "only small, light edits (spelling, a clearer word)" : "light edits that keep their voice"}; never take it over or write big chunks unless asked, and then only as a suggestion they can accept or reject.
${s.friendLabel}'s writing is only for this story: don't remember things about ${s.friendLabel}, don't comment on them as a person, and never suggest contacting them.
${s.bible ? `Story bible:\n${s.bible}\n` : ""}The story so far (accepted passages):\n${tail || "(nothing yet)"}`;
}
