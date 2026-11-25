// Small fetch wrapper. Same-origin only; the session cookie is HttpOnly. Changes carry the
// X-Kith header, which the server requires (it blocks cross-site form posts).

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const BASE = (import.meta.env.VITE_KITH_API as string | undefined) ?? "";

export async function api<T>(path: string, opts: { method?: string; body?: unknown; raw?: BodyInit; type?: string } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.raw ? "POST" : "GET");
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["X-Kith"] = "1";
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.raw) headers["Content-Type"] = opts.type ?? "application/octet-stream";
  const res = await fetch(BASE + path, {
    method,
    headers,
    credentials: "include",
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(j.error ?? `Something went wrong (${res.status}).`, res.status);
  }
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("application/json") ? res.json() : res.blob()) as Promise<T>;
}

// ── Shapes shared with the server ───────────────────────────────────────────────────────────

export type Look = "buddy" | "fox" | "cat" | "dragon" | "robot" | "star" | "frog" | "owl" | "panda";
export type Mood = "happy" | "thinking" | "sleepy" | "resting" | "concerned";
export type Mode = "chat" | "talk" | "oc" | "study" | "art" | "story";
export interface ModeCtx { subjectId?: number; coursework?: boolean; storyId?: number }

export interface Profile {
  name: string; look: Look; traits: string[]; chatty: number; silly: number; detail: number; voice: string;
  helpWith: { homework: boolean; stories: boolean; music: boolean };
  checkins: { askHowThingsWent: boolean; morningHello: boolean; waterWhileRevising: boolean };
  setupDone: boolean;
}
export interface Helpline { name: string; number: string; sub: string; kind: "helpline" | "emergency" }
export interface Me {
  role: "child" | "parent"; name: string; parentLabel: string; profile: Profile; helplines: Helpline[];
  quietHours: { start: string; end: string }; voices: string[]; kinds: string[]; looks: Look[];
  push: { ready: boolean; publicKey: string }; apiReady: boolean; drawingUploads: boolean;
}
export interface Energy { mode: "full" | "low" | "resting"; percent: number; fullBackAt: number | null; weekResetsAt: number; limitedBy: string | null }
export interface Job { id: number; ts: number; kind: string; title: string; status: "queued" | "working" | "done" | "failed"; progress: number; file_id: string | null; error: string | null }
export interface AppState { energy: Energy; desk: { percent: number; working: Job | null }; profile: Profile }
export interface Message { id: number; ts: number; role: "child" | "companion"; text: string; mode: Mode; meta: string | null }
export interface ReportInfo { level: "now" | "today" | "fyi"; childNotice: string; parentText: string }
export interface Turn {
  child: Message; reply: Message; mood: Mood; energy: Energy; report: ReportInfo | null; openHelp: boolean;
  effects: { memories: string[]; jobs: { id: number; title: string; kind: string }[]; characters: number[] };
}
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
}
export interface Character { id: number; ts: number; updated: number; sheet: Sheet }
export interface WorldEntry { id: number; kind: "place" | "event" | "group"; name: string; note: string; when: string }
export interface Transparency {
  reports: { id: number; ts: number; level: string; childNotice: string; parentText: string; status: string }[];
  summaries: { week_start: string; text: string }[];
  toolLog: { id: number; ts: number; connection: string; tool: string; level: string; args: string; result: string; ok: number }[];
  retentionDays: number;
}
