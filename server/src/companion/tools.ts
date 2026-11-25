// Tools the companion always has (its own memory, its desk and the OC workshop), alongside any
// connections the parent has switched on.

import { z } from "zod";
import type { DB } from "../db.js";
import { addMemory } from "./memory.js";
import type { ToolDef } from "../connections/connections.js";
import { KIND_NAMES, type Studio } from "../desk/studio.js";
import { addWorld, RELATIONSHIPS, saveCharacter } from "../desk/oc.js";
import { searchHistory } from "./history.js";

export interface TurnEffects {
  memories: string[];
  jobs: { id: number; title: string; kind: string }[];
  characters: number[];
}

const obj = (properties: Record<string, unknown>, required: string[]) =>
  ({ type: "object" as const, additionalProperties: false, properties, required });

export function builtinTools(db: DB, studio: Studio, effects: TurnEffects): ToolDef[] {
  const tool = (name: string, description: string, input_schema: ToolDef["input_schema"], run: ToolDef["run"]): ToolDef =>
    ({ name, description, input_schema, connection: "companion", level: "act", run });

  return [
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
        const r = addMemory(db, { icon: v.icon, text: v.text, aboutDate: v.about_date || null });
        if (r.ok) effects.memories.push(v.text);
        return r.ok ? "Remembered." : `Not saved: ${r.reason}`;
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
        look_up: { type: "string", description: "Optional: a search to look things up on the family's safe-listed websites first (for facts, revision notes, flashcards). Leave out for stories and games." },
      }, ["kind", "title", "brief"]),
      async (input) => {
        const v = z.object({
          kind: z.enum(KIND_NAMES as [string, ...string[]]), title: z.string().min(1), brief: z.string(),
          chapters: z.number().int().optional(), character_ids: z.array(z.number().int()).optional(), look_up: z.string().max(120).optional(),
        }).parse(input);
        const job = studio.enqueue({ kind: v.kind as never, title: v.title, brief: v.brief, chapters: v.chapters, characterIds: v.character_ids, lookUp: v.look_up });
        if (!job.ok) return job.error;
        effects.jobs.push({ id: job.job.id, title: job.job.title, kind: job.job.kind });
        return `Started on your desk (job ${job.job.id}). Tell them it'll appear on your desk when it's ready.`;
      },
    ),
    tool(
      "change_desk_item",
      "Change something already on your desk (for example 'make it harder', 'add a level', 'make the dragon purple').",
      obj({ file_id: { type: "string" }, change: { type: "string" } }, ["file_id", "change"]),
      async (input) => {
        const v = z.object({ file_id: z.string(), change: z.string() }).parse(input);
        const job = studio.enqueue({ kind: "edit", title: `Changing ${v.file_id}`, brief: v.change, fileId: v.file_id });
        if (!job.ok) return job.error;
        effects.jobs.push({ id: job.job.id, title: job.job.title, kind: "edit" });
        return `Changing it on your desk (job ${job.job.id}).`;
      },
    ),
    tool(
      "save_character",
      "Create or update one of their original characters (OCs). Include only the fields that changed. Omit id to create a new one.",
      obj({
        id: { type: "integer" },
        fields: obj({
          name: { type: "string" }, icon: { type: "string" }, look: { type: "string" }, personality: { type: "string" },
          powers: { type: "string" }, backstory: { type: "string" }, likes: { type: "string" }, dislikes: { type: "string" },
          palette: { type: "array", items: { type: "string", description: "#RRGGBB" } }, themeSong: { type: "string" },
          relationships: { type: "array", items: obj({ with: { type: "string" }, kind: { type: "string", enum: [...RELATIONSHIPS] }, note: { type: "string" } }, ["with", "kind"]) },
        }, []),
      }, ["fields"]),
      async (input) => {
        const v = z.object({ id: z.number().int().optional(), fields: z.record(z.string(), z.unknown()) }).parse(input);
        const r = saveCharacter(db, { id: v.id, fields: v.fields as never });
        if (!r.ok) return `Not saved: ${r.problems.join("; ")}`;
        effects.characters.push(r.character.id);
        return `Saved ${r.character.sheet.name} (id ${r.character.id}).`;
      },
    ),
    tool(
      "add_to_world",
      "Add a place, event or group to their OCs' world (used for maps and timelines).",
      obj({ kind: { type: "string", enum: ["place", "event", "group"] }, name: { type: "string" }, note: { type: "string" }, when: { type: "string" } }, ["kind", "name"]),
      async (input) => {
        const r = addWorld(db, input as never);
        return r.ok ? "Added to their world." : `Not saved: ${r.problems.join("; ")}`;
      },
    ),
  ];
}
