import { z } from "zod";
import { CATEGORY_KEYS, type Category } from "./desk/blocklist.js";
import type { DB } from "./db.js";
import { get, run } from "./db.js";
import { CONN_SECRET } from "./config.js";

// ── Parent settings (money, limits, safety contacts, connections) ────────────────────────────

export const Budgets = z.object({
  // The whole week's money, chat and desk together. ~$11.50 spreads a $50 month evenly.
  weeklyUsd: z.number().min(0).max(500).default(11.5),
  // The desk and Studio's share of each week, handed out as a daily slice so it can't starve chat.
  deskSharePercent: z.number().min(0).max(60).default(15),
  // Full power per rolling window, so one long evening can't use the whole week.
  windowUsd: z.number().min(0).max(100).default(2.5),
  windowHours: z.number().min(1).max(24).default(5),
  // Unused Full power from quieter windows earlier in the week can top a window up by at most this much.
  rolloverCapUsd: z.number().min(0).max(50).default(2.5),
  // Everything stops here. Keep it a little under the Console's monthly cap (e.g. $48 under a $50 cap).
  hardStopUsd: z.number().gt(0).max(1000).default(48),
  // Below this much energy, Low power (the small model) is used, which carries on until the hard stop.
  lowPowerAtPercent: z.number().min(0).max(100).default(15),
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
export type Helpline = z.infer<typeof Helpline>;

export const EMERGENCY: Helpline = { name: "Emergency", number: "999", sub: "If you or someone is in danger now", kind: "emergency" };
const is999 = (h: { number: string }) => h.number.replace(/\D/g, "") === "999";
/** At least one number, and 999 is always there (added at the end if it's missing). */
export const Helplines = z.array(Helpline).min(1, "Keep at least one number.").max(7)
  .refine((l) => l.length < 7 || l.some(is999), "Up to 6 numbers, plus 999.")
  .transform((l) => (l.some(is999) ? l : [...l, EMERGENCY]));

export const ConnectionLevel = z.enum(["look", "act"]);
export const Connection = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,32}$/),
  kind: z.enum(["home-assistant", "kin", "jellyfin", "calculator", "dictionary", "web", "mcp", "google-drive"]),
  name: z.string().min(1).max(60),
  enabled: z.boolean().default(false),
  level: ConnectionLevel.default("look"),
  url: z.string().max(300).default(""),
  // Name of the environment variable holding the token (KITH_CONN_…). The token itself never touches the database.
  tokenEnv: z.string().max(80).refine((v) => v === "" || CONN_SECRET.test(v), "Token variables must start with KITH_CONN_.").default(""),
  // MCP tools the parent allows (empty = none).
  allowedTools: z.array(z.string().max(80)).max(50).default([]),
  // Home Assistant: the only entities the companion may see or change (the child's room).
  entities: z.array(z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/)).max(50).default([]),
  // Web: the only sites the companion may read.
  sites: z.array(z.string().max(120)).max(50).default([]),
  // Jellyfin: the user id that playlists are made for. Google Drive: the parent's Google email the
  // Kith folder is shared with, view-only (empty = not shared).
  account: z.string().max(80).default(""),
  // Google only: what the companion may do beyond saving what it makes. All off until the parent says.
  features: z.object({ edit: z.boolean().default(false), calendar: z.boolean().default(false), tasks: z.boolean().default(false) })
    .default({ edit: false, calendar: false, tasks: false }),
});
export type Connection = z.infer<typeof Connection>;
const NO_FEATURES = { edit: false, calendar: false, tasks: false };

export const BrowserSettings = z.object({
  // Pip's browser on the desk: reading only, every page logged. By default it can reach the whole
  // web except what the block list stops; "safelist" mode limits it to the sites below.
  enabled: z.boolean().default(true),
  mode: z.enum(["blocklist", "safelist"]).default("blocklist"),
  // Favourite sites: always allowed, searched first, and the only sites in "safelist" mode.
  sites: z.array(z.string().max(120)).max(60).default([
    "en.wikipedia.org", "simple.wikipedia.org", "www.bbc.co.uk/bitesize", "www.thenational.academy",
    "www.natgeokids.com", "www.nhm.ac.uk", "www.tate.org.uk", "www.metmuseum.org", "www.corbettmaths.com",
  ]),
  // In "safelist" mode, images and styles (never scripts) may also come from these.
  assetHosts: z.array(z.string().max(120)).max(60).default([
    "upload.wikimedia.org", "static.files.bbci.co.uk", "ichef.bbci.co.uk", "media.tate.org.uk", "images.metmuseum.org",
  ]),
  // The family's own blocked sites, on top of the categories and public lists.
  blocked: z.array(z.string().max(120)).max(500).default([]),
  categories: z.array(z.enum(CATEGORY_KEYS as [Category, ...Category[]])).default([...CATEGORY_KEYS]),
  // Public block lists in hosts-file format, fetched once a day.
  blockLists: z.array(z.string().url().max(300)).max(5).default([
    "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/gambling-porn/hosts",
  ]),
  // "bing" (SafeSearch strict) and "wikipedia" need no key. "brave" uses the Brave Search API with
  // SafeSearch strict (KITH_BRAVE_API_KEY). "duckduckgo" often answers servers with a robot check.
  search: z.enum(["bing", "duckduckgo", "wikipedia", "brave"]).default("bing"),
});
export type BrowserSettings = z.infer<typeof BrowserSettings>;

export const DEFAULT_HEARTBEAT = `- A reminder or exam coming up soon that they might like a heads-up about.
- Something they said was happening today (a test, a match, a show): maybe ask how it went, later.
- Something you made on the desk that's ready and they haven't seen.
- Revising late at night: suggest a break or bed.
Most of the time, nothing needs doing. Never message just to chat.`;

export const ParentSettings = z.object({
  budgets: Budgets.default(Budgets.parse({})),
  quietHours: z
    .object({ start: z.string().regex(/^\d\d:\d\d$/), end: z.string().regex(/^\d\d:\d\d$/) })
    .default({ start: "22:00", end: "07:00" }),
  maxCheckinsPerDay: z.number().int().min(0).max(2).default(2),
  helplines: Helplines.default([
    { name: "Childline", number: "0800 1111", sub: "Free, any time, any worry", kind: "helpline" },
    { ...EMERGENCY },
  ]),
  retentionDays: z.number().int().min(1).max(30).default(30),
  connections: z.array(Connection).max(20).default(defaultConnections()),
  browser: BrowserSettings.default(BrowserSettings.parse({})),
  // Family safeguards the parent adds on top of the built-in ones. Not shown on the child's profile.
  safeguards: z.string().max(4000).default(""),
  // The parent's own version of the built-in safeguards (empty = use the built-in ones). The code-level
  // safety checks, reporting and Grown-up? run whatever this says.
  safeguardsDoc: z.string().max(12000).default(""),
  // Voice: blank values use the server's .env (KITH_STT_HOST, KITH_VOICES…). Point at another
  // Wyoming server here to share one that's already running, e.g. on a second machine.
  voice: z.object({
    sttHost: z.string().max(120).default(""),
    sttPort: z.number().int().min(0).max(65535).default(0),
    ttsHost: z.string().max(120).default(""),
    ttsPort: z.number().int().min(0).max(65535).default(0),
    // The Whisper model to ask for (tiny, base, small…). The bundled Whisper container loads one model
    // at start (KITH_WHISPER_MODEL); a shared server may offer more.
    whisperModel: z.string().max(60).default(""),
    voices: z.array(z.object({ label: z.string().trim().min(1).max(20), voice: z.string().trim().regex(/^[A-Za-z0-9_-]{3,80}$/) })).max(6).default([]),
  }).default({ sttHost: "", sttPort: 0, ttsHost: "", ttsPort: 0, whisperModel: "", voices: [] }),
  // Notifications to the parent's own devices. "Right now" reports ignore quiet hours; everything
  // else waits until they end. By default the lock screen only says something needs you.
  notify: z.object({
    now: z.boolean().default(true),
    today: z.boolean().default(false),
    fyi: z.boolean().default(false),
    weekly: z.boolean().default(true),
    budget: z.boolean().default(true),
    showSummary: z.boolean().default(false),
  }).default({ now: true, today: false, fyi: false, weekly: true, budget: true, showSummary: false }),
  // Disk: a total budget, a cap on the desk's files, and how long trash is kept.
  disk: z.object({
    totalGb: z.number().min(1).max(2000).default(15),
    deskGb: z.number().min(0.5).max(1000).default(5),
    keepDays: z.number().int().min(1).max(90).default(7),
  }).default({ totalGb: 15, deskGb: 5, keepDays: 7 }),
  // The heartbeat always runs, every 30 minutes, and can't be switched off. The parent can edit what
  // it keeps an eye on.
  heartbeat: z.object({
    checklist: z.string().max(2000).default(DEFAULT_HEARTBEAT),
  }).default({ checklist: DEFAULT_HEARTBEAT }),
});
export type ParentSettings = z.infer<typeof ParentSettings>;

export function defaultConnections(): Connection[] {
  return [
    { id: "room", kind: "home-assistant", name: "Bedroom lights (Home Assistant)", enabled: false, level: "act",
      url: "", tokenEnv: "KITH_CONN_HA_TOKEN", allowedTools: [], entities: [], sites: [], account: "", features: NO_FEATURES },
    { id: "kin", kind: "kin", name: "Kin (calendar, chores, reminders)", enabled: false, level: "look",
      url: "", tokenEnv: "KITH_CONN_KIN_TOKEN", allowedTools: ["get_today", "list_events", "list_chores", "list_reminders"], entities: [], sites: [], account: "", features: NO_FEATURES },
    { id: "jellyfin", kind: "jellyfin", name: "Jellyfin (films and music)", enabled: false, level: "look",
      url: "", tokenEnv: "KITH_CONN_JELLYFIN_TOKEN", allowedTools: [], entities: [], sites: [], account: "", features: NO_FEATURES },
    { id: "calculator", kind: "calculator", name: "Calculator", enabled: false, level: "look",
      url: "", tokenEnv: "", allowedTools: [], entities: [], sites: [], account: "", features: NO_FEATURES },
    { id: "dictionary", kind: "dictionary", name: "Dictionary", enabled: false, level: "look",
      url: "https://api.dictionaryapi.dev/api/v2/entries/en/", tokenEnv: "", allowedTools: [], entities: [], sites: [], account: "", features: NO_FEATURES },
    { id: "google", kind: "google-drive", name: "Google Drive (their own account)", enabled: false, level: "act",
      url: "", tokenEnv: "", allowedTools: [], entities: [], sites: [], account: "", features: NO_FEATURES },
    { id: "web", kind: "web", name: "Websites", enabled: false, level: "look",
      url: "", tokenEnv: "", allowedTools: [], entities: [], sites: [], account: "", features: NO_FEATURES },
  ];
}

// ── The companion's identity, picked by the child ────────────────────────────────────────────

// Every look the avatar rig can draw…
export const LOOKS = ["buddy", "fox", "cat", "dragon", "robot", "star", "frog", "owl", "panda"] as const;
// …and the ones offered for now (more later). A companion on any other look is shown as the first.
export const OFFERED_LOOKS: (typeof LOOKS)[number][] = ["buddy"];
export const TRAITS = ["Curious", "Funny", "Calm", "Encouraging", "Nerdy", "Creative", "Sporty", "Gentle"] as const;

export const CompanionProfile = z.object({
  name: z.string().trim().min(1).max(24).default("Pip"),
  look: z.enum(LOOKS).default("buddy"),
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
  // Which notifications reach their phone.
  notifications: z
    .object({ checkins: z.boolean().default(true), reminders: z.boolean().default(true), deskReady: z.boolean().default(true) })
    .default({ checkins: true, reminders: true, deskReady: true }),
  // soul.md and identity.md notes: the child's own words. No safeguards live here; they can't override them.
  soul: z.string().max(3000).default(""),
  identityNotes: z.string().max(2000).default(""),
  setupDone: z.boolean().default(false),
});
export type CompanionProfile = z.infer<typeof CompanionProfile>;

// ── Storage ───────────────────────────────────────────────────────────────────────────────────

export function loadParentSettings(db: DB): ParentSettings {
  const row = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'parent'");
  const s = ParentSettings.parse(row ? upgradeStored(JSON.parse(row.json)) : {});
  // Connections added in later versions appear (switched off) for existing installs too.
  for (const d of defaultConnections()) if (!s.connections.some((c) => c.kind === d.kind)) s.connections.push(d);
  return s;
}
/**
 * Settings saved before the stricter checks: an empty helpline list gets the defaults back, a hard
 * stop of 0 stays (practically) stopped, and a connection token that isn't a KITH_CONN_ variable is
 * dropped (it would never have been read). Nothing here loosens a limit.
 */
function upgradeStored(raw: Record<string, unknown>): Record<string, unknown> {
  const s = { ...raw };
  if (Array.isArray(s.helplines) && s.helplines.length === 0) delete s.helplines;
  const b = s.budgets as Record<string, unknown> | undefined;
  if (b && typeof b.hardStopUsd === "number" && b.hardStopUsd <= 0) s.budgets = { ...b, hardStopUsd: 0.01 };
  if (Array.isArray(s.connections)) {
    s.connections = s.connections.map((c: Record<string, unknown>) =>
      c && typeof c.tokenEnv === "string" && c.tokenEnv !== "" && !CONN_SECRET.test(c.tokenEnv) ? { ...c, tokenEnv: "" } : c);
  }
  return s;
}

export function saveParentSettings(db: DB, s: ParentSettings) {
  const valid = ParentSettings.parse(s);
  run(db, "INSERT INTO settings(key, json) VALUES('parent', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(valid));
  return valid;
}
export function loadProfile(db: DB): CompanionProfile {
  const row = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'companion'");
  const p = CompanionProfile.parse(row ? JSON.parse(row.json) : {});
  return OFFERED_LOOKS.includes(p.look) ? p : { ...p, look: OFFERED_LOOKS[0] };
}
export function saveProfile(db: DB, p: CompanionProfile) {
  const valid = CompanionProfile.parse(p);
  if (!OFFERED_LOOKS.includes(valid.look)) valid.look = OFFERED_LOOKS[0];
  run(db, "INSERT INTO settings(key, json) VALUES('companion', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(valid));
  return valid;
}
