import { z } from "zod";
import type { DB } from "./db.js";
import { get, run } from "./db.js";

// ── Parent settings (money, limits, safety contacts, connections) ────────────────────────────

export const Budgets = z.object({
  weeklyUsd: z.number().min(0).max(500).default(11.5),
  windowUsd: z.number().min(0).max(100).default(3),
  windowHours: z.number().min(1).max(24).default(5),
  deskMonthlyUsd: z.number().min(0).max(200).default(10),
  // Backstop only: the real monthly cap is set on the API organisation in the Anthropic Console.
  monthlyCapUsd: z.number().min(0).max(1000).default(50),
  // Below this much energy, Low power is used automatically.
  lowPowerAtPercent: z.number().min(0).max(100).default(15),
  // Extra weekly allowance that Low power can use after the week's energy is gone.
  lowPowerReserveUsd: z.number().min(0).max(50).default(1.5),
  // 0 = Sunday … 1 = Monday. The weekly energy tops up at midnight on this day.
  weekResetDay: z.number().int().min(0).max(6).default(1),
});
export type Budgets = z.infer<typeof Budgets>;

export const Helpline = z.object({
  name: z.string().min(1).max(60),
  number: z.string().min(1).max(30),
  sub: z.string().max(80).default(""),
  kind: z.enum(["helpline", "emergency"]).default("helpline"),
});

export const ConnectionLevel = z.enum(["look", "act"]);
export const Connection = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,32}$/),
  kind: z.enum(["home-assistant", "kin", "jellyfin", "calculator", "dictionary", "web", "mcp"]),
  name: z.string().min(1).max(60),
  enabled: z.boolean().default(false),
  level: ConnectionLevel.default("look"),
  url: z.string().max(300).default(""),
  // Name of the environment variable holding the token. The token itself never touches the database.
  tokenEnv: z.string().max(80).default(""),
  // MCP tools the parent allows (empty = none).
  allowedTools: z.array(z.string().max(80)).max(50).default([]),
  // Home Assistant: the only entities the companion may see or change (the child's room).
  entities: z.array(z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/)).max(50).default([]),
  // Web: the only sites the companion may read.
  sites: z.array(z.string().max(120)).max(50).default([]),
  // Jellyfin: the user id that playlists are made for.
  account: z.string().max(80).default(""),
});
export type Connection = z.infer<typeof Connection>;

export const ParentSettings = z.object({
  budgets: Budgets.default(Budgets.parse({})),
  quietHours: z
    .object({ start: z.string().regex(/^\d\d:\d\d$/), end: z.string().regex(/^\d\d:\d\d$/) })
    .default({ start: "22:00", end: "07:00" }),
  maxCheckinsPerDay: z.number().int().min(0).max(2).default(2),
  helplines: z.array(Helpline).max(6).default([
    { name: "Childline", number: "0800 1111", sub: "Free, any time, any worry", kind: "helpline" },
    { name: "Emergency", number: "999", sub: "If you or someone is in danger now", kind: "emergency" },
  ]),
  retentionDays: z.number().int().min(1).max(30).default(30),
  connections: z.array(Connection).max(20).default(defaultConnections()),
});
export type ParentSettings = z.infer<typeof ParentSettings>;

export function defaultConnections(): Connection[] {
  return [
    { id: "room", kind: "home-assistant", name: "Bedroom lights (Home Assistant)", enabled: false, level: "act",
      url: "", tokenEnv: "KITH_CONN_HA_TOKEN", allowedTools: [], entities: [], sites: [], account: "" },
    { id: "kin", kind: "kin", name: "Kin (calendar, chores, reminders)", enabled: false, level: "look",
      url: "", tokenEnv: "KITH_CONN_KIN_TOKEN", allowedTools: ["get_today", "list_events", "list_chores", "list_reminders"], entities: [], sites: [], account: "" },
    { id: "jellyfin", kind: "jellyfin", name: "Jellyfin (films and music)", enabled: false, level: "look",
      url: "", tokenEnv: "KITH_CONN_JELLYFIN_TOKEN", allowedTools: [], entities: [], sites: [], account: "" },
    { id: "calculator", kind: "calculator", name: "Calculator", enabled: false, level: "look",
      url: "", tokenEnv: "", allowedTools: [], entities: [], sites: [], account: "" },
    { id: "dictionary", kind: "dictionary", name: "Dictionary", enabled: false, level: "look",
      url: "https://api.dictionaryapi.dev/api/v2/entries/en/", tokenEnv: "", allowedTools: [], entities: [], sites: [], account: "" },
    { id: "web", kind: "web", name: "Allowed websites", enabled: false, level: "look",
      url: "", tokenEnv: "", allowedTools: [], entities: [], sites: [], account: "" },
  ];
}

// ── The companion's identity, picked by the child ────────────────────────────────────────────

export const LOOKS = ["fox", "cat", "dragon", "robot", "star", "frog", "owl", "panda"] as const;
export const TRAITS = ["Curious", "Funny", "Calm", "Encouraging", "Nerdy", "Creative", "Sporty", "Gentle"] as const;

export const CompanionProfile = z.object({
  name: z.string().trim().min(1).max(24).default("Pip"),
  look: z.enum(LOOKS).default("fox"),
  traits: z.array(z.enum(TRAITS)).max(3).default(["Curious", "Funny", "Encouraging"]),
  chatty: z.number().int().min(0).max(100).default(62),
  silly: z.number().int().min(0).max(100).default(70),
  detail: z.number().int().min(0).max(100).default(40),
  voice: z.string().max(40).default("Wren"),
  helpWith: z
    .object({
      homework: z.boolean().default(true),
      stories: z.boolean().default(true),
      music: z.boolean().default(true),
    })
    .default({ homework: true, stories: true, music: true }),
  checkins: z
    .object({
      askHowThingsWent: z.boolean().default(true),
      morningHello: z.boolean().default(false),
      waterWhileRevising: z.boolean().default(true),
    })
    .default({ askHowThingsWent: true, morningHello: false, waterWhileRevising: true }),
  setupDone: z.boolean().default(false),
});
export type CompanionProfile = z.infer<typeof CompanionProfile>;

// ── Storage ───────────────────────────────────────────────────────────────────────────────────

export function loadParentSettings(db: DB): ParentSettings {
  const row = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'parent'");
  return ParentSettings.parse(row ? JSON.parse(row.json) : {});
}
export function saveParentSettings(db: DB, s: ParentSettings) {
  const valid = ParentSettings.parse(s);
  run(db, "INSERT INTO settings(key, json) VALUES('parent', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(valid));
  return valid;
}
export function loadProfile(db: DB): CompanionProfile {
  const row = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'companion'");
  return CompanionProfile.parse(row ? JSON.parse(row.json) : {});
}
export function saveProfile(db: DB, p: CompanionProfile) {
  const valid = CompanionProfile.parse(p);
  run(db, "INSERT INTO settings(key, json) VALUES('companion', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(valid));
  return valid;
}
