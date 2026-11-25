// Google for the child's OWN Google account.
//
// Least privilege: the only Drive scope is `drive.file` (files Kith created, or files the child picks
// with the Google Picker), plus `openid email` to show which account is connected. When the parent
// switches them on: `calendar.events` (her primary calendar) and `tasks` (a Homework list). Kith never
// asks for Gmail, Contacts, Photos, Classroom or the rest of Drive, and refuses a sign-in that grants more.
//
// Files: Kith creates files and folders, and (with the parent's "editing" switch) edits Docs, Sheets
// and Slides she picked or Kith made, through the Docs, Sheets and Slides APIs (batchUpdate), so
// Google's version history keeps every change. Every edit is confirmed by her first (googleWork.ts).
// It never deletes, trashes, moves or re-shares files. The only share it ever makes is the Kith
// folder, view-only, to the parent's Google account (optional). Every read and write is logged.

import crypto from "node:crypto";
import type { DB } from "../db.js";
import { get, run } from "../db.js";
import { config } from "../config.js";

export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.file"];
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
export interface GoogleFeatures { edit: boolean; calendar: boolean; tasks: boolean }
/** What to ask Google for: drive.file always; Calendar and Tasks only if the parent switched them on. */
export function scopesFor(f: Partial<GoogleFeatures> = {}): string[] {
  return [...SCOPES, ...(f.calendar ? [CALENDAR_SCOPE] : []), ...(f.tasks ? [TASKS_SCOPE] : [])];
}
export const FOLDERS = ["Stories", "Revision", "Presentations", "Games & artifacts", "OCs"] as const;
export type Folder = (typeof FOLDERS)[number];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";
const SLIDES = "https://slides.googleapis.com/v1/presentations";

export const MIME = {
  folder: "application/vnd.google-apps.folder",
  doc: "application/vnd.google-apps.document",
  sheet: "application/vnd.google-apps.spreadsheet",
  slides: "application/vnd.google-apps.presentation",
};

// ── Token encryption (AES-256-GCM with KITH_SECRET_KEY) ─────────────────────────────────────

function key(): Buffer {
  const hex = process.env.KITH_SECRET_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("KITH_SECRET_KEY must be 64 hex characters (openssl rand -hex 32).");
  return Buffer.from(hex, "hex");
}
export function seal(plain: string, k = key()): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
export function unseal(sealed: string, k = key()): string {
  const [iv, tag, enc] = sealed.split(".").map((s) => Buffer.from(s, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// ── Stored state ────────────────────────────────────────────────────────────────────────────

export interface GoogleState {
  email: string;
  refresh: string;                 // sealed refresh token
  connectedAt: number;
  folders: Partial<Record<Folder | "root", string>>;
  sharedWith: string;              // parent email the Kith folder is shared with ("" if none)
  scopes?: string[];               // what Google granted (older connections: drive.file only)
}

export function loadGoogle(db: DB): GoogleState | null {
  const row = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'google'");
  return row ? (JSON.parse(row.json) as GoogleState) : null;
}
export function saveGoogle(db: DB, s: GoogleState | null) {
  if (!s) run(db, "DELETE FROM settings WHERE key = 'google'");
  else run(db, "INSERT INTO settings(key, json) VALUES('google', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(s));
}

/** Your own Google client (set in .env), or the shared Kith Connect helper. */
export const ownClient = () => Boolean(config.google.clientId && config.google.clientSecret);
export const viaConnect = () => !ownClient() && /^https:\/\/|^http:\/\/localhost[:/]/.test(config.google.connectUrl);
export const googleConfigured = () => ownClient() || viaConnect();

/** What Kith Connect shares publicly (client id and the Picker key; never a secret). Cached for an hour. */
let connectCfg: { at: number; v: { clientId: string; pickerApiKey: string; appId: string } } | null = null;
export async function connectConfig(f: Fetch = fetch) {
  if (connectCfg && Date.now() - connectCfg.at < 3_600_000) return connectCfg.v;
  const r = await f(`${config.google.connectUrl}/api/config`);
  if (!r.ok) throw new Error("Kith Connect didn't answer.");
  const v = (await r.json()) as { clientId: string; pickerApiKey: string; appId: string };
  connectCfg = { at: Date.now(), v };
  return v;
}
export function resetConnectCacheForTests() { connectCfg = null; }

// ── OAuth (child connects their own account once) ───────────────────────────────────────────

export function redirectUri() {
  return `${config.publicUrl}/auth/google/callback`;
}

export function authUrl(state: string, challenge: string, scopes: string[] = SCOPES): string {
  if (viaConnect()) {
    // The shared helper sends her to Google and hands the code back to this Kith's own callback.
    const c = new URLSearchParams({ return: redirectUri(), state, challenge, scope: scopes.join(" ") });
    if (config.google.accountHint) c.set("login_hint", config.google.accountHint);
    return `${config.google.connectUrl}/api/start?${c}`;
  }
  const q = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (config.google.accountHint) q.set("login_hint", config.google.accountHint);
  return `${AUTH_URL}?${q}`;
}

type Fetch = typeof fetch;

export async function exchangeCode(code: string, verifier: string, f: Fetch = fetch, requested: string[] = SCOPES) {
  const res = viaConnect()
    // Kith Connect adds the secret; only this Kith has the PKCE verifier, so the code is no use to anyone else.
    ? await f(`${config.google.connectUrl}/api/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, verifier }) })
    : await f(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, code_verifier: verifier, client_id: config.google.clientId, client_secret: config.google.clientSecret,
        redirect_uri: redirectUri(), grant_type: "authorization_code",
      }),
    });
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; scope?: string; error?: string };
  if (!res.ok || !j.refresh_token) throw new Error(j.error ?? "Google didn't give Kith offline access.");
  const granted = (j.scope ?? "").split(" ");
  const extra = granted.filter((s) => !requested.includes(s) && s !== "https://www.googleapis.com/auth/userinfo.email");
  if (!granted.includes("https://www.googleapis.com/auth/drive.file")) throw new Error("Drive access wasn't granted.");
  if (extra.length) throw new Error(`Google granted more than Kith asked for (${extra.join(", ")}); not keeping it.`);
  // The id_token came straight from Google's token endpoint over TLS, so its claims can be read.
  const claims = JSON.parse(Buffer.from((j.id_token ?? "..").split(".")[1] ?? "", "base64url").toString("utf8") || "{}") as { email?: string; email_verified?: boolean };
  if (!claims.email || !claims.email_verified) throw new Error("Couldn't confirm which Google account this is.");
  const expected = config.google.expectedEmail.toLowerCase();
  if (expected && claims.email.toLowerCase() !== expected) throw new Error(`Please connect ${expected}, not ${claims.email}.`);
  return { email: claims.email, refresh: j.refresh_token, access: j.access_token!, expiresIn: j.expires_in ?? 3600, scopes: granted };
}

export async function revoke(refresh: string, f: Fetch = fetch) {
  await f(`${REVOKE_URL}?token=${encodeURIComponent(refresh)}`, { method: "POST" }).catch(() => undefined);
}

// ── Drive client ────────────────────────────────────────────────────────────────────────────

export interface WriteLog { (tool: string, args: string, result: string, ok: boolean): void }

export class GoogleDrive {
  private access: { token: string; expires: number } | null = null;

  constructor(private db: DB, private log: WriteLog, private f: Fetch = fetch) {}

  state() { return loadGoogle(this.db); }

  private async token(): Promise<string> {
    if (this.access && this.access.expires > Date.now() + 60_000) return this.access.token;
    const s = this.state();
    if (!s) throw new Error("Google isn't connected.");
    const res = viaConnect()
      ? await this.f(`${config.google.connectUrl}/api/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: unseal(s.refresh) }) })
      : await this.f(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ refresh_token: unseal(s.refresh), client_id: config.google.clientId, client_secret: config.google.clientSecret, grant_type: "refresh_token" }),
      });
    const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !j.access_token) {
      throw new Error(j.error === "invalid_grant" ? "Google needs connecting again (the sign-in expired or was removed)." : `Google said ${j.error ?? res.status}`);
    }
    this.access = { token: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  /** A short-lived token for the Google Picker in the child's browser (drive.file only). */
  async pickerToken() { return this.token(); }

  /** Any Google API call, with the guard below. Used by googleWork.ts too. */
  async call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const method = (init.method ?? "GET").toUpperCase();
    // Belt and braces: Kith never deletes, overwrites, moves or re-shares files. The only PATCH or
    // DELETE it ever sends is to a calendar event Kith made (checked by the caller first), or to
    // tick off a task; file edits are POSTed batchUpdates, which keep Google's version history.
    if (!allowedCall(method, url)) throw new Error("Kith never changes or deletes files in Google Drive.");
    const res = await this.f(url, { ...init, headers: { Authorization: `Bearer ${await this.token()}`, ...(init.headers ?? {}) } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Google answered ${res.status}: ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  private async createFolder(name: string, parent?: string): Promise<string> {
    const r = await this.call<{ id: string }>(`${DRIVE}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: MIME.folder, ...(parent ? { parents: [parent] } : {}) }),
    });
    this.log("create_folder", name, r.id, true);
    return r.id;
  }

  /** The Kith folder and its subfolders, created once (only folders Kith made are ever used). */
  async folder(name: Folder): Promise<string> {
    const s = this.state();
    if (!s) throw new Error("Google isn't connected.");
    if (!s.folders.root) {
      s.folders.root = await this.createFolder("Kith");
      saveGoogle(this.db, s);
    }
    if (!s.folders[name]) {
      s.folders[name] = await this.createFolder(name, s.folders.root);
      saveGoogle(this.db, s);
    }
    return s.folders[name]!;
  }

  /** Shares the Kith folder view-only with the parent's Google account, once. No other sharing, ever. */
  async shareWithParent(email: string) {
    const s = this.state();
    if (!s || !email || s.sharedWith.toLowerCase() === email.toLowerCase()) return;
    await this.folder("Stories");
    const root = this.state()!.folders.root!;
    await this.call(`${DRIVE}/files/${root}/permissions?sendNotificationEmail=false&fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "reader", type: "user", emailAddress: email }),
    });
    const now = this.state()!;
    now.sharedWith = email;
    saveGoogle(this.db, now);
    this.log("share_kith_folder", `view-only with ${email}`, "shared", true);
  }

  /** Uploads a new file (optionally converting it to a Google Doc or Sheet). Never replaces anything. */
  async upload(opts: { name: string; folder: Folder; body: string; bodyType: string; convertTo?: string }): Promise<{ id: string; url: string }> {
    const parent = await this.folder(opts.folder);
    const boundary = `kith${crypto.randomBytes(8).toString("hex")}`;
    const meta = { name: opts.name, parents: [parent], ...(opts.convertTo ? { mimeType: opts.convertTo } : {}) };
    const body = [
      `--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", JSON.stringify(meta),
      `--${boundary}`, `Content-Type: ${opts.bodyType}; charset=UTF-8`, "", opts.body, `--${boundary}--`, "",
    ].join("\r\n");
    const r = await this.call<{ id: string; webViewLink: string }>(UPLOAD, {
      method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    });
    this.log("create_file", `${opts.folder}/${opts.name}`, r.webViewLink ?? r.id, true);
    rememberFile(this.db, r.id, opts.name, opts.convertTo ?? opts.bodyType, "created");
    return { id: r.id, url: r.webViewLink ?? `https://drive.google.com/file/d/${r.id}/view` };
  }

  /** A new Slides presentation in Kith/Presentations: created empty by Drive, then filled with the Slides API. */
  async slides(title: string, slides: { title: string; body: string }[]): Promise<{ id: string; url: string }> {
    const parent = await this.folder("Presentations");
    const created = await this.call<{ id: string }>(`${DRIVE}/files?fields=id`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: title, mimeType: MIME.slides, parents: [parent] }),
    });
    const id = created.id;
    const requests: unknown[] = [];
    slides.slice(0, 30).forEach((sl, i) => {
      const sid = `kith_s${i}`, t = `kith_t${i}`, b = `kith_b${i}`;
      requests.push(
        { createSlide: { objectId: sid, slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" }, placeholderIdMappings: [
          { layoutPlaceholder: { type: "TITLE" }, objectId: t }, { layoutPlaceholder: { type: "BODY" }, objectId: b }] } },
        { insertText: { objectId: t, text: sl.title.slice(0, 200) || " " } },
        { insertText: { objectId: b, text: sl.body.slice(0, 2000) || " " } },
      );
    });
    if (requests.length) {
      await this.call(`${SLIDES}/${id}:batchUpdate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests }) });
    }
    const url = `https://docs.google.com/presentation/d/${id}/edit`;
    this.log("create_slides", `Presentations/${title}`, url, true);
    rememberFile(this.db, id, title, MIME.slides, "created");
    return { id, url };
  }

  /** Reads a Google Doc the child picked with the Picker (drive.file grants access to just that file). */
  async readPickedDoc(fileId: string): Promise<string> {
    if (!/^[a-zA-Z0-9_-]{10,100}$/.test(fileId)) throw new Error("bad file id");
    const res = await this.f(`${DRIVE}/files/${fileId}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${await this.token()}` } });
    if (!res.ok) throw new Error(`Couldn't read that document (${res.status}).`);
    this.log("read_picked_doc", fileId, "read", true);
    return (await res.text()).slice(0, 100_000);
  }
}

/** The only non-GET/POST calls Kith may make: Calendar events and Tasks (never Drive, Docs, Sheets or Slides). */
export function allowedCall(method: string, url: string): boolean {
  if (method === "GET" || method === "POST") return !/\/permissions\b/.test(url) || /\/files\/[^/]+\/permissions\?sendNotificationEmail=false/.test(url);
  if (method === "PATCH" || method === "DELETE") {
    return /^https:\/\/www\.googleapis\.com\/calendar\/v3\/calendars\/primary\/events\/[A-Za-z0-9_-]+(\?|$)/.test(url)
      || (method === "PATCH" && /^https:\/\/tasks\.googleapis\.com\/tasks\/v1\/lists\/[A-Za-z0-9_-]+\/tasks\/[A-Za-z0-9_-]+$/.test(url));
  }
  return false;
}

/** Files Kith may read and (with the switch on) edit: ones it made, and ones she picked. */
export interface KnownFile { id: string; name: string; mime: string; source: "created" | "picked"; coursework: number; ts: number }
export function rememberFile(db: DB, id: string, name: string, mime: string, source: "created" | "picked") {
  run(db, `INSERT INTO google_files(id, name, mime, source, coursework, ts) VALUES (?,?,?,?,0,?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, mime = excluded.mime`, id, name.slice(0, 200), mime, source, Date.now());
}
export function knownFile(db: DB, id: string): KnownFile | undefined {
  return get<KnownFile>(db, "SELECT * FROM google_files WHERE id = ?", id);
}

// ── Desk item → Google file ─────────────────────────────────────────────────────────────────

export function folderFor(kind: string, characterIds: number[] = []): Folder {
  if (characterIds.length || kind === "character" || kind === "oc") return "OCs";
  if (["story", "adventure", "comic", "shared-story"].includes(kind)) return "Stories";
  if (["notes", "flashcards", "quiz", "timer", "timeline", "revision-plan", "practice"].includes(kind)) return "Revision";
  if (["slides", "poster"].includes(kind)) return "Presentations";
  return "Games & artifacts";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Markdown → simple HTML for Google Docs import (headings, lists, bold, italics, paragraphs). */
export function markdownToHtml(md: string): string {
  const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(\*|_)([^*_]+)\1/g, "<i>$2</i>");
  const blocks = md.replace(/\r/g, "").split(/\n{2,}/).map((b) => {
    const h = /^(#{1,3})\s+(.*)$/.exec(b);
    if (h) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
    if (/^\s*([-*]|\d+\.)\s+/.test(b)) {
      return `<ul>${b.split("\n").filter(Boolean).map((l) => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>`).join("")}</ul>`;
    }
    return `<p>${b.split("\n").map(inline).join("<br>")}</p>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${blocks.join("\n")}</body></html>`;
}

export function rowsToCsv(rows: string[][]): string {
  const cell = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return rows.map((r) => r.map((c) => cell(String(c ?? ""))).join(",")).join("\n");
}

export interface MirrorInput {
  kind: string; title: string; format: "html" | "md" | "svg" | "json"; content: string; version: number;
  characterIds?: number[]; rows?: string[][]; slides?: { title: string; body: string }[];
}

/** Saves a desk item into the child's Drive in the right shape. Returns the main link. */
export async function saveToDrive(drive: GoogleDrive, it: MirrorInput): Promise<{ url: string; extra?: string }> {
  const folder = folderFor(it.kind, it.characterIds);
  const name = it.version > 1 ? `${it.title} (v${it.version})` : it.title;
  if (it.kind === "slides" && it.slides?.length) {
    const s = await drive.slides(name, it.slides);
    return { url: s.url };
  }
  if (it.format === "md") {
    return { url: (await drive.upload({ name, folder, body: markdownToHtml(it.content), bodyType: "text/html", convertTo: MIME.doc })).url };
  }
  if (it.format === "json") {
    return { url: (await drive.upload({ name: `${name}.json`, folder, body: it.content, bodyType: "application/json" })).url };
  }
  // Interactive things and drawings: the file itself, plus a Sheet for flashcards/quizzes when there are rows.
  const main = await drive.upload({ name: `${name}.${it.format}`, folder, body: it.content, bodyType: it.format === "svg" ? "image/svg+xml" : "text/html" });
  if (it.rows?.length && ["flashcards", "quiz", "timeline"].includes(it.kind)) {
    const sheet = await drive.upload({ name: `${name} (cards)`, folder, body: rowsToCsv(it.rows), bodyType: "text/csv", convertTo: MIME.sheet });
    return { url: main.url, extra: sheet.url };
  }
  return { url: main.url };
}
