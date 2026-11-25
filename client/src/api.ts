// Small fetch wrapper. Same-origin only; the session cookie is HttpOnly. Changes carry the
// X-Kith header, which the server requires (it blocks cross-site form posts).

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

import { appHint } from "./lib/appHint";
import { announceToldGrownUp, parseToldGrownUp } from "./lib/worry";
import type { Look as Look3D } from "./pip3d/look";

const BASE = (import.meta.env.VITE_KITH_API as string | undefined) ?? "";

/** What a child sees when home can't be reached (the network, the server, or a timeout). */
export const OFFLINE_WORDS = "Can’t reach home right now. Try again in a moment.";

// Anything that waits on Claude, the voice servers, Google or an upload gets about a minute;
// everything else 15 seconds, so a hung request never leaves a spinner going for ever.
const SLOW = /^\/api\/(chat|voice\/|uploads\/|parent\/(test-chat|test-report|apikey)|desk\/make|pip\/describe|oc\/backstory|languages\/(ask|[^/]+\/(starter|cards\/generate))|study\/(cards\/generate|practice)|stories\/[^/]+\/(suggest|passages|import-google)|google\/(read-picked|picked|actions\/))/;
export function timeoutFor(path: string, method: string): number {
  return method !== "GET" && SLOW.test(path.split("?")[0]) ? 60_000 : 15_000;
}

/** True when the request was stopped on purpose (the caller's signal), not by a failure. */
export function isAbort(e: unknown): boolean {
  return (e as { name?: string })?.name === "AbortError";
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; raw?: BodyInit; type?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.raw ? "POST" : "GET");
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["X-Kith"] = "1";
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.raw) headers["Content-Type"] = opts.type ?? "application/octet-stream";
  // An installed app says which one it is, so the server only accepts its own person's session.
  const hint = appHint();
  if (hint) headers["X-Kith-App"] = hint;
  // One controller for both the caller's signal (End call, leaving a screen) and the timeout.
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, opts.timeoutMs ?? timeoutFor(path, method));
  const onAbort = () => ctrl.abort();
  if (opts.signal?.aborted) ctrl.abort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    let res: Response;
    try {
      res = await fetch(BASE + path, {
        method,
        headers,
        credentials: "include",
        body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
        signal: ctrl.signal,
      });
    } catch (e) {
      // Stopped on purpose: pass the AbortError on so the caller can tell it apart.
      if (!timedOut && opts.signal?.aborted) throw e;
      throw new ApiError(OFFLINE_WORDS, 0, timedOut ? "timeout" : "offline");
    }
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      // A worry typed outside chat: the grown-up has been told. Shown as a gentle sheet, not an error.
      const told = parseToldGrownUp(res.status, j);
      if (told) throw new ApiError(announceToldGrownUp(told), res.status, "told-grown-up");
      // A gateway in front of Kith answering for it means home itself isn't there.
      if (!j.error && [502, 503, 504].includes(res.status)) throw new ApiError(OFFLINE_WORDS, res.status, "offline");
      throw new ApiError(j.error ?? `Something went wrong (${res.status}).`, res.status, j.code);
    }
    const ct = res.headers.get("content-type") ?? "";
    try {
      return (await (ct.includes("application/json") ? res.json() : res.blob())) as T;
    } catch (e) {
      if (!timedOut && opts.signal?.aborted) throw e;
      throw new ApiError(OFFLINE_WORDS, 0, timedOut ? "timeout" : "offline");
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

// ── Shapes shared with the server ───────────────────────────────────────────────────────────

export type Look = "buddy" | "fox" | "cat" | "dragon" | "robot" | "star" | "frog" | "owl" | "panda";
export type Mood = "happy" | "thinking" | "sleepy" | "resting" | "concerned";
export type Mode = "chat" | "talk" | "oc" | "study" | "art" | "story" | "language";
export interface ModeCtx { subjectId?: number; coursework?: boolean; storyId?: number; lang?: string; topic?: string }

export interface Profile {
  name: string; look: Look; traits: string[]; chatty: number; silly: number; detail: number; voice: string;
  helpWith: { homework: boolean; stories: boolean; music: boolean };
  checkins: { askHowThingsWent: boolean; morningHello: boolean; waterWhileRevising: boolean };
  notifications: { checkins: boolean; reminders: boolean; deskReady: boolean };
  setupDone: boolean;
}
export interface Helpline { name: string; number: string; sub: string; kind: "helpline" | "emergency" }
export interface Me {
  role: "child" | "parent"; name: string; parentLabel: string; profile: Profile; helplines: Helpline[];
  quietHours: { start: string; end: string }; voices: string[]; kinds: string[]; looks: Look[];
  push: { ready: boolean; publicKey: string }; apiReady: boolean; drawingUploads: boolean;
  /** When the 3D Pip's chat picture last changed; null when there isn't one. */
  pipPicture?: number | null;
}
export interface Energy { mode: "full" | "low" | "resting"; percent: number; fullBackAt: number | null; weekResetsAt: number; limitedBy: string | null; windowPercent?: number; weekPercent?: number; windowHours?: number; windowFreesAt?: number | null }
export interface Job { id: number; ts: number; kind: string; title: string; status: "queued" | "working" | "done" | "failed"; progress: number; file_id: string | null; error: string | null }
export interface AppState { energy: Energy; desk: { percent: number; working: Job | null; browsing?: { title: string; by: string | null } | null }; profile: Profile; pipPicture?: number | null }
export interface Message { id: number; ts: number; role: "child" | "companion"; text: string; mode: Mode; meta: string | null }
export interface ReportInfo { level: "now" | "today" | "fyi"; childNotice: string; parentText: string }
export interface Turn {
  child: Message; reply: Message; mood: Mood; energy: Energy; report: ReportInfo | null; openHelp: boolean;
  /** A voice call: the companion said goodbye and hangs up once the reply has been spoken. */
  endCall?: boolean;
  effects: { memories: string[]; jobs: { id: number; title: string; kind: string }[]; characters: number[]; confirms?: GooglePending[]; changes?: number[] };
}
/**
 * Something the companion asked to change about itself (its soul, a memory: waiting for her yes) or
 * changed (how it talks, check-ins: with Undo). Shown as a card under the reply, and on Personality.
 */
export interface PipChange {
  id: number; ts: number; kind: "soul" | "memory" | "personality" | "checkins";
  status: "pending" | "accepted" | "declined" | "expired" | "replaced" | "failed" | "applied" | "undone";
  title: string; lines: { op: "+" | "-" | "~" | "·"; text: string }[]; why: string; result: string; canUndo: boolean;
}
/** A Google change waiting for the child's yes, with a short diff-like summary (+ added, - removed, ~ changed, · note). */
export interface GooglePending { id: number; ts: number; kind: string; title: string; lines: { op: "+" | "-" | "~" | "·"; text: string }[]; status: string; result: string }
export interface Memory { id: number; ts: number; icon: string; text: string; about_date: string | null }
export interface DeskItem {
  id: string; kind: string; title: string; icon: string; format: "html" | "md" | "svg" | "json";
  summary: string; favourite: boolean; characterIds: number[]; version: number; createdAt: number; updatedAt: number;
}
export interface DeskView {
  reachable: boolean; items: DeskItem[]; status: { activity: string; progress: number; updatedAt: number };
  jobs: Job[]; journal: { day: string; text: string }[]; energy: { percent: number; canWork: boolean };
  links: CloudLink[];
}
export interface CloudLink { item_id: string; version: number; provider: string; url: string; extra: string | null }
export interface Sheet {
  name: string; icon: string; look: string; personality: string; powers: string; backstory: string; likes: string; dislikes: string;
  palette: string[]; themeSong: string; relationships: { with: string; kind: string; note: string }[];
  // From the 3D maker (older characters don't have them).
  pronouns?: string; age?: string; species?: string; catchphrase?: string; traits?: OcTrait[];
  model?: Look3D;
  /** A small PNG data URL, made in the browser from the 3D look. */
  thumb?: string;
}
export const OC_TRAITS = ["kind", "brave", "shy", "funny", "clever", "curious", "dreamy", "loyal", "calm", "chaotic", "stubborn", "grumpy", "creative", "sporty"] as const;
export type OcTrait = (typeof OC_TRAITS)[number];
/** What "Describe" gives back. */
export interface Described { look: Look3D; understood: string[]; notYet: string[]; refused: boolean; source: "claude" | "words" }
export interface Character { id: number; ts: number; updated: number; sheet: Sheet }
export interface WorldEntry { id: number; kind: "place" | "event" | "group"; name: string; note: string; when: string }
export interface Transparency {
  reports: { id: number; ts: number; level: string; childNotice: string; parentText: string; status: string }[];
  summaries: { week_start: string; text: string }[];
  toolLog: { id: number; ts: number; connection: string; tool: string; level: string; args: string; result: string; ok: number }[];
  retentionDays: number;
}
