// Kith Connect: one shared Google sign-in for every family's Kith, with no database.
//
// Google only sends a sign-in back to addresses registered in advance, and an app's client secret
// can't ship inside open-source code. So this small helper, at one fixed address, holds the one
// Google client and does exactly two jobs:
//
//   1. Connecting. A family's Kith sends the child to /api/start; we send them to Google; Google
//      comes back to /api/callback; we send the code straight back to that family's Kith. Where to
//      send it travels inside Google's `state`, signed (HMAC) and time-limited, so nothing is stored.
//      The code is useless without the PKCE verifier, which only that family's Kith holds: it then
//      calls /api/token with both, and we add the secret.
//   2. Refreshing. About once an hour each Kith asks /api/refresh for a fresh access token, which
//      needs the secret. We pass it through and keep nothing.
//
// It never stores tokens, never logs them, and never sees anyone's files, chats or calendar: each
// Kith talks to Google directly for everything else. Only these scopes can be asked for.

import crypto from "node:crypto";

export const ALLOWED_SCOPES = [
  "openid", "email", "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
];
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const STATE_MINUTES = 15;

/** Reads and checks the settings (Vercel environment variables). */
export function settings(env = process.env) {
  const s = {
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    stateKey: env.CONNECT_STATE_KEY ?? "",
    publicUrl: (env.CONNECT_PUBLIC_URL ?? "").replace(/\/$/, ""),
    pickerApiKey: env.GOOGLE_PICKER_API_KEY ?? "",
    projectNumber: env.GOOGLE_PROJECT_NUMBER ?? "",
    // Optional: only these Kith addresses may use the helper (comma-separated origins). Empty = any https.
    allowed: (env.CONNECT_ALLOWED_ORIGINS ?? "").split(",").map((x) => x.trim().replace(/\/$/, "")).filter(Boolean),
  };
  const missing = ["clientId", "clientSecret", "stateKey", "publicUrl"].filter((k) => !s[k]);
  if (missing.length) throw new HttpError(503, `Kith Connect isn't set up yet (missing ${missing.join(", ")}).`);
  if (s.stateKey.length < 32) throw new HttpError(503, "CONNECT_STATE_KEY must be at least 32 characters.");
  return s;
}
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const callbackUrl = (s) => `${s.publicUrl}/api/callback`;

// ── Signed state (no database) ─────────────────────────────────────────────────────────────

const b64 = (buf) => Buffer.from(buf).toString("base64url");
function sign(s, payload) {
  const body = b64(JSON.stringify(payload));
  const mac = b64(crypto.createHmac("sha256", s.stateKey).update(body).digest());
  return `${body}.${mac}`;
}
function unsign(s, token, now = Date.now()) {
  const [body, mac] = String(token ?? "").split(".");
  if (!body || !mac) throw new HttpError(400, "That sign-in link isn't right.");
  const want = b64(crypto.createHmac("sha256", s.stateKey).update(body).digest());
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) throw new HttpError(400, "That sign-in link isn't right.");
  const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (typeof p.exp !== "number" || p.exp < now) throw new HttpError(400, "That sign-in took too long. Start again from Kith.");
  return p;
}

/** Only a Kith's own Google callback, over https (or localhost while testing). */
export function checkReturn(s, ret) {
  let u;
  try { u = new URL(ret); } catch { throw new HttpError(400, "Missing or bad return address."); }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new HttpError(400, "Kith needs an https:// address to connect Google.");
  if (u.pathname !== "/auth/google/callback" || u.search || u.hash || u.username || u.password) throw new HttpError(400, "That isn't a Kith return address.");
  if (s.allowed.length && !s.allowed.includes(u.origin)) throw new HttpError(403, "This Kith isn't on Kith Connect's list.");
  return u.toString();
}

// ── 1. Connecting ──────────────────────────────────────────────────────────────────────────

/** /api/start: checks what Kith asked for, then sends the child to Google. */
export function start(s, q, now = Date.now()) {
  const ret = checkReturn(s, q.return);
  const kithState = String(q.state ?? "");
  const challenge = String(q.challenge ?? "");
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(kithState)) throw new HttpError(400, "Missing state.");
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) throw new HttpError(400, "Missing PKCE challenge.");
  const scopes = String(q.scope ?? "").split(/\s+/).filter(Boolean);
  if (!scopes.includes("https://www.googleapis.com/auth/drive.file")) throw new HttpError(400, "Kith always asks for drive.file.");
  const bad = scopes.filter((x) => !ALLOWED_SCOPES.includes(x));
  if (bad.length) throw new HttpError(400, `Kith Connect never asks for ${bad.join(", ")}.`);
  const state = sign(s, { r: ret, s: kithState, exp: now + STATE_MINUTES * 60_000 });
  const p = new URLSearchParams({
    client_id: s.clientId, redirect_uri: callbackUrl(s), response_type: "code", scope: scopes.join(" "),
    access_type: "offline", prompt: "consent", include_granted_scopes: "false", state,
    code_challenge: challenge, code_challenge_method: "S256",
  });
  if (q.login_hint && /^[^\s@]+@[^\s@]+$/.test(String(q.login_hint))) p.set("login_hint", String(q.login_hint));
  return `${AUTH_URL}?${p}`;
}

/** /api/callback: back from Google; sends the code (or the error) to that family's Kith. */
export function callback(s, q, now = Date.now()) {
  const st = unsign(s, q.state, now);
  const ret = new URL(checkReturn(s, st.r));
  ret.searchParams.set("state", st.s);
  if (q.error || !q.code) ret.searchParams.set("error", String(q.error ?? "cancelled").slice(0, 60));
  else ret.searchParams.set("code", String(q.code));
  return ret.toString();
}

/** /api/token: Kith swaps the code (with its PKCE verifier) for tokens; we add the secret. */
export async function token(s, body, f = fetch) {
  const code = String(body?.code ?? "");
  const verifier = String(body?.verifier ?? "");
  if (!code || code.length > 2000) throw new HttpError(400, "Missing code.");
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new HttpError(400, "Missing PKCE verifier.");
  return google(f, { code, code_verifier: verifier, client_id: s.clientId, client_secret: s.clientSecret, redirect_uri: callbackUrl(s), grant_type: "authorization_code" });
}

// ── 2. Refreshing ──────────────────────────────────────────────────────────────────────────

/** /api/refresh: a fresh access token for a Kith's own refresh token. Nothing is kept. */
export async function refresh(s, body, f = fetch) {
  const rt = String(body?.refresh_token ?? "");
  if (!rt || rt.length > 2000) throw new HttpError(400, "Missing refresh token.");
  return google(f, { refresh_token: rt, client_id: s.clientId, client_secret: s.clientSecret, grant_type: "refresh_token" });
}

async function google(f, params) {
  const res = await f(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const j = await res.json().catch(() => ({}));
  // Pass Google's answer straight through (Kith checks scopes and the account itself).
  return { status: res.status, body: j };
}

/** /api/config: what a Kith needs that isn't secret (for the Google Picker in the child's browser). */
export function publicConfig(s) {
  return { clientId: s.clientId, pickerApiKey: s.pickerApiKey, appId: s.projectNumber, scopes: ALLOWED_SCOPES };
}
