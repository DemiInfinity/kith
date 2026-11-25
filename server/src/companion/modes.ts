// What each part of the app adds to a conversation turn. Chat and calls are the default; the OC
// workshop, GCSE study, the art companion and shared stories each add their own guidance.

import type { DB } from "../db.js";
import { ocWorkshopNote } from "../desk/oc.js";
import { studyNote } from "../study/study.js";
import { artNote } from "../study/art.js";
import { storyNote } from "../study/story.js";
import { languageNote } from "../study/languages.js";

export const MODES = ["chat", "talk", "oc", "study", "art", "story", "language"] as const;
export type Mode = (typeof MODES)[number];

export interface ModeCtx { subjectId?: number; coursework?: boolean; storyId?: number; lang?: string; topic?: string }

/** Spend label for the ledger. */
export function spendKind(mode: Mode) {
  return mode;
}

/** Revision help and language practice run on Low power by default, to save the budget. */
export function prefersLowPower(mode: Mode) {
  return mode === "study" || mode === "language";
}

export function modeNote(db: DB, mode: Mode, ctx: ModeCtx = {}): string {
  switch (mode) {
    case "talk": return "This is a voice call: your reply is spoken aloud. Keep it short and natural, no emoji, no lists, no markdown.";
    case "oc": return ocWorkshopNote(db);
    case "study": return studyNote(db, ctx);
    case "art": return artNote(db);
    case "story": return storyNote(db, ctx.storyId);
    case "language": return languageNote(db, ctx.lang, ctx.topic);
    default: return "";
  }
}
