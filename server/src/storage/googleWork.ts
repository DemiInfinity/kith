// Reading and changing things in the child's own Google account, within firm limits:
//
// - Docs, Sheets and Slides: only files she picked with the Google Picker or that Kith made
//   (drive.file). Edits go through the Docs, Sheets and Slides APIs as batchUpdates, so Google's
//   version history keeps every change ("File › Version history" restores the previous version).
//   Never a delete, a trash, a move or a sharing change. Coursework is never edited.
// - Calendar: her primary calendar only. Read her events; create events she confirms; change or
//   delete only events Kith made (tagged in extendedProperties). Never attendees, never emails.
// - Tasks: one "Homework" list, read, added to and ticked off with her.
//
// Every write is a proposal first: the companion proposes it, she sees a short diff-like summary,
// and only her "yes" applies it. Each feature has its own switch in the parent view (all off by
// default), and every read and write is logged for the parent view and "What … sees".

import { z } from "zod";
import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { loadParentSettings } from "../settings.js";
import { redactPersonal } from "../safety/rules.js";
import { CALENDAR_SCOPE, knownFile, loadGoogle, MIME, TASKS_SCOPE, type GoogleDrive, type GoogleFeatures, type KnownFile } from "./google.js";

const DOCS = "https://docs.googleapis.com/v1/documents";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const SLIDES = "https://slides.googleapis.com/v1/presentations";
const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TASKS = "https://tasks.googleapis.com/tasks/v1";
export const RESTORE_HINT = "If you change your mind, open it in Google and use File › Version history › See version history to restore the previous version.";

// ── Switches and logging ────────────────────────────────────────────────────────────────────

export function googleFeatures(db: DB): GoogleFeatures & { on: boolean } {
  const c = loadParentSettings(db).connections.find((x) => x.kind === "google-drive");
  const f = c?.features ?? { edit: false, calendar: false, tasks: false };
  return { on: !!c?.enabled, edit: !!c?.enabled && f.edit, calendar: !!c?.enabled && f.calendar, tasks: !!c?.enabled && f.tasks };
}
export type Feature = "edit" | "calendar" | "tasks";
const FEATURE_WORDS: Record<Feature, string> = { edit: "editing Docs, Sheets and Slides", calendar: "your calendar", tasks: "your Homework list" };

/** Throws a friendly error unless this feature is switched on and its scope was granted. */
export function need(db: DB, f: Feature) {
  if (!googleFeatures(db)[f]) throw new GoogleRefusal(`Your grown-up hasn't switched on ${FEATURE_WORDS[f]} in Kith.`);
  const s = loadGoogle(db);
  if (!s) throw new GoogleRefusal("Google isn't connected.");
  const scope = f === "calendar" ? CALENDAR_SCOPE : f === "tasks" ? TASKS_SCOPE : null;
  if (scope && !(s.scopes ?? []).includes(scope)) throw new GoogleRefusal(`To use ${FEATURE_WORDS[f]}, connect Google again (Settings › Google) so it can ask for that.`);
}
export class GoogleRefusal extends Error {}

export function gLog(db: DB, tool: string, level: "look" | "act", args: string, result: string, ok = true) {
  run(db, "INSERT INTO tool_log(ts, connection, tool, level, args, result, ok) VALUES (?,?,?,?,?,?,?)",
    Date.now(), "Google", tool, level, redactPersonal(args).text.slice(0, 400), redactPersonal(result).text.slice(0, 400), ok ? 1 : 0);
}

// ── Files ───────────────────────────────────────────────────────────────────────────────────

export function listFiles(db: DB): KnownFile[] {
  return all<KnownFile>(db, "SELECT * FROM google_files ORDER BY ts DESC LIMIT 100");
}
export function setCoursework(db: DB, id: string, coursework: boolean) {
  run(db, "UPDATE google_files SET coursework = ? WHERE id = ?", coursework ? 1 : 0, id);
}
const ID = z.string().regex(/^[a-zA-Z0-9_-]{10,100}$/);
const KINDS: Record<string, "doc" | "sheet" | "slides"> = { [MIME.doc]: "doc", [MIME.sheet]: "sheet", [MIME.slides]: "slides" };

/** Only files she picked or Kith made, and only Docs, Sheets and Slides. */
export function editableFile(db: DB, id: string, opts: { forEdit?: boolean; coursework?: boolean } = {}): KnownFile & { kind: "doc" | "sheet" | "slides" } {
  if (!ID.safeParse(id).success) throw new GoogleRefusal("That isn't a Google file id.");
  const f = knownFile(db, id);
  if (!f) throw new GoogleRefusal("I can only open files you picked for me with the Google Picker, or ones I made.");
  const kind = KINDS[f.mime];
  if (!kind) throw new GoogleRefusal("I can only work with Google Docs, Sheets and Slides.");
  if (opts.forEdit && (f.coursework || opts.coursework)) {
    throw new GoogleRefusal("That's coursework, so it has to be all your own work: I won't edit it. I can still explain things and give feedback.");
  }
  return { ...f, kind };
}

export async function readFile(db: DB, drive: GoogleDrive, id: string): Promise<string> {
  need(db, "edit");
  const f = editableFile(db, id);
  let text = "";
  if (f.kind === "doc") {
    const d = await drive.call<{ body?: { content?: { paragraph?: { elements?: { textRun?: { content?: string } }[] } }[] } }>(`${DOCS}/${id}`);
    text = (d.body?.content ?? []).map((c) => (c.paragraph?.elements ?? []).map((e) => e.textRun?.content ?? "").join("")).join("");
  } else if (f.kind === "sheet") {
    const meta = await drive.call<{ sheets?: { properties: { title: string } }[] }>(`${SHEETS}/${id}?fields=sheets.properties.title`);
    const first = meta.sheets?.[0]?.properties.title ?? "Sheet1";
    const v = await drive.call<{ values?: string[][] }>(`${SHEETS}/${id}/values/${encodeURIComponent(`'${first}'!A1:Z200`)}`);
    text = `Sheet "${first}":\n` + (v.values ?? []).map((r, i) => `${i + 1}: ${r.join(" | ")}`).join("\n");
  } else {
    const p = await drive.call<{ slides?: { pageElements?: { shape?: { text?: { textElements?: { textRun?: { content?: string } }[] } } }[] }[] }>(`${SLIDES}/${id}`);
    text = (p.slides ?? []).map((sl, i) => `Slide ${i + 1}:\n` + (sl.pageElements ?? []).map((el) => (el.shape?.text?.textElements ?? []).map((t) => t.textRun?.content ?? "").join("")).join("")).join("\n");
  }
  gLog(db, "read_file", "look", f.name, `${text.length} characters`);
  return text.slice(0, 30_000);
}

// ── Proposals: nothing is written until she says yes ───────────────────────────────────────

// Small enough that her card can show the whole change, word for word: a Doc change is at most
// 4 blocks of 2,000 characters, a Sheet change at most 50 rows of 10 cells (in all), Slides 4 changes.
export const MAX_DOC_CHANGES = 4;
export const MAX_DOC_CHARS = 2000;
export const MAX_SHEET_ROWS = 50;
export const MAX_SHEET_COLS = 10;
export const DocChange = z.discriminatedUnion("op", [
  z.object({ op: z.literal("append"), text: z.string().min(1).max(MAX_DOC_CHARS) }),
  z.object({ op: z.literal("replace"), find: z.string().min(1).max(500), with: z.string().max(MAX_DOC_CHARS) }),
]);
const Cells = z.array(z.array(z.string().max(500)).max(MAX_SHEET_COLS)).min(1).max(MAX_SHEET_ROWS);
export const SheetChange = z.discriminatedUnion("op", [
  z.object({ op: z.literal("append_rows"), rows: Cells }),
  z.object({ op: z.literal("set_cells"), range: z.string().regex(/^[A-Z]{1,2}[0-9]{1,4}(:[A-Z]{1,2}[0-9]{1,4})?$/), values: Cells }),
]);
export const SlidesChange = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace"), find: z.string().min(1).max(500), with: z.string().max(2000) }),
  z.object({ op: z.literal("add_slide"), title: z.string().max(200), body: z.string().max(2000) }),
]);
const When = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/);
export const CalendarAction = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), title: z.string().min(1).max(120), start: When, end: When.optional(), notes: z.string().max(500).default("") }),
  z.object({ op: z.literal("update"), eventId: z.string().regex(/^[A-Za-z0-9_-]{4,200}$/), title: z.string().min(1).max(120).optional(), start: When.optional(), end: When.optional(), notes: z.string().max(500).optional() }),
  z.object({ op: z.literal("delete"), eventId: z.string().regex(/^[A-Za-z0-9_-]{4,200}$/) }),
]);
export const TaskAction = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), title: z.string().min(1).max(200), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), notes: z.string().max(500).default("") }),
  z.object({ op: z.literal("complete"), taskId: z.string().regex(/^[A-Za-z0-9_-]{4,200}$/), title: z.string().max(200).default("") }),
]);

export type Payload =
  | { kind: "file"; fileId: string; changes: unknown[] }
  | { kind: "calendar"; action: z.infer<typeof CalendarAction> }
  | { kind: "tasks"; action: z.infer<typeof TaskAction> };
/** One line of the diff-like summary: + added, - removed, ~ changed, · note. */
export interface Line { op: "+" | "-" | "~" | "·"; text: string }
export interface Pending { id: number; ts: number; kind: string; title: string; lines: Line[]; status: string; result: string }

// The card shows exactly what will be applied: every line in full, nothing shortened or left out.
const cellRows = (rows: string[][]) => rows.map((r) => r.join(" | "));

/**
 * 'staged': made during a chat turn and not shown (or appliable) until the reply passes the safety
 * check; then `publish` makes it 'pending' (a card she can say yes to).
 */
export type ProposalStatus = "pending" | "staged";

function save(db: DB, kind: string, title: string, lines: Line[], payload: Payload, status: ProposalStatus = "pending"): Pending {
  const res = run(db, "INSERT INTO google_actions(ts, kind, title, lines, payload, status) VALUES (?,?,?,?,?,?)", Date.now(), kind, title.slice(0, 160), JSON.stringify(lines), JSON.stringify(payload), status);
  return pending(db, Number(res.lastInsertRowid))!;
}
export function pending(db: DB, id: number): Pending | null {
  const r = get<{ id: number; ts: number; kind: string; title: string; lines: string; status: string; result: string }>(db, "SELECT id, ts, kind, title, lines, status, result FROM google_actions WHERE id = ?", id);
  return r ? { ...r, lines: JSON.parse(r.lines) as Line[] } : null;
}
export function pendingList(db: DB): Pending[] {
  // Proposals expire after a day: an old "yes" shouldn't apply something she's forgotten about.
  run(db, "UPDATE google_actions SET status = 'expired' WHERE status = 'pending' AND ts < ?", Date.now() - 86_400_000);
  return all<{ id: number }>(db, "SELECT id FROM google_actions WHERE status = 'pending' ORDER BY id").map((r) => pending(db, r.id)!);
}

/** Proposes changes to a Doc, Sheet or Slides file. Checks everything now; writes nothing. */
export function proposeFileEdit(db: DB, input: { fileId: string; summary: string; changes: unknown[]; coursework?: boolean }, status: ProposalStatus = "pending"): Pending {
  need(db, "edit");
  const f = editableFile(db, input.fileId, { forEdit: true, coursework: input.coursework });
  const schema = f.kind === "doc" ? DocChange : f.kind === "sheet" ? SheetChange : SlidesChange;
  const changes = z.array(schema).min(1).max(f.kind === "sheet" ? 20 : MAX_DOC_CHANGES).parse(input.changes);
  if (f.kind === "sheet") {
    const rows = (changes as { rows?: string[][]; values?: string[][] }[]).reduce((n, c) => n + (c.rows ?? c.values ?? []).length, 0);
    if (rows > MAX_SHEET_ROWS) throw new GoogleRefusal(`That's too big to show on one card: keep it to ${MAX_SHEET_ROWS} rows at a time.`);
  }
  const lines: Line[] = [{ op: "·", text: input.summary.slice(0, 200) }];
  for (const c of changes as { op: string; [k: string]: unknown }[]) {
    if (c.op === "append") lines.push({ op: "+", text: String(c.text) });
    if (c.op === "replace") { lines.push({ op: "-", text: String(c.find) }); lines.push({ op: "+", text: String(c.with) }); }
    if (c.op === "append_rows") for (const t of cellRows(c.rows as string[][])) lines.push({ op: "+", text: t });
    if (c.op === "set_cells") for (const t of cellRows(c.values as string[][])) lines.push({ op: "~", text: `${c.range}: ${t}` });
    if (c.op === "add_slide") { lines.push({ op: "+", text: `New slide: ${String(c.title)}` }); if (String(c.body ?? "").trim()) lines.push({ op: "+", text: String(c.body) }); }
  }
  gLog(db, "propose_edit", "look", f.name, `${changes.length} change(s) waiting for a yes`);
  return save(db, "file", `Change “${f.name}”`, lines, { kind: "file", fileId: f.id, changes }, status);
}

/** Proposes a calendar change. Only events Kith made can be changed or deleted (checked again on apply). */
export async function proposeCalendar(db: DB, drive: GoogleDrive, input: unknown, status: ProposalStatus = "pending"): Promise<Pending> {
  need(db, "calendar");
  if (input && typeof input === "object" && "attendees" in input) throw new GoogleRefusal("I never invite other people to events.");
  const action = CalendarAction.parse(input);
  if (action.op !== "create") await kithEvent(drive, action.eventId);
  const lines: Line[] = action.op === "create"
    ? [{ op: "+", text: `${action.title} · ${action.start.replace("T", " ")}${action.end ? ` to ${action.end.replace("T", " ")}` : ""}` }, ...(action.notes ? [{ op: "·" as const, text: action.notes }] : [])]
    : action.op === "delete" ? [{ op: "-", text: "Remove an event Kith added" }]
    : [{ op: "~", text: [action.title, action.start?.replace("T", " ")].filter(Boolean).join(" · ") || "Change an event Kith added" }];
  return save(db, "calendar", action.op === "create" ? `Add “${action.title}” to your calendar` : action.op === "delete" ? "Remove an event" : "Change an event", lines, { kind: "calendar", action }, status);
}

export function proposeTask(db: DB, input: unknown, status: ProposalStatus = "pending"): Pending {
  need(db, "tasks");
  const action = TaskAction.parse(input);
  const lines: Line[] = action.op === "add"
    ? [{ op: "+", text: `${action.title}${action.due ? ` · due ${action.due}` : ""}` }]
    : [{ op: "~", text: `Tick off: ${action.title || "a homework task"}` }];
  return save(db, "tasks", action.op === "add" ? "Add to your Homework list" : "Tick off homework", lines, { kind: "tasks", action }, status);
}

/**
 * Withdraws proposals made during a chat turn whose reply didn't pass the safety check: the card
 * never reaches her, and a yes can't apply it.
 */
export function withdraw(db: DB, ids: number[]) {
  for (const id of ids) run(db, "UPDATE google_actions SET status = 'withdrawn' WHERE id = ? AND status IN ('pending','staged')", id);
}

/** The reply passed: a staged proposal becomes a card she can say yes to. */
export function publish(db: DB, id: number): Pending | null {
  run(db, "UPDATE google_actions SET status = 'pending', ts = ? WHERE id = ? AND status = 'staged'", Date.now(), id);
  const p = pending(db, id);
  return p?.status === "pending" ? p : null;
}

function ensureClaimColumn(db: DB) {
  const cols = (db.prepare("PRAGMA table_info(google_actions)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("claimed_ts")) db.exec("ALTER TABLE google_actions ADD COLUMN claimed_ts INTEGER");
}

/** How long a change may sit in 'applying' before it's taken as stopped part-way. */
export const STUCK_APPLYING_MS = 15 * 60_000;

/**
 * A change stuck in 'applying' (the server stopped while Google was being changed) is marked
 * failed after 15 minutes, so it isn't left half-done and silent. It's never re-applied by itself:
 * she can check the file and ask again. Returns how many.
 */
export function failStuckApplying(db: DB, now = Date.now()): number {
  ensureClaimColumn(db);
  return Number(run(db,
    "UPDATE google_actions SET status = 'failed', result = ? WHERE status = 'applying' AND COALESCE(claimed_ts, ts) < ?",
    "This was interrupted part-way, so it may not have finished. Check the file in Google, and ask again if it's not there.", now - STUCK_APPLYING_MS).changes);
}

export function decline(db: DB, id: number): boolean {
  const p = pending(db, id);
  if (!p || p.status !== "pending") return false;
  run(db, "UPDATE google_actions SET status = 'declined' WHERE id = ?", id);
  return true;
}

/** Her "yes": applies exactly what she saw. Everything is checked again first. */
export async function apply(db: DB, drive: GoogleDrive, id: number): Promise<{ ok: boolean; message: string }> {
  const r = get<{ status: string; payload: string; title: string; ts: number }>(db, "SELECT status, payload, title, ts FROM google_actions WHERE id = ?", id);
  if (!r || r.status !== "pending" || Date.now() - r.ts > 86_400_000) return { ok: false, message: "That suggestion has expired. Ask again?" };
  const p = JSON.parse(r.payload) as Payload;
  // Claiming it is the one-time step: if two taps race, only the one that moved it out of
  // "pending" applies anything.
  ensureClaimColumn(db);
  const claimed = run(db, "UPDATE google_actions SET status = 'applying', claimed_ts = ? WHERE id = ? AND status = 'pending'", Date.now(), id);
  if (Number(claimed.changes) !== 1) return { ok: false, message: "That one's already being done." };
  try {
    let message = "Done.";
    if (p.kind === "file") message = await applyFile(db, drive, p.fileId, p.changes);
    else if (p.kind === "calendar") message = await applyCalendar(db, drive, p.action);
    else message = await applyTask(db, drive, p.action);
    run(db, "UPDATE google_actions SET status = 'applied', result = ? WHERE id = ?", message.slice(0, 300), id);
    return { ok: true, message };
  } catch (e) {
    const message = e instanceof GoogleRefusal ? e.message : `Google didn't accept that: ${(e as Error).message.slice(0, 160)}`;
    run(db, "UPDATE google_actions SET status = 'failed', result = ? WHERE id = ?", message.slice(0, 300), id);
    gLog(db, "apply", "act", r.title, message, false);
    return { ok: false, message };
  }
}

async function applyFile(db: DB, drive: GoogleDrive, fileId: string, changes: unknown[]): Promise<string> {
  need(db, "edit");
  const f = editableFile(db, fileId, { forEdit: true });
  const post = (url: string, body: unknown) => drive.call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (f.kind === "doc") {
    const cs = z.array(DocChange).parse(changes);
    const requests = cs.map((c) => c.op === "append"
      ? { insertText: { endOfSegmentLocation: {}, text: c.text.startsWith("\n") ? c.text : `\n${c.text}` } }
      : { replaceAllText: { containsText: { text: c.find, matchCase: true }, replaceText: c.with } });
    await post(`${DOCS}/${fileId}:batchUpdate`, { requests });
  } else if (f.kind === "sheet") {
    const cs = z.array(SheetChange).parse(changes);
    const meta = await drive.call<{ sheets?: { properties: { title: string } }[] }>(`${SHEETS}/${fileId}?fields=sheets.properties.title`);
    const tab = `'${meta.sheets?.[0]?.properties.title ?? "Sheet1"}'`;
    for (const c of cs) {
      if (c.op === "append_rows") await post(`${SHEETS}/${fileId}/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values: c.rows });
      else await post(`${SHEETS}/${fileId}/values:batchUpdate`, { valueInputOption: "USER_ENTERED", data: [{ range: `${tab}!${c.range}`, values: c.values }] });
    }
  } else {
    const cs = z.array(SlidesChange).parse(changes);
    const requests: unknown[] = [];
    cs.forEach((c, i) => {
      if (c.op === "replace") requests.push({ replaceAllText: { containsText: { text: c.find, matchCase: true }, replaceText: c.with } });
      else {
        const sid = `kith_n${Date.now().toString(36)}${i}`;
        requests.push(
          { createSlide: { objectId: sid, slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" }, placeholderIdMappings: [{ layoutPlaceholder: { type: "TITLE" }, objectId: `${sid}t` }, { layoutPlaceholder: { type: "BODY" }, objectId: `${sid}b` }] } },
          { insertText: { objectId: `${sid}t`, text: c.title || " " } }, { insertText: { objectId: `${sid}b`, text: c.body || " " } },
        );
      }
    });
    await post(`${SLIDES}/${fileId}:batchUpdate`, { requests });
  }
  gLog(db, "edit_file", "act", f.name, `${changes.length} change(s) applied (version history keeps the old one)`);
  return `Done: “${f.name}” is updated. ${RESTORE_HINT}`;
}

// ── Calendar ────────────────────────────────────────────────────────────────────────────────

interface CalEvent { id: string; summary?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }; extendedProperties?: { private?: Record<string, string> } }

export async function listEvents(db: DB, drive: GoogleDrive, days = 14): Promise<{ id: string; title: string; start: string; end: string; kith: boolean }[]> {
  need(db, "calendar");
  const now = new Date();
  const q = new URLSearchParams({ timeMin: now.toISOString(), timeMax: new Date(now.getTime() + Math.min(60, Math.max(1, days)) * 86_400_000).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "50" });
  const r = await drive.call<{ items?: CalEvent[] }>(`${CAL}?${q}`);
  const out = (r.items ?? []).map((e) => ({ id: e.id, title: e.summary ?? "(no title)", start: e.start?.dateTime ?? e.start?.date ?? "", end: e.end?.dateTime ?? e.end?.date ?? "", kith: e.extendedProperties?.private?.kith === "1" }));
  gLog(db, "calendar_list", "look", `next ${days} days`, `${out.length} events`);
  return out;
}

async function kithEvent(drive: GoogleDrive, eventId: string): Promise<CalEvent> {
  const e = await drive.call<CalEvent>(`${CAL}/${encodeURIComponent(eventId)}`);
  if (e.extendedProperties?.private?.kith !== "1") throw new GoogleRefusal("I can only change or remove events I added. That one's yours to change in Google Calendar.");
  return e;
}

const timeOf = (when: string, tz: string) => (when.includes("T") ? { dateTime: `${when}:00`, timeZone: tz } : { date: when });
function endFor(start: string, end?: string): string {
  if (end) return end;
  if (!start.includes("T")) { const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
  const d = new Date(`${start}:00Z`); d.setUTCMinutes(d.getUTCMinutes() + 30); return d.toISOString().slice(0, 16);
}

async function applyCalendar(db: DB, drive: GoogleDrive, a: z.infer<typeof CalendarAction>): Promise<string> {
  need(db, "calendar");
  const tz = (await import("../config.js")).config.timezone;
  const json = (method: string, body?: unknown) => ({ method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  // sendUpdates=none: Google never emails anyone about these. There are never attendees.
  if (a.op === "create") {
    const body = { summary: a.title, description: a.notes || undefined, start: timeOf(a.start, tz), end: timeOf(endFor(a.start, a.end), tz), extendedProperties: { private: { kith: "1" } }, attendees: [] };
    await drive.call(`${CAL}?sendUpdates=none`, json("POST", body));
    gLog(db, "calendar_create", "act", a.title, a.start);
    return `Added “${a.title}” to your calendar.`;
  }
  await kithEvent(drive, a.eventId);
  if (a.op === "delete") {
    await drive.call(`${CAL}/${encodeURIComponent(a.eventId)}?sendUpdates=none`, { method: "DELETE" });
    gLog(db, "calendar_delete", "act", a.eventId, "removed (an event Kith added)");
    return "Removed it from your calendar.";
  }
  const patch: Record<string, unknown> = {};
  if (a.title) patch.summary = a.title;
  if (a.notes !== undefined) patch.description = a.notes;
  if (a.start) { patch.start = timeOf(a.start, tz); patch.end = timeOf(endFor(a.start, a.end), tz); }
  await drive.call(`${CAL}/${encodeURIComponent(a.eventId)}?sendUpdates=none`, json("PATCH", patch));
  gLog(db, "calendar_update", "act", a.title ?? a.eventId, "changed (an event Kith added)");
  return "Changed it in your calendar.";
}

// ── Tasks: the Homework list ────────────────────────────────────────────────────────────────

async function homeworkList(db: DB, drive: GoogleDrive): Promise<string> {
  const saved = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'google_homework_list'");
  if (saved) return JSON.parse(saved.json) as string;
  const lists = await drive.call<{ items?: { id: string; title: string }[] }>(`${TASKS}/users/@me/lists?maxResults=100`);
  let id = lists.items?.find((l) => l.title.toLowerCase() === "homework")?.id;
  if (!id) {
    id = (await drive.call<{ id: string }>(`${TASKS}/users/@me/lists`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Homework" }) })).id;
    gLog(db, "tasks_create_list", "act", "Homework", "created");
  }
  run(db, "INSERT INTO settings(key, json) VALUES('google_homework_list', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(id));
  return id;
}

export async function listHomework(db: DB, drive: GoogleDrive): Promise<{ id: string; title: string; due: string; notes: string }[]> {
  need(db, "tasks");
  const list = await homeworkList(db, drive);
  const r = await drive.call<{ items?: { id: string; title: string; due?: string; notes?: string }[] }>(`${TASKS}/lists/${list}/tasks?showCompleted=false&maxResults=100`);
  const out = (r.items ?? []).map((t) => ({ id: t.id, title: t.title, due: (t.due ?? "").slice(0, 10), notes: t.notes ?? "" }));
  gLog(db, "tasks_list", "look", "Homework", `${out.length} to do`);
  return out;
}

async function applyTask(db: DB, drive: GoogleDrive, a: z.infer<typeof TaskAction>): Promise<string> {
  need(db, "tasks");
  const list = await homeworkList(db, drive);
  if (a.op === "add") {
    await drive.call(`${TASKS}/lists/${list}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: a.title, notes: a.notes || undefined, due: a.due ? `${a.due}T00:00:00.000Z` : undefined }) });
    gLog(db, "tasks_add", "act", a.title, a.due ?? "");
    return `Added “${a.title}” to your Homework list.`;
  }
  await drive.call(`${TASKS}/lists/${list}/tasks/${a.taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed" }) });
  gLog(db, "tasks_complete", "act", a.title || a.taskId, "ticked off");
  return `Ticked off${a.title ? ` “${a.title}”` : ""}. Nice one!`;
}
