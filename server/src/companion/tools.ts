// Tools the companion always has (its own memory, its desk and the OC workshop), alongside any
// connections the parent has switched on.

import { z } from "zod";
import type { DB } from "../db.js";
import { addMemory, memoryProblem } from "./memory.js";
import type { ToolDef } from "../connections/connections.js";
import { KIND_NAMES, type Studio } from "../desk/studio.js";
import { addWorld, getCharacter, listCharacters, OC_TRAITS, RELATIONSHIPS, saveCharacter } from "../desk/oc.js";
import { describe as describeLook, NEW_CHARACTER } from "../pip/look.js";
import type { LLM } from "../llm.js";
import { searchHistory } from "./history.js";
import { addSchedule, scheduleProblem } from "./schedules.js";
import { config } from "../config.js";
import { askForLanguage } from "../study/languageRequests.js";
import type { Pending } from "../storage/googleWork.js";

export interface TurnEffects {
  memories: string[];
  jobs: { id: number; title: string; kind: string }[];
  characters: number[];
  /** Google changes waiting for her yes (shown as cards under the reply). */
  confirms?: Pending[];
  /**
   * What the companion's tools would change, held until its reply passes the safety check. Then
   * each one's words get the output check too, and only those that pass are committed; if the reply
   * is held back or replaced, they're all discarded. Not sent to the client.
   */
  staged?: Staged[];
  /**
   * Text from outside the child this turn (a shared document, her Mac calendar, web or Google
   * reads). A memory copied from it is refused: it never creates memories directly.
   */
  untrusted?: string[];
  /** Her own message this turn (what she said is hers, even if outside text says it too). */
  childSaid?: string;
}

export interface Staged {
  /** What it's for, for the logs (never the words). */
  label: string;
  /** The words it would save or show, for the output check. Empty when already checked. */
  text: string;
  commit(): void | Promise<void>;
  discard?(): void;
}

/** Holds a change until the reply passes (or does it now when nothing is staging, e.g. a test). */
export async function stage(effects: TurnEffects, s: Staged) {
  if (effects.staged) effects.staged.push(s);
  else await s.commit();
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
/** True when a memory is copied from outside text (a document, the calendar, a web page). */
export function copiedFromUntrusted(memory: string, untrusted: string[] = [], childSaid = ""): boolean {
  const m = squash(memory);
  if (m.length < 6) return false;
  const said = squash(childSaid);
  // Something she said herself this turn is hers, even if a document or her calendar says it too.
  const fromOutside = (t: string) => !said.includes(t);
  return untrusted.some((u) => {
    if (squash(u).includes(m) && fromOutside(m)) return true;
    // A calendar title or a short line from a document, inside the memory.
    return u.split(/\n/).some((line) => { const t = squash(line); return t.length >= 6 && t.length <= 120 && m.includes(t) && fromOutside(t); });
  });
}

const HELD = "(This is held until your reply is sent, and only kept if it passes the safety check.)";

/** Every string in an OC's fields (names, backstory, relationship notes…), for the output check. */
export function fieldText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(fieldText).filter(Boolean).join("\n");
  if (v && typeof v === "object") return Object.values(v).map(fieldText).filter(Boolean).join("\n");
  return "";
}

const obj = (properties: Record<string, unknown>, required: string[]) =>
  ({ type: "object" as const, additionalProperties: false, properties, required });

export function builtinTools(db: DB, studio: Studio, effects: TurnEffects, llm?: LLM): ToolDef[] {
  const tool = (name: string, description: string, input_schema: ToolDef["input_schema"], run: ToolDef["run"]): ToolDef =>
    ({ name, description, input_schema, connection: "companion", level: "act", run });

  return [
    tool(
      "request_language",
      "When they say they'd like to learn a new language (for example \"I want to learn French\"), ask their grown-up for them. Nothing is practised until the grown-up says yes; tell them that kindly. Ask about their level and whether it's for school or for fun first if you don't know. Don't use this for Spanish or Japanese if they're already learning them.",
      obj({
        language: { type: "string", description: "The language, in English, e.g. 'French'" },
        level: { type: "string", enum: ["A1", "A2", "B1"], description: "A1 just starting, A2 getting going, B1 chatting comfortably" },
        goal: { type: "string", enum: ["school", "fun"] },
        interests: { type: "string", description: "What they'd like to talk about in it, if they said" },
      }, ["language", "level", "goal", "interests"]),
      async (input) => {
        const v = z.object({ language: z.string().min(2).max(40), level: z.enum(["A1", "A2", "B1"]), goal: z.enum(["school", "fun"]), interests: z.string().max(200).default("") }).parse(input);
        await stage(effects, {
          label: "language request", text: `${v.language} ${v.interests}`,
          commit: async () => { await askForLanguage(db, v.language, { level: v.level, goal: v.goal, interests: v.interests }); },
        });
        return `Asking their grown-up about ${v.language} once your reply is sent. Nothing is practised until their grown-up says yes. ${HELD}`;
      },
    ),
    tool(
      "schedule",
      "Schedule something they ASKED you to: a reminder (sent to their phone and shown in chat; never in quiet hours) or something to make on your desk at a set time. Only when they ask. Use their local time.",
      obj({
        title: { type: "string", description: "Short, e.g. 'Revise fractions' or 'Weekly Victorians quiz'" },
        kind: { type: "string", enum: ["reminder", "make"] },
        when: { type: "string", description: "Local date and time, YYYY-MM-DDTHH:MM" },
        repeat: { type: "string", enum: ["none", "daily", "weekdays", "weekly"] },
        make_kind: { type: "string", description: "For 'make': what kind of desk thing (quiz, flashcards, story…)" },
        make_brief: { type: "string", description: "For 'make': what it should be" },
      }, ["title", "kind", "when", "repeat"]),
      async (input) => {
        const v = input as { title: string; kind: string; when: string; repeat: string; make_kind?: string; make_brief?: string };
        const req = {
          title: v.title, kind: v.kind, when: v.when, repeat: v.repeat,
          make: v.kind === "make" ? { kind: v.make_kind ?? "notes", brief: v.make_brief ?? v.title } : undefined,
        };
        const problem = scheduleProblem(db, req, config.timezone);
        if (problem) return `Not scheduled: ${problem}`;
        await stage(effects, {
          label: "schedule", text: [v.title, v.make_brief].filter(Boolean).join("\n"),
          commit: () => { const r = addSchedule(db, req, config.timezone); if (!r.ok) console.warn("[tools] a staged schedule couldn't be added:", r.error); },
        });
        return `Scheduled (${v.repeat === "none" ? "once" : v.repeat}). It's on your profile under Scheduled, where they can pause or delete it. ${HELD}`;
      },
    ),
    tool(
      "recall_history",
      "Search your archived past conversations with them. Only use this when they ask you to remember something specific from before that isn't in your summary or recent messages.",
      obj({ query: { type: "string", description: "What to look for, in a few words" } }, ["query"]),
      async (input) => {
        const q = z.object({ query: z.string().max(200) }).parse(input).query;
        const hits = searchHistory(q);
        if (!hits.length) return "Nothing in the archive matches that.";
        return hits.map((h) => `From ${h.file.replace(/^thread-\d+\//, "").slice(0, 10)}:\n${h.excerpt}`).join("\n\n---\n\n");
      },
    ),
    tool(
      "remember",
      "Remember something that matters to them (an upcoming test or show, what they're into, how they like to revise). Never personal details like address, school, full name or phone. They can see and delete every memory.",
      obj({
        icon: { type: "string", description: "One emoji for the memory" },
        text: { type: "string", description: "Short, e.g. 'Presentation on the Victorians, Wednesday'" },
        about_date: { type: "string", description: "YYYY-MM-DD if it's about a day (so you can ask how it went), else empty" },
      }, ["icon", "text", "about_date"]),
      async (input) => {
        const v = z.object({ icon: z.string(), text: z.string(), about_date: z.string().optional() }).parse(input);
        const problem = memoryProblem(db, v.text);
        if (problem) return `Not saved: ${problem}`;
        if (copiedFromUntrusted(v.text, effects.untrusted, effects.childSaid)) {
          return "Not saved: that came from a document, their calendar or a web page, not from them. Only remember what they tell you themselves.";
        }
        await stage(effects, {
          label: "memory", text: v.text,
          commit: () => { const r = addMemory(db, { icon: v.icon, text: v.text, aboutDate: v.about_date || null }); if (r.ok) effects.memories.push(v.text); },
        });
        return `Remembered. ${HELD}`;
      },
    ),
    tool(
      "start_desk_project",
      "Start making something on your desk: a story (up to 3 chapters), a choose-your-own adventure, comic, slides, flashcards, a quiz that marks itself, a revision timer, a mini game, a poster, a card, a sketch, a palette, a map, a timeline, a playlist idea or notes. It uses the desk's own energy and they'll see it on your desk when it's ready.",
      obj({
        kind: { type: "string", enum: KIND_NAMES },
        title: { type: "string" },
        brief: { type: "string", description: "What to make, with the details they asked for" },
        chapters: { type: "integer", minimum: 1, maximum: 3, description: "Stories only" },
        character_ids: { type: "array", items: { type: "integer" }, description: "Their OCs to include, if any" },
        look_up: { type: "string", description: "Optional: a search to look things up on the web first (through the family's block list) (for facts, revision notes, flashcards). Leave out for stories and games." },
      }, ["kind", "title", "brief"]),
      async (input) => {
        const v = z.object({
          kind: z.enum(KIND_NAMES as [string, ...string[]]), title: z.string().min(1), brief: z.string(),
          chapters: z.number().int().optional(), character_ids: z.array(z.number().int()).optional(), look_up: z.string().max(120).optional(),
        }).parse(input);
        await stage(effects, {
          label: "desk project", text: [v.title, v.brief, v.look_up].filter(Boolean).join("\n"),
          commit: () => {
            const job = studio.enqueue({ kind: v.kind as never, title: v.title, brief: v.brief, chapters: v.chapters, characterIds: v.character_ids, lookUp: v.look_up });
            if (job.ok) effects.jobs.push({ id: job.job.id, title: job.job.title, kind: job.job.kind });
            else console.warn("[tools] a staged desk project couldn't start:", job.error);
          },
        });
        return `It'll start on your desk once your reply is sent. Tell them it'll appear on your desk when it's ready. ${HELD}`;
      },
    ),
    tool(
      "change_desk_item",
      "Change something already on your desk (for example 'make it harder', 'add a level', 'make the dragon purple').",
      obj({ file_id: { type: "string" }, change: { type: "string" } }, ["file_id", "change"]),
      async (input) => {
        const v = z.object({ file_id: z.string(), change: z.string() }).parse(input);
        await stage(effects, {
          label: "desk change", text: v.change,
          commit: () => {
            const job = studio.enqueue({ kind: "edit", title: `Changing ${v.file_id}`, brief: v.change, fileId: v.file_id });
            if (job.ok) effects.jobs.push({ id: job.job.id, title: job.job.title, kind: "edit" });
            else console.warn("[tools] a staged desk change couldn't start:", job.error);
          },
        });
        return `Changing it on your desk once your reply is sent. ${HELD}`;
      },
    ),
    tool(
      "save_character",
      "Create or update one of their original characters (OCs). Use it in any chat, not only the OC workshop, but only when they clearly ask you to make or change a character (for example \"make me a wolf girl called Luna\" or \"give Luna a beanie\"). Include only the fields that changed; omit id to create a new one. Put how they look in look_description, in plain words: it becomes their 3D model (anime chibi or round creature; hair, animal ears and tail, eyes, skin, cosy outfits, a beanie, scarf, glasses or headphones). Their characters: " + characterList(db) + ".",
      obj({
        id: { type: "integer" },
        look_description: { type: "string", description: "How they look, in plain words, e.g. 'chibi wolf girl, long dark hair, amber eyes, headphones'. Leave out if the look isn't changing." },
        fields: obj({
          name: { type: "string" }, icon: { type: "string" }, look: { type: "string" }, personality: { type: "string" },
          powers: { type: "string" }, backstory: { type: "string" }, likes: { type: "string" }, dislikes: { type: "string" },
          pronouns: { type: "string" }, age: { type: "string" }, species: { type: "string", description: "Species or kind, e.g. 'wolf girl'" },
          catchphrase: { type: "string" }, traits: { type: "array", items: { type: "string", enum: [...OC_TRAITS] } },
          palette: { type: "array", items: { type: "string", description: "#RRGGBB" } }, themeSong: { type: "string" },
          relationships: { type: "array", items: obj({ with: { type: "string" }, kind: { type: "string", enum: [...RELATIONSHIPS] }, note: { type: "string" } }, ["with", "kind"]) },
        }, []),
      }, ["fields"]),
      async (input) => {
        const v = z.object({ id: z.number().int().optional(), look_description: z.string().max(600).optional(), fields: z.record(z.string(), z.unknown()).default({}) }).parse(input);
        const r = await characterFields(db, llm, v);
        if (!r.ok) return `Not saved: ${r.problem}`;
        const dry = saveCharacter(db, { id: v.id, fields: r.fields as never }, true);
        if (!dry.ok) return `Not saved: ${dry.problems.join("; ")}`;
        await stage(effects, {
          label: "character", text: [fieldText(v.fields), v.look_description].filter(Boolean).join("\n"),
          commit: () => {
            const saved = saveCharacter(db, { id: v.id, fields: r.fields as never });
            if (saved.ok) effects.characters.push(saved.character.id);
            else console.warn("[tools] a staged character couldn't be saved");
          },
        });
        return `Saved ${dry.character.sheet.name}${v.id ? ` (id ${v.id})` : ""}.${r.note} They'll see a card with their 3D look under your reply. ${HELD}`;
      },
    ),
    tool(
      "add_to_world",
      "Add a place, event or group to their OCs' world (used for maps and timelines).",
      obj({ kind: { type: "string", enum: ["place", "event", "group"] }, name: { type: "string" }, note: { type: "string" }, when: { type: "string" } }, ["kind", "name"]),
      async (input) => {
        const dry = addWorld(db, input as never, true);
        if (!dry.ok) return `Not saved: ${dry.problems.join("; ")}`;
        const v = input as { name?: string; note?: string; when?: string };
        await stage(effects, {
          label: "world entry", text: [v.name, v.note, v.when].filter(Boolean).join("\n"),
          commit: () => { addWorld(db, input as never); },
        });
        return `Added to their world. ${HELD}`;
      },
    ),
  ];
}

/** Her characters for the save_character tool, so "give Luna a beanie" can find Luna in any chat. */
function characterList(db: DB): string {
  const chars = listCharacters(db).slice(0, 30);
  return chars.length ? chars.map((c) => `${c.sheet.name} (id ${c.id})`).join(", ") : "none yet";
}

/**
 * The sheet fields a save_character call would save. A look description becomes a checked 3D
 * look (Claude picks the parts, or the word matcher does); the model can't set the look or the
 * picture directly. A changed look drops the old picture, so the app makes a new one.
 */
export async function characterFields(
  db: DB, llm: LLM | undefined, v: { id?: number; look_description?: string; fields: Record<string, unknown> },
): Promise<{ ok: true; fields: Record<string, unknown>; note: string } | { ok: false; problem: string }> {
  const fields: Record<string, unknown> = { ...v.fields };
  delete fields.model;
  delete fields.thumb;
  const existing = v.id ? getCharacter(db, v.id) : null;
  if (v.id && !existing) return { ok: false, problem: "no character with that id" };
  const name = String(fields.name ?? existing?.sheet.name ?? "").slice(0, 20);
  const words = v.look_description?.trim() || (!existing?.sheet.model && typeof fields.look === "string" ? fields.look.trim() : "");
  let note = "";
  if (words) {
    const d = await describeLook(llm, words, { for: "oc", base: existing?.sheet.model ?? NEW_CHARACTER, useModel: true });
    if (d.refused) return { ok: false, problem: "characters stay cosy and friendly, so that look can't be made. Kindly suggest a different one." };
    fields.model = { ...d.look, name };
    fields.thumb = undefined;
    if (!existing?.sheet.look && typeof fields.look !== "string") fields.look = words.slice(0, 400);
    note = ` Their 3D look: ${d.understood.join(", ") || "updated"}.${d.notYet.length ? ` Not available yet: ${d.notYet.join(", ")}.` : ""}`;
  } else if (existing?.sheet.model && typeof fields.name === "string") {
    fields.model = { ...existing.sheet.model, name };
  } else if (!existing) {
    fields.model = { ...NEW_CHARACTER, name };
  }
  return { ok: true, fields, note };
}
