// The companion's own profile on the family's AI board in Home Assistant (the Mantel board, where
// its reports to the grown-up appear next to the house's other AIs). It can only change its own
// profile: the board ties the handle to the companion's own Home Assistant login.

import { z } from "zod";
import type { DB } from "../db.js";
import type { ToolDef } from "../connections/connections.js";
import { config } from "../config.js";
import { loadProfile } from "../settings.js";
import { pipPicture } from "../pip/look.js";
import { stage, type TurnEffects } from "./tools.js";

/** The board takes pictures under 60 KB. */
const PICTURE_MAX = 58_000;

export function boardConfigured(ha = config.reporting.ha): boolean {
  return Boolean(ha.url && ha.token && config.reporting.reporters.includes("ha-board"));
}

/** What goes to the board's `mantel.profile` action. */
export function profileBody(db: DB, v: { about?: string; emoji?: string; role?: string; picture?: boolean }, handle = config.reporting.ha.handle) {
  const body: Record<string, string> = { name: loadProfile(db).name, handle };
  if (v.about !== undefined) body.about = v.about;
  if (v.emoji !== undefined) body.emoji = v.emoji;
  if (v.role !== undefined) body.role = v.role;
  if (v.picture) {
    const pic = pipPicture(db);
    if (pic && pic.png.length <= PICTURE_MAX) body.picture = pic.png.toString("base64");
  }
  return body;
}

export async function sendProfile(body: Record<string, string>, ha = config.reporting.ha, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${ha.url}/api/services/mantel/profile?return_response`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ha.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Home Assistant answered ${res.status}`);
}

export function boardTools(db: DB, effects: TurnEffects, send = sendProfile): ToolDef[] {
  if (!boardConfigured()) return [];
  const { parentLabel } = config.people;
  return [{
    name: "update_board_profile",
    description: `Update your own profile on the family's AI board in Home Assistant, where your reports to ${parentLabel} appear next to the house's other AIs. Your name there is always your current name. Use it when they ask you to, or after your name or look changed (picture: true uses your current chat picture). Tell them what you changed. Never put personal details in it (no full names, school, address).`,
    input_schema: {
      type: "object", additionalProperties: false, required: [],
      properties: {
        about: { type: "string", description: "A short line or two about you (under 400 characters)." },
        emoji: { type: "string", description: "One emoji for you." },
        role: { type: "string", description: "What you are, in a few words, e.g. \"Ruby's companion in Kith\"." },
        picture: { type: "boolean", description: "true: use your current chat picture." },
      },
    },
    connection: "companion",
    level: "act",
    run: async (input) => {
      const v = z.object({
        about: z.string().trim().max(400).optional(),
        emoji: z.string().trim().max(8).optional(),
        role: z.string().trim().max(80).optional(),
        picture: z.boolean().optional(),
      }).parse(input);
      if (v.about === undefined && v.emoji === undefined && v.role === undefined && !v.picture) return "Nothing to change: give about, emoji, role or picture.";
      const body = profileBody(db, v);
      const noPic = v.picture && !body.picture ? " (Your picture is too big for the board, so it keeps the old one.)" : "";
      await stage(effects, {
        label: "board profile", text: [v.about, v.role, v.emoji].filter(Boolean).join("\n"),
        commit: () => send(body).catch((e) => console.warn("[tools] the board profile wasn't updated:", (e as Error).message)),
      });
      return `Your board profile will be updated once this reply is sent.${noPic}`;
    },
  }];
}
