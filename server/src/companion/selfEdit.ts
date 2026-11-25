// What the companion may change about itself from chat, and how:
//   - its soul (soul.md): only by asking. A proposal card; nothing changes until she says yes.
//   - how it talks (traits, the chatty/silly/detail sliders, its how-I-talk notes): small tweaks
//     straight away when it helps, at most 3 a day, each with an Undo.
//   - check-ins (the three on/off ones only): when she asks, with an Undo.
//   - memories: add only, and only by asking (a card per memory). Never edited or deleted from chat;
//     she does that herself in "What Pip remembers".
// Every tool here is staged like the others (see tools.ts): nothing happens unless the reply passes
// the output safety check, and each change's own words get that check too.

import { z } from "zod";
import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { config } from "../config.js";
import { loadProfile, saveProfile, TRAITS, type CompanionProfile } from "../settings.js";
import { memoryProblem } from "./memory.js";
import { DEFAULT_SOUL } from "./prompt.js";
import type { ToolDef } from "../connections/connections.js";
import type { SafetyChecker } from "../safety/check.js";
import { checkInputRules } from "../safety/rules.js";
import type { InputCategory } from "../safety/types.js";
import { isWorry, withRuleWorries } from "../reporting/outside.js";
import { startOfDay } from "../budget/time.js";
import { logActivity } from "../desk/activity.js";
// Type-only, so there's no import cycle with tools.ts at run time.
import type { TurnEffects } from "./tools.js";

const DAY = 86_400_000;
export const PROPOSAL_DAYS = 7;
export const SOUL_COOLDOWN_DAYS = 3;
export const MEMORY_PENDING_MAX = 5;
export const TUNES_PER_DAY = 3;
export const SLIDER_STEP = 15;
const NOTE_MAX = 300;
const SOUL_ADD_MAX = 600;
const SOUL_MAX = 3000;
const NOTES_MAX = 2000;

export type ChangeKind = "soul" | "memory" | "personality" | "checkins";
export type ChangeStatus = "pending" | "accepted" | "declined" | "expired" | "replaced" | "failed" | "applied" | "undone";

export interface SoulPayload { change: "add" | "edit"; text: string; why: string; before: string }
export interface MemoryPayload { icon: string; text: string; aboutDate: string | null; why: string }
/** The profile fields a tweak may touch, before and after (only the ones it changed). */
export type Snapshot = Partial<Pick<CompanionProfile, "traits" | "chatty" | "silly" | "detail" | "identityNotes" | "checkins">>;
export interface TweakPayload { before: Snapshot; after: Snapshot; summary: string[]; logSummary: string[]; why: string }

interface Row { id: number; ts: number; kind: ChangeKind; status: ChangeStatus; payload: string; decided: number | null; result: string }

export interface ChangeView {
  id: number; ts: number; kind: ChangeKind; status: ChangeStatus; title: string;
  lines: { op: "+" | "-" | "~" | "·"; text: string }[]; why: string; result: string; canUndo: boolean;
}

/** The text a filter keeps for "the same memory" (case and punctuation don't count). */
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

// ── Storage ─────────────────────────────────────────────────────────────────────────────────

function insert(db: DB, kind: ChangeKind, status: ChangeStatus, payload: unknown, now = Date.now()): number {
  return Number(run(db, "INSERT INTO pip_changes(ts, kind, status, payload) VALUES (?,?,?,?)", now, kind, status, JSON.stringify(payload)).lastInsertRowid);
}
function setStatus(db: DB, id: number, status: ChangeStatus, result = "", now = Date.now()) {
  run(db, "UPDATE pip_changes SET status = ?, decided = ?, result = ? WHERE id = ?", status, now, result, id);
}
export function getChange(db: DB, id: number): Row | undefined {
  return get<Row>(db, "SELECT * FROM pip_changes WHERE id = ?", id);
}

/** Pending proposals over a week old expire; long-settled records are tidied away. */
export function expireOld(db: DB, now = Date.now()) {
  run(db, "UPDATE pip_changes SET status = 'expired', decided = ? WHERE status = 'pending' AND ts < ?", now, now - PROPOSAL_DAYS * DAY);
  run(db, "DELETE FROM pip_changes WHERE status NOT IN ('pending', 'applied') AND COALESCE(decided, ts) < ?", now - 60 * DAY);
}

/** When the soul may be asked about again after a "Not now" (null when it can be now). */
export function soulCooldownUntil(db: DB, now = Date.now()): number | null {
  const last = get<{ decided: number }>(db, "SELECT decided FROM pip_changes WHERE kind = 'soul' AND status = 'declined' ORDER BY decided DESC LIMIT 1");
  const until = last ? last.decided + SOUL_COOLDOWN_DAYS * DAY : 0;
  return until > now ? until : null;
}

/** Her soul as the companion sees it (the starter soul when she hasn't written one). */
export function effectiveSoul(p: CompanionProfile): string {
  return p.soul.trim() || DEFAULT_SOUL(p.name);
}

export function soulAfter(current: string, p: Pick<SoulPayload, "change" | "text">): string {
  return p.change === "add" ? `${current.trimEnd()}\n${p.text.trim()}`.trim() : p.text.trim();
}

/** One soul proposal at a time: a new one replaces any older one still waiting. */
export function createSoulProposal(db: DB, p: Omit<SoulPayload, "before">, now = Date.now()): number {
  expireOld(db, now);
  for (const r of all<{ id: number }>(db, "SELECT id FROM pip_changes WHERE kind = 'soul' AND status = 'pending'")) setStatus(db, r.id, "replaced", "", now);
  return insert(db, "soul", "pending", { ...p, before: effectiveSoul(loadProfile(db)) } satisfies SoulPayload, now);
}

/** Several memory proposals can wait at once (up to 5; the oldest drop off). */
export function createMemoryProposal(db: DB, p: MemoryPayload, now = Date.now()): number {
  expireOld(db, now);
  const id = insert(db, "memory", "pending", p, now);
  const waiting = all<{ id: number }>(db, "SELECT id FROM pip_changes WHERE kind = 'memory' AND status = 'pending' ORDER BY ts DESC, id DESC");
  for (const r of waiting.slice(MEMORY_PENDING_MAX)) setStatus(db, r.id, "expired", "", now);
  return id;
}

function memoryRows(db: DB, status: ChangeStatus) {
  return all<{ payload: string }>(db, "SELECT payload FROM pip_changes WHERE kind = 'memory' AND status = ?", status).map((r) => JSON.parse(r.payload) as MemoryPayload);
}
/** She said "No thanks" to this memory before: it isn't asked again. */
export function memoryDeclined(db: DB, text: string) { return memoryRows(db, "declined").some((m) => norm(m.text) === norm(text)); }
export function memoryWaiting(db: DB, text: string) { return memoryRows(db, "pending").some((m) => norm(m.text) === norm(text)); }

/** Personality tweaks today (undone ones count too, so undo-and-redo can't go round the limit). */
export function tweaksToday(db: DB, now = Date.now()): number {
  return get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM pip_changes WHERE kind = 'personality' AND ts >= ?", startOfDay(now, config.timezone))?.n ?? 0;
}

// ── Decisions (the routes call these; the soul and memory checks run in the route first) ─────

export type Decision = { ok: true; view: ChangeView; profile?: CompanionProfile } | { ok: false; status: number; error: string };

/** The soul a yes would save, or why it can't be saved. Changes nothing. */
export function soulForAccept(db: DB, id: number, now = Date.now()): { ok: true; text: string } | { ok: false; status: number; error: string } {
  expireOld(db, now);
  const r = getChange(db, id);
  if (!r || r.kind !== "soul") return { ok: false, status: 404, error: "That suggestion isn't here any more." };
  if (r.status !== "pending") return { ok: false, status: 409, error: r.status === "expired" ? "That suggestion ran out. Ask again if you’d still like it." : "That one’s already been answered." };
  const p = JSON.parse(r.payload) as SoulPayload;
  const current = effectiveSoul(loadProfile(db));
  if (p.change === "edit" && current !== p.before) {
    setStatus(db, id, "failed", "Your soul changed since this was suggested.", now);
    return { ok: false, status: 409, error: "Your soul has changed since I asked, so I didn’t change it. Ask me again if you’d still like it." };
  }
  const text = soulAfter(current, p);
  if (text.length > SOUL_MAX) return { ok: false, status: 422, error: "That would make the soul too long. You can tidy it up on My Pip first." };
  return { ok: true, text };
}

export function applySoul(db: DB, id: number, text: string, now = Date.now()): Decision {
  const profile = saveProfile(db, { ...loadProfile(db), soul: text });
  setStatus(db, id, "accepted", "", now);
  logActivity(db, "✨", `${profile.name}’s soul was changed (it asked first, and got a yes)`);
  return { ok: true, view: viewOf(getChange(db, id)!), profile };
}

export function memoryForAccept(db: DB, id: number, now = Date.now()): { ok: true; memory: MemoryPayload } | { ok: false; status: number; error: string } {
  expireOld(db, now);
  const r = getChange(db, id);
  if (!r || r.kind !== "memory") return { ok: false, status: 404, error: "That suggestion isn't here any more." };
  if (r.status !== "pending") return { ok: false, status: 409, error: r.status === "expired" ? "That one ran out. You can add it yourself in What Pip remembers." : "That one’s already been answered." };
  return { ok: true, memory: JSON.parse(r.payload) as MemoryPayload };
}

export function settle(db: DB, id: number, status: "accepted" | "failed", result = "", now = Date.now()): ChangeView {
  setStatus(db, id, status, result, now);
  return viewOf(getChange(db, id)!);
}

export function decline(db: DB, id: number, now = Date.now()): Decision {
  expireOld(db, now);
  const r = getChange(db, id);
  if (!r || (r.kind !== "soul" && r.kind !== "memory")) return { ok: false, status: 404, error: "That suggestion isn't here any more." };
  if (r.status !== "pending") return { ok: true, view: viewOf(r) };
  setStatus(db, id, "declined", "", now);
  return { ok: true, view: viewOf(getChange(db, id)!) };
}

/** Undo a tweak: the fields it changed go back exactly, if nothing has changed them since. */
export function undoTweak(db: DB, id: number, now = Date.now()): Decision {
  const r = getChange(db, id);
  if (!r || (r.kind !== "personality" && r.kind !== "checkins")) return { ok: false, status: 404, error: "That change isn't here any more." };
  if (r.status !== "applied") return { ok: false, status: 409, error: "That one’s already been undone." };
  const p = JSON.parse(r.payload) as TweakPayload;
  const profile = loadProfile(db);
  const same = Object.keys(p.after).every((k) => JSON.stringify(profile[k as keyof Snapshot]) === JSON.stringify(p.after[k as keyof Snapshot]));
  if (!same) {
    return { ok: false, status: 409, error: r.kind === "checkins" ? "That’s been changed again since. Just ask me to set it how you’d like." : "That’s been changed again since, so there’s nothing to undo. You can set it on Personality." };
  }
  const saved = saveProfile(db, { ...profile, ...p.before });
  setStatus(db, id, "undone", "", now);
  logActivity(db, "↩️", r.kind === "checkins" ? "A check-in change was undone" : `A change to how ${saved.name} talks was undone`);
  return { ok: true, view: viewOf(getChange(db, id)!), profile: saved };
}

// ── What she sees ───────────────────────────────────────────────────────────────────────────

/** Removed and added lines, in order (a small LCS over lines; souls are short). */
export function lineDiff(before: string, after: string): ChangeView["lines"] {
  const a = before.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  const b = after.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: ChangeView["lines"] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { i++; j++; }
    else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) out.push({ op: "-", text: a[i++] });
    else out.push({ op: "+", text: b[j++] });
  }
  return out.length ? out : [{ op: "·", text: "No changes." }];
}

export function viewOf(r: Row): ChangeView {
  const base = { id: r.id, ts: r.ts, kind: r.kind, status: r.status, result: r.result };
  if (r.kind === "soul") {
    const p = JSON.parse(r.payload) as SoulPayload;
    return {
      ...base, why: p.why, canUndo: false,
      title: p.change === "add" ? "Can I add this to my soul?" : "Can I change my soul like this?",
      lines: p.change === "add" ? p.text.split("\n").filter((l) => l.trim()).map((text) => ({ op: "+" as const, text })) : lineDiff(p.before, p.text),
    };
  }
  if (r.kind === "memory") {
    const p = JSON.parse(r.payload) as MemoryPayload;
    return { ...base, why: p.why, canUndo: false, title: "Can I remember this?", lines: [{ op: "+", text: `${p.icon} ${p.text}${p.aboutDate ? ` (${p.aboutDate})` : ""}` }] };
  }
  const p = JSON.parse(r.payload) as TweakPayload;
  return {
    ...base, why: p.why, canUndo: r.status === "applied",
    title: r.kind === "checkins" ? "Check-ins" : "I tweaked how I talk",
    lines: p.summary.map((text) => ({ op: "~" as const, text })),
  };
}

export function listChanges(db: DB, o: { kind?: ChangeKind; limit?: number } = {}, now = Date.now()): ChangeView[] {
  expireOld(db, now);
  const rows = o.kind
    ? all<Row>(db, "SELECT * FROM pip_changes WHERE kind = ? ORDER BY ts DESC, id DESC LIMIT ?", o.kind, o.limit ?? 50)
    : all<Row>(db, "SELECT * FROM pip_changes ORDER BY ts DESC, id DESC LIMIT ?", o.limit ?? 50);
  return rows.map(viewOf);
}

// ── Personality and check-in tweaks ─────────────────────────────────────────────────────────

const SLIDERS = ["chatty", "silly", "detail"] as const;
const SLIDER_WORDS: Record<(typeof SLIDERS)[number], [string, string]> = { chatty: ["chatty", "calm"], silly: ["silly", "serious"], detail: ["detailed", "brief"] };

export const TuneInput = z.object({
  traits: z.array(z.enum(TRAITS)).min(1).max(3).optional(),
  chatty: z.number().int().optional(),
  silly: z.number().int().optional(),
  detail: z.number().int().optional(),
  add_note: z.string().trim().min(1).max(NOTE_MAX).optional(),
  edit_note: z.object({ find: z.string().min(1).max(NOTES_MAX), replace: z.string().max(NOTE_MAX) }).strict().optional(),
  why: z.string().trim().max(200).default(""),
}).strict();
export type TuneInput = z.infer<typeof TuneInput>;

const NOT_MINE = "Not changed: I can only tweak my traits, the chatty, silly and detail sliders, and my how-I-talk notes. My name, look, voice, soul and everything else are hers to change.";

/** What a tweak would change, worked out against the profile as it is. Saves nothing. */
export function planTune(p: CompanionProfile, raw: unknown): { ok: true; payload: TweakPayload; noteText: string } | { ok: false; problem: string } {
  const parsed = TuneInput.safeParse(raw);
  if (!parsed.success) {
    const unknown = parsed.error.issues.some((i) => i.code === "unrecognized_keys");
    return { ok: false, problem: unknown ? NOT_MINE : `Not changed: ${parsed.error.issues[0]?.message ?? "that didn't make sense"}.` };
  }
  const v = parsed.data;
  const before: Snapshot = {}, after: Snapshot = {};
  const summary: string[] = [], logSummary: string[] = [];
  if (v.traits) {
    const next = [...new Set(v.traits)];
    if (JSON.stringify(next) !== JSON.stringify(p.traits)) {
      before.traits = p.traits; after.traits = next;
      const s = `traits now: ${next.join(", ")}`;
      summary.push(s); logSummary.push(s);
    }
  }
  for (const k of SLIDERS) {
    const d = v[k];
    if (d === undefined || d === 0) continue;
    const step = Math.max(-SLIDER_STEP, Math.min(SLIDER_STEP, d));
    const next = Math.max(0, Math.min(100, p[k] + step));
    if (next === p[k]) continue;
    before[k] = p[k]; after[k] = next;
    const moved = Math.abs(next - p[k]);
    const s = `${moved <= 8 ? "a little " : ""}${next > p[k] ? "more" : "less"} ${SLIDER_WORDS[k][0]}`;
    summary.push(s); logSummary.push(s);
  }
  let notes = p.identityNotes;
  let noteText = "";
  if (v.edit_note) {
    if (!notes.includes(v.edit_note.find)) return { ok: false, problem: "Not changed: those words aren't in my how-I-talk notes." };
    notes = notes.replace(v.edit_note.find, v.edit_note.replace.trim());
    noteText += `${v.edit_note.replace}\n`;
    summary.push(v.edit_note.replace.trim() ? `changed a note to: “${v.edit_note.replace.trim()}”` : `took out a note: “${v.edit_note.find.trim().slice(0, 80)}”`);
    logSummary.push("changed one of its how-I-talk notes");
  }
  if (v.add_note) {
    notes = `${notes.trimEnd()}\n${v.add_note}`.trim();
    noteText += v.add_note;
    summary.push(`added a note: “${v.add_note}”`);
    logSummary.push("added a how-I-talk note");
  }
  if (notes !== p.identityNotes) {
    if (notes.length > NOTES_MAX) return { ok: false, problem: "Not changed: my how-I-talk notes would be too long. She can tidy them up on My Pip." };
    before.identityNotes = p.identityNotes; after.identityNotes = notes;
  }
  if (!Object.keys(after).length) return { ok: false, problem: "Nothing to change: that's already how I am." };
  return { ok: true, payload: { before, after, summary, logSummary, why: v.why }, noteText: noteText.trim() };
}

export const CheckinsInput = z.object({
  askHowThingsWent: z.boolean().optional(),
  morningHello: z.boolean().optional(),
  waterWhileRevising: z.boolean().optional(),
  why: z.string().trim().max(200).default(""),
}).strict();

const CHECKIN_WORDS: Record<keyof CompanionProfile["checkins"], string> = {
  askHowThingsWent: "asking how big things went", morningHello: "morning hello", waterWhileRevising: "water reminders while revising",
};
const NOT_CHECKINS = "Not changed: from chat I can only switch the three check-ins on or off (asking how things went, the morning hello, water reminders). Quiet hours, how many a day and notifications aren't mine to change.";

export function planCheckins(p: CompanionProfile, raw: unknown): { ok: true; payload: TweakPayload } | { ok: false; problem: string } {
  const parsed = CheckinsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues.some((i) => i.code === "unrecognized_keys") ? NOT_CHECKINS : "Not changed: that didn't make sense." };
  const next = { ...p.checkins };
  const summary: string[] = [];
  for (const k of Object.keys(CHECKIN_WORDS) as (keyof CompanionProfile["checkins"])[]) {
    const v = parsed.data[k];
    if (v === undefined || v === p.checkins[k]) continue;
    next[k] = v;
    summary.push(`${CHECKIN_WORDS[k]} ${v ? "on" : "off"}`);
  }
  if (!summary.length) return { ok: false, problem: "Nothing to change: the check-ins are already like that." };
  return { ok: true, payload: { before: { checkins: p.checkins }, after: { checkins: next }, summary, logSummary: summary, why: parsed.data.why } };
}

/** Saves a tweak and records it (with what it was before, for Undo). */
export function applyTweak(db: DB, kind: "personality" | "checkins", payload: TweakPayload, now = Date.now()): number {
  const profile = saveProfile(db, { ...loadProfile(db), ...payload.after });
  const id = insert(db, kind, "applied", payload, now);
  logActivity(db, kind === "checkins" ? "🔔" : "🎛️", kind === "checkins" ? `Check-ins changed (she asked): ${payload.logSummary.join(" · ")}` : `${profile.name} tweaked how it talks: ${payload.logSummary.join(" · ")}`);
  return id;
}

// ── The input check for words that go into her files ────────────────────────────────────────

/**
 * The same input check as PUT /api/pip/identity and /api/pip/soul (the safety model and the fixed
 * rules; no romance, nothing sexual, no personal details), without reporting: these words are the
 * companion's, not hers. Fails closed.
 */
export async function textAllowed(safety: SafetyChecker | undefined, text: string): Promise<boolean> {
  if (!text.trim()) return true;
  if (!safety) return false;
  try {
    const v = withRuleWorries(await safety.checkInput(text, []), text);
    if (v.held || isWorry(v)) return false;
    const refuse: InputCategory[] = ["sexual", "romance", "personal_info"];
    return ![...checkInputRules(text).categories, ...v.categories].some((c) => refuse.includes(c));
  } catch {
    return false;
  }
}

// ── The tools ───────────────────────────────────────────────────────────────────────────────

const HELD = "(This is held until your reply is sent, and only goes ahead if it passes the safety check.)";
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object" as const, additionalProperties: false, properties, required });

/** Proposal and tweak tools. `untrusted`/`childSaid` on the effects keep outside text out of memories. */
export function selfTools(db: DB, fx: TurnEffects, safety: SafetyChecker | undefined, copied: (text: string) => boolean): ToolDef[] {
  const tool = (name: string, description: string, input_schema: ToolDef["input_schema"], run: ToolDef["run"]): ToolDef =>
    ({ name, description, input_schema, connection: "companion", level: "act", run });
  const later = async (label: string, text: string, commit: () => void | Promise<void>) => {
    const s = { label, text, commit };
    if (fx.staged) fx.staged.push(s); else await commit();
  };
  const changed = (id: number) => { (fx.changes ??= []).push(id); };
  // What this turn has already held back (a redo after a stopped draft starts with none).
  const held = (label: string) => (fx.staged ?? []).filter((s) => s.label === label);
  const name = loadProfile(db).name;

  return [
    tool(
      "remember",
      `Ask to remember something that matters to them (an upcoming test or show, what they're into, how they like to revise). You never save a memory yourself: this shows them a card with “Yes, remember it” / “No thanks”, and only a yes saves it. So ask in words in the same reply too (e.g. “Want me to remember that your show is on Friday?”). Never personal details like address, school, full name or phone. If they said no thanks to a memory, don't ask about it again. You can't change or forget memories: if they want one changed or forgotten, tell them they can do it themselves in “What ${name} remembers”.`,
      obj({
        icon: { type: "string", description: "One emoji for the memory" },
        text: { type: "string", description: "Short, e.g. 'Presentation on the Victorians, Wednesday'" },
        about_date: { type: "string", description: "YYYY-MM-DD if it's about a day (so you can ask how it went), else empty" },
      }, ["icon", "text", "about_date"]),
      async (input) => {
        const v = z.object({ icon: z.string(), text: z.string(), about_date: z.string().optional(), why: z.string().max(200).optional() }).parse(input);
        const text = v.text.trim().slice(0, 140);
        const problem = memoryProblem(db, text);
        if (problem) return `Not asked: ${problem}`;
        if (copied(text)) return "Not asked: that came from a document, their calendar or a web page, not from them. Only offer to remember what they tell you themselves.";
        if (memoryDeclined(db, text)) return "Not asked: they said no thanks to remembering that before, so don't ask again.";
        if (memoryWaiting(db, text) || held("memory proposal").some((s) => norm(s.text) === norm(text))) return "Already asked: that one is waiting for their answer.";
        const date = v.about_date && /^\d{4}-\d{2}-\d{2}$/.test(v.about_date) ? v.about_date : null;
        await later("memory proposal", text, () => changed(createMemoryProposal(db, { icon: (v.icon || "💭").slice(0, 8), text, aboutDate: date, why: v.why ?? "" })));
        return `Asked. They'll see a card under your reply; nothing is remembered unless they tap “Yes, remember it”, so ask them in words too. ${HELD}`;
      },
    ),
    tool(
      "propose_soul_change",
      `Suggest adding to your soul (who you are, in their words) or changing it. You never change it yourself: they see a card with your suggested words and “Yes, change it” / “Not now”, and nothing changes unless they say yes. Ask them in words in the same reply too, and don't talk as if it's changed. Only when it really fits (they said something about who you are, or asked). For "add": just the new lines. For "edit": the whole new soul (max 3000 characters). If they say not now, leave it for at least ${SOUL_COOLDOWN_DAYS} days.`,
      obj({
        change: { type: "string", enum: ["add", "edit"] },
        text: { type: "string", description: "add: the lines to add. edit: the full new soul." },
        why: { type: "string", description: "One short line, to them: why you'd like this" },
      }, ["change", "text", "why"]),
      async (input) => {
        const until = soulCooldownUntil(db);
        if (until) return `Not asked: they said not now to a soul change recently, so don't bring your soul up again until ${new Date(until).toISOString().slice(0, 10)}. Just carry on chatting kindly.`;
        if (held("soul proposal").length) return "Not asked: you've already suggested a soul change in this reply.";
        const v = z.object({ change: z.enum(["add", "edit"]), text: z.string().trim().min(1).max(SOUL_MAX), why: z.string().trim().min(1).max(200) }).safeParse(input);
        if (!v.success) return "Not asked: give the change (add or edit), the words, and a short why.";
        if (v.data.change === "add" && v.data.text.length > SOUL_ADD_MAX) return `Not asked: keep an addition under ${SOUL_ADD_MAX} characters.`;
        const current = effectiveSoul(loadProfile(db));
        const next = soulAfter(current, v.data);
        if (next.length > SOUL_MAX) return "Not asked: that would make your soul too long.";
        if (next === current) return "Not asked: that's already your soul.";
        await later("soul proposal", `${v.data.text}\n${v.data.why}`, () => changed(createSoulProposal(db, v.data)));
        return `Asked. They'll see a card with “Yes, change it” / “Not now”; nothing changes unless they say yes, so ask them in words too. ${HELD}`;
      },
    ),
    tool(
      "tune_personality",
      `Make a small tweak to how you talk, when it would help your chats go better (for example they keep asking for shorter answers, or they love your jokes). Tell them what you changed; they get an Undo button. Only: traits (1–3 from the list), the chatty / silly / detail sliders (each moves by -${SLIDER_STEP} to +${SLIDER_STEP}), and your how-I-talk notes (add_note adds a line; edit_note changes words in them). Never your name, look, voice or soul. At most ${TUNES_PER_DAY} tweaks a day.`,
      obj({
        traits: { type: "array", items: { type: "string", enum: [...TRAITS] }, description: "The new set of 1–3 traits (leave out to keep them)" },
        chatty: { type: "integer", minimum: -SLIDER_STEP, maximum: SLIDER_STEP, description: "Change: + chattier, - calmer" },
        silly: { type: "integer", minimum: -SLIDER_STEP, maximum: SLIDER_STEP, description: "Change: + sillier, - more serious" },
        detail: { type: "integer", minimum: -SLIDER_STEP, maximum: SLIDER_STEP, description: "Change: + explain more, - shorter answers" },
        add_note: { type: "string", description: "A short line to add to your how-I-talk notes" },
        edit_note: obj({ find: { type: "string" }, replace: { type: "string" } }, ["find", "replace"]),
        why: { type: "string", description: "One short line: why this helps" },
      }, ["why"]),
      async (input) => {
        // Held ones aren't in the table yet, so they count too.
        if (tweaksToday(db) + held("personality tweak").length >= TUNES_PER_DAY) return `Not changed: you've already tweaked yourself ${TUNES_PER_DAY} times today. Try again tomorrow, or they can change it on Personality.`;
        const plan = planTune(loadProfile(db), input);
        if (!plan.ok) return plan.problem;
        if (plan.noteText && !(await textAllowed(safety, plan.noteText))) return "Not changed: that note can't go in. Keep it friendly, with no personal details.";
        await later("personality tweak", [plan.noteText, plan.payload.why].filter(Boolean).join("\n"), async () => {
          // Worked out again against the profile as it is now (another tweak may have gone first).
          const fresh = planTune(loadProfile(db), input);
          if (!fresh.ok) return;
          if (fresh.noteText && !(await textAllowed(safety, fresh.noteText))) return;
          changed(applyTweak(db, "personality", fresh.payload));
        });
        return `Done once your reply is sent: ${plan.payload.summary.join(" · ")}. Tell them briefly what you changed; they can tap Undo. ${HELD}`;
      },
    ),
    tool(
      "change_checkins",
      "Switch a check-in on or off, ONLY when they clearly ask (e.g. “stop the morning hellos”, “can you check how my test went?”). Just these three: askHowThingsWent (asking how big things went), morningHello (a hello on school-day mornings), waterWhileRevising (water reminders while revising). Quiet hours, how many a day and notifications can't be changed from chat.",
      obj({
        askHowThingsWent: { type: "boolean" }, morningHello: { type: "boolean" }, waterWhileRevising: { type: "boolean" },
        why: { type: "string", description: "What they asked, in a few words" },
      }, ["why"]),
      async (input) => {
        if (held("check-in change").length) return "Already changed in this reply.";
        const plan = planCheckins(loadProfile(db), input);
        if (!plan.ok) return plan.problem;
        await later("check-in change", plan.payload.why, () => {
          const fresh = planCheckins(loadProfile(db), input);
          if (fresh.ok) changed(applyTweak(db, "checkins", fresh.payload));
        });
        return `Done once your reply is sent: ${plan.payload.summary.join(" · ")}. They can tap Undo. ${HELD}`;
      },
    ),
  ];
}
