// Sign-in through an OpenID Connect provider (e.g. Pocket ID). Only configured people get in:
// the child, and one or more parents. Authorization code flow with PKCE, state and nonce.

import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as oidc from "openid-client";
import type { DB } from "./db.js";
import { all, get, run } from "./db.js";
import { config } from "./config.js";

export type Role = "child" | "parent";
export interface SessionUser { sid: string; sub: string; role: Role; name: string }

const COOKIE = "kith_sid";
const DAY = 86_400_000;
// Grown-up sessions are shorter: the parent view can change settings and see reports.
export const SESSION_DAYS: Record<Role, number> = { child: 30, parent: 7 };

declare module "fastify" {
  interface FastifyRequest { user?: SessionUser }
}

/** Matches a signed-in identity against the configured people. */
export function roleFor(
  ids: { sub: string; email?: string; emailVerified?: boolean; groups?: string[] },
  people = config.people,
  groups = { child: config.oidc.childGroup, parent: config.oidc.parentGroup },
): Role | null {
  const cands = [ids.sub.toLowerCase()];
  if (ids.email && ids.emailVerified) cands.push(ids.email.toLowerCase());
  const has = (list: string[]) => list.some((x) => cands.includes(x.toLowerCase()));
  const inGroup = (g: string) => Boolean(g) && (ids.groups ?? []).some((x) => x.toLowerCase() === g.toLowerCase());
  if (has(people.parents) || inGroup(groups.parent)) return "parent";
  if (has(people.child) || inGroup(groups.child)) return "child";
  return null;
}

// ── Each app lets in only its own person ───────────────────────────────────────────────────
// Kith (the child's app) and Kith Parent can say which one they are: ?app=child|parent on
// /auth/login, and the X-Kith-App header on API calls. A parent is never let into the child app,
// even if they're also in the child's group, so the child app can never show a parent the child's
// chats. Without a hint, everything works as before.
export type AppHint = "child" | "parent";
export const APP_HINT = /^(child|parent)$/;

/** Which role this person gets in this app, or why not. */
export function appRole(
  ids: { sub: string; email?: string; emailVerified?: boolean; groups?: string[] },
  app: AppHint | null,
  people = config.people,
  groups = { child: config.oidc.childGroup, parent: config.oidc.parentGroup },
): { role: Role } | { error: "not-allowed" | "use-parent-app" | "use-child-app" } {
  if (!app) { const role = roleFor(ids, people, groups); return role ? { role } : { error: "not-allowed" }; }
  const isParent = roleFor(ids, { ...people, child: [] }, { ...groups, child: "" }) === "parent";
  const isChild = roleFor(ids, { ...people, parents: [] }, { ...groups, parent: "" }) === "child";
  if (app === "parent") return isParent ? { role: "parent" } : isChild ? { error: "use-child-app" } : { error: "not-allowed" };
  return isParent ? { error: "use-parent-app" } : isChild ? { role: "child" } : { error: "not-allowed" };
}

/** The friendly words for the wrong app (the child's name comes from Kith's own settings). */
/** No names here: the same words go on the sign-in page, in the handoff error and in the 403. */
export function wrongAppText(app: AppHint): string {
  return app === "child" ? "This is the kids’ Kith. Grown-ups use Kith Parent." : "This is the grown-ups’ app. Kids use Kith.";
}

export function firstName(claims: { given_name?: unknown; name?: unknown }): string {
  const n = (typeof claims.given_name === "string" && claims.given_name) || (typeof claims.name === "string" && claims.name.split(" ")[0]) || "";
  return n.slice(0, 30);
}

export function createSession(db: DB, u: { sub: string; role: Role; name: string }): string {
  const sid = crypto.randomBytes(32).toString("base64url");
  run(db, "INSERT INTO sessions(id, sub, role, name, created, expires) VALUES (?,?,?,?,?,?)", sid, u.sub, u.role, u.name, Date.now(), Date.now() + SESSION_DAYS[u.role] * DAY);
  if (u.role === "child" && u.name) {
    run(db, "INSERT INTO settings(key, json) VALUES('child', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify({ name: u.name }));
  }
  return sid;
}

export function sessionFor(db: DB, sid: string | undefined): SessionUser | null {
  if (!sid) return null;
  const row = get<{ id: string; sub: string; role: Role; name: string; expires: number }>(db, "SELECT id, sub, role, name, expires FROM sessions WHERE id = ?", sid);
  if (!row || row.expires < Date.now()) return null;
  // Access can be removed by taking someone out of the config.
  const stillAllowed = row.sub.startsWith("dev:") ? config.devLogin : stillListedByEmail(row.sub, row.role);
  if (!stillAllowed) return null;
  return { sid: row.id, sub: row.sub, role: row.role, name: row.name };
}

// Sessions store "sub|email|group" so removing someone from the config ends their session. (A group
// can't be re-checked without signing in again, so a group sign-in lasts until the session ends,
// as long as that group is still the configured one.)
function stillListedByEmail(stored: string, role: Role) {
  const [sub, email, group] = stored.split("|");
  return roleFor({ sub, email, emailVerified: Boolean(email), groups: group ? [group] : [] }) === role;
}

export function childName(db: DB): string {
  if (config.people.childName) return config.people.childName;
  const row = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'child'");
  return row ? (JSON.parse(row.json).name as string) : "";
}

function setCookie(reply: FastifyReply, sid: string, role: Role) {
  reply.setCookie(COOKIE, sid, {
    path: "/", httpOnly: true, sameSite: "lax", secure: config.publicUrl.startsWith("https://"), maxAge: SESSION_DAYS[role] * 86_400,
  });
}

// ── Sign-in from an installed web app (Dock or Home Screen) ─────────────────────────────────
// The provider's page is outside the app, so the system opens it in a separate window, and that
// window may not share cookies with the app. So the app starts a handoff first:
//   1. POST /auth/handoff/start {app} → {id, secret}. Only the SHA-256 of each is stored.
//   2. GET /auth/login?handoff=<id>&json=1 → the provider's address (once per handoff).
//   3. GET /auth/handoff/<id> with the X-Kith-Handoff-Secret header, until it's done.
// After the callback the new session is tied to that handoff, for one use within 2 minutes; the poll
// sets the cookie in the app's own context. The id travels in URLs (and so can end up in logs or
// history); the secret never does, so knowing an id isn't enough to collect someone's session. No
// session id ever goes in a URL.
export const HANDOFF_ID = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url
export const HANDOFF_SECRET_HEADER = "x-kith-handoff-secret";
const HANDOFF_MS = 2 * 60_000;
// A started handoff can wait as long as the sign-in state it leads to (the app prepares it early).
const HANDOFF_START_MS = 15 * 60_000;
const hashId = (id: string) => crypto.createHash("sha256").update(id).digest("hex");
const sameHash = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The started handoffs (kept here so auth owns its own table). */
export function ensureAuthTables(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS auth_handoff_start (
    id_hash TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, app TEXT, created INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
  )`);
}

/** Starts a handoff for an installed app: a random id (goes in URLs) and secret (only in a header). */
export function startHandoff(db: DB, app: AppHint | null): { id: string; secret: string } {
  const id = crypto.randomBytes(32).toString("base64url");
  const secret = crypto.randomBytes(32).toString("base64url");
  run(db, "INSERT INTO auth_handoff_start(id_hash, secret_hash, app, created) VALUES (?,?,?,?)", hashId(id), hashId(secret), app, Date.now());
  return { id, secret };
}

function finishHandoff(db: DB, handoff: string | null | undefined, result: { sid: string; role: Role } | { error: string }) {
  if (!handoff) return;
  run(db, "INSERT OR REPLACE INTO auth_handoff(id_hash, sid, role, error, created) VALUES (?,?,?,?,?)",
    handoff, "sid" in result ? result.sid : null, "sid" in result ? result.role : null, "error" in result ? result.error : null, Date.now());
}

/** Clears handoffs that were never collected. */
export function expireHandoffs(db: DB, now = Date.now()) {
  run(db, "DELETE FROM auth_handoff WHERE created < ?", now - HANDOFF_MS);
  run(db, "DELETE FROM auth_handoff_start WHERE created < ?", now - HANDOFF_START_MS);
}

// Kept in memory only, to hint the provider at sign-out.
const idTokens = new Map<string, string>();

let oidcConfig: Promise<oidc.Configuration> | null = null;
function discover() {
  if (!oidcConfig) {
    const issuer = new URL(config.oidc.issuer);
    const opts = issuer.protocol === "http:" ? { execute: [oidc.allowInsecureRequests] } : undefined;
    oidcConfig = oidc
      .discovery(
        issuer, config.oidc.clientId, config.oidc.clientSecret || undefined,
        !config.oidc.clientSecret ? oidc.None() : config.oidc.tokenAuth === "post" ? oidc.ClientSecretPost(config.oidc.clientSecret) : oidc.ClientSecretBasic(config.oidc.clientSecret),
        opts,
      )
      .catch((err) => { oidcConfig = null; throw err; });
  }
  return oidcConfig;
}

/** For tests: forget the cached provider metadata. */
export function resetOidcForTests() { oidcConfig = null; }

export function registerAuth(app: FastifyInstance, db: DB) {
  ensureAuthTables(db);
  const redirectUri = `${config.publicUrl}/auth/callback`;

  app.get("/auth/login", async (req, reply) => {
    if (!config.oidc.issuer) return reply.code(503).send({ error: "Sign-in isn't set up yet (KITH_OIDC_ISSUER)." });
    const handoffId = (req.query as { handoff?: string }).handoff;
    if (handoffId !== undefined && !HANDOFF_ID.test(handoffId)) return reply.code(400).send({ error: "bad handoff" });
    let appHint = (req.query as { app?: string }).app;
    if (appHint !== undefined && !APP_HINT.test(appHint)) return reply.code(400).send({ error: "bad app" });
    if (handoffId !== undefined) {
      // Only a handoff the app started (POST /auth/handoff/start), once, for the app it started for.
      expireHandoffs(db);
      const started = get<{ app: AppHint | null; used: number }>(db, "SELECT app, used FROM auth_handoff_start WHERE id_hash = ?", hashId(handoffId));
      if (!started || started.used) return reply.code(400).send({ error: "unknown handoff" });
      if (appHint !== undefined && started.app && appHint !== started.app) return reply.code(400).send({ error: "bad app" });
      appHint = started.app ?? appHint;
      run(db, "UPDATE auth_handoff_start SET used = 1 WHERE id_hash = ?", hashId(handoffId));
    }
    const cfg = await discover();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    run(db, "INSERT INTO oidc_state(state, verifier, nonce, created, handoff, app) VALUES (?,?,?,?,?,?)", state, verifier, nonce, Date.now(), handoffId ? hashId(handoffId) : null, appHint ?? null);
    const url = oidc.buildAuthorizationUrl(cfg, {
      redirect_uri: redirectUri,
      scope: config.oidc.childGroup || config.oidc.parentGroup ? "openid email profile groups" : "openid email profile",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    // An installed web app asks for the address ahead of time (json=1) so the click can open it
    // straight away in the browser: Safari blocks windows opened after a wait, and only a page
    // outside the app (the provider's) opens in the browser rather than inside the app.
    if (handoffId && (req.query as { json?: string }).json === "1") return { url: url.href };
    return reply.redirect(url.href);
  });

  app.get("/auth/callback", async (req, reply) => {
    const q = req.query as { state?: string; error?: string };
    if (q.error) return reply.redirect("/?signin=failed");
    const row = q.state ? get<{ verifier: string; nonce: string; created: number; handoff: string | null; app: AppHint | null }>(db, "SELECT verifier, nonce, created, handoff, app FROM oidc_state WHERE state = ?", q.state) : undefined;
    if (!row || Date.now() - row.created > 15 * 60_000) return reply.redirect("/?signin=expired");
    run(db, "DELETE FROM oidc_state WHERE state = ?", q.state!);
    // In a sign-in window opened by an installed app, finish on a "you can close this" page.
    const done = (to: string, result: { sid: string; role: Role } | { error: string }) => {
      if (!row.handoff) return reply.redirect(to);
      finishHandoff(db, row.handoff, result);
      return reply.redirect("error" in result ? `/?signin=done-${result.error}` : "/?signin=done");
    };
    try {
      const cfg = await discover();
      const current = new URL(req.url, config.publicUrl);
      const tokens = await oidc.authorizationCodeGrant(cfg, current, {
        pkceCodeVerifier: row.verifier, expectedState: q.state, expectedNonce: row.nonce, idTokenExpected: true,
      });
      const claims = tokens.claims()!;
      const email = typeof claims.email === "string" ? claims.email : undefined;
      const verified = claims.email_verified === true || config.oidc.trustEmail;
      const groups = Array.isArray(claims.groups) ? (claims.groups as unknown[]).filter((g): g is string => typeof g === "string") : [];
      const decided = appRole({ sub: claims.sub, email, emailVerified: verified, groups }, row.app);
      if ("error" in decided) {
        // No session is made. The app shows a friendly page (it knows which app it is).
        return done(`/?signin=${decided.error}${row.app ? `&app=${row.app}` : ""}`, { error: decided.error });
      }
      const role = decided.role;
      const viaGroup = role === "parent" ? config.oidc.parentGroup : config.oidc.childGroup;
      const group = viaGroup && groups.some((g) => g.toLowerCase() === viaGroup.toLowerCase()) ? viaGroup : "";
      if (tokens.id_token) idTokens.set(claims.sub, tokens.id_token);
      const sid = createSession(db, { sub: `${claims.sub}|${verified && email ? email : ""}|${group}`, role, name: firstName(claims as { given_name?: unknown; name?: unknown }) });
      setCookie(reply, sid, role);
      return done(role === "parent" ? "/parent" : "/", { sid, role });
    } catch (err) {
      req.log.warn({ err }, "sign-in failed");
      return done("/?signin=failed", { error: "failed" });
    }
  });

  // The installed app starts a handoff here before sign-in. It needs no session (it's for signing in).
  app.post("/auth/handoff/start", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const app = (req.body as { app?: unknown } | undefined)?.app;
    if (app !== undefined && app !== null && (typeof app !== "string" || !APP_HINT.test(app))) return reply.code(400).send({ error: "bad app" });
    expireHandoffs(db);
    return { ...startHandoff(db, (app as AppHint | undefined) ?? null), expiresIn: HANDOFF_START_MS / 1000 };
  });

  // The installed app polls here, with the handoff's secret. Single use: the first successful poll
  // sets the cookie and the handoff is gone.
  app.get("/auth/handoff/:id", { config: { rateLimit: { max: 90, timeWindow: "1 minute" } } }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!HANDOFF_ID.test(id)) return reply.code(400).send({ error: "bad handoff" });
    expireHandoffs(db);
    const h = hashId(id);
    const secret = req.headers[HANDOFF_SECRET_HEADER];
    const started = get<{ secret_hash: string }>(db, "SELECT secret_hash FROM auth_handoff_start WHERE id_hash = ?", h);
    if (!started) return reply.code(410).send({ error: "expired" });
    if (typeof secret !== "string" || !sameHash(hashId(secret), started.secret_hash)) return reply.code(403).send({ error: "bad handoff secret" });
    const row = get<{ sid: string | null; role: Role | null; error: string | null }>(db, "SELECT sid, role, error FROM auth_handoff WHERE id_hash = ?", h);
    if (!row) return { pending: true };
    run(db, "DELETE FROM auth_handoff WHERE id_hash = ?", h);
    run(db, "DELETE FROM auth_handoff_start WHERE id_hash = ?", h);
    if (row.error || !row.sid || !row.role) return reply.code(403).send({ error: row.error ?? "failed" });
    if (!get(db, "SELECT id FROM sessions WHERE id = ?", row.sid)) return reply.code(410).send({ error: "expired" });
    setCookie(reply, row.sid, row.role);
    return { ok: true, redirect: row.role === "parent" ? "/parent" : "/" };
  });

  // Signs out of Kith, and (if the provider supports it, as Pocket ID does) out of the provider too:
  // the app sends the browser to `redirect`.
  app.post("/auth/logout", async (req, reply) => {
    const sid = req.cookies[COOKIE];
    const row = sid ? get<{ sub: string }>(db, "SELECT sub FROM sessions WHERE id = ?", sid) : undefined;
    if (sid) run(db, "DELETE FROM sessions WHERE id = ?", sid);
    reply.clearCookie(COOKIE, { path: "/" });
    let redirect: string | null = null;
    if (config.oidc.issuer && row && !row.sub.startsWith("dev:")) {
      try {
        const cfg = await discover();
        if (cfg.serverMetadata().end_session_endpoint) {
          const sub = row.sub.split("|")[0];
          const hint = idTokens.get(sub);
          idTokens.delete(sub);
          redirect = oidc.buildEndSessionUrl(cfg, { post_logout_redirect_uri: `${config.publicUrl}/`, ...(hint ? { id_token_hint: hint } : {}) }).href;
        }
      } catch { /* provider unreachable: still signed out of Kith */ }
    }
    return { ok: true, redirect };
  });

  // Local testing without a sign-in provider. Off unless KITH_DEV_LOGIN=true.
  app.get("/auth/dev", async (req, reply) => {
    if (!config.devLogin) return reply.code(404).send({ error: "not found" });
    const role = (req.query as { role?: string }).role === "parent" ? "parent" : "child";
    const sid = createSession(db, { sub: `dev:${role}`, role, name: role === "child" ? config.people.childName || "Sam" : "Grown-up" });
    setCookie(reply, sid, role);
    return reply.redirect(role === "parent" ? "/parent" : "/");
  });

  // Every API call needs a session; changes also need the X-Kith header (blocks cross-site forms).
  // Decided on the matched route, not the raw URL, so encoding or extra slashes can't slip past.
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!needsSession(req.routeOptions?.url)) return;
    const user = sessionFor(db, req.cookies[COOKIE]);
    if (!user) return reply.code(401).send({ error: "Please sign in." });
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-kith"] !== "1") return reply.code(403).send({ error: "Missing X-Kith header." });
    // An app that says which one it is (X-Kith-App) only works with a session of its own role.
    const hint = req.headers["x-kith-app"];
    if (typeof hint === "string" && APP_HINT.test(hint) && user.role !== hint) {
      return reply.code(403).send({ error: wrongAppText(hint as AppHint), code: "wrong-app", role: user.role });
    }
    req.user = user;
  });
}

/** Whether a matched route needs a session: every /api/ route except /api/public/. */
export function needsSession(route: string | undefined): boolean {
  if (!route) return false; // nothing matched: it's a 404 either way
  return route.startsWith("/api/") && !route.startsWith("/api/public/");
}

/**
 * The key for rate limits (wired into @fastify/rate-limit's keyGenerator in index.ts): a signed-in
 * session gets its own allowance, so the child's devices don't share one with everyone behind the
 * same address; anything else is limited by address. Only a real session counts, so made-up
 * cookies can't buy extra allowance.
 */
export function rateLimitKey(db: DB) {
  return (req: FastifyRequest): string => {
    const sid = req.cookies?.[COOKIE];
    if (sid && sessionFor(db, sid)) return `s:${hashId(sid).slice(0, 32)}`;
    return `ip:${req.ip}`;
  };
}

// ── Sign out everywhere (parent) ─────────────────────────────────────────────────────────────
// People are shown by a short hash of who they are, never their session ids.
const personId = (sub: string) => hashId(`person:${sub}`).slice(0, 16);

export function listSignedIn(db: DB, now = Date.now()) {
  const rows = all<{ sub: string; role: Role; name: string; created: number; expires: number }>(db, "SELECT sub, role, name, created, expires FROM sessions WHERE expires > ?", now);
  const people = new Map<string, { person: string; role: Role; name: string; sessions: number; lastSignIn: number }>();
  for (const r of rows) {
    const id = personId(r.sub);
    const p = people.get(id) ?? { person: id, role: r.role, name: r.name, sessions: 0, lastSignIn: 0 };
    p.sessions++;
    p.lastSignIn = Math.max(p.lastSignIn, r.created);
    people.set(id, p);
  }
  return [...people.values()].sort((a, b) => b.lastSignIn - a.lastSignIn);
}

/** Ends sessions: everyone's, or one person's. `keep` is a session to leave alone (the caller's). Returns how many ended. */
export function signOutEverywhere(db: DB, opts: { person?: string; keep?: string } = {}): number {
  const rows = all<{ id: string; sub: string }>(db, "SELECT id, sub FROM sessions");
  let n = 0;
  for (const r of rows) {
    if (opts.keep && r.id === opts.keep) continue;
    if (opts.person && personId(r.sub) !== opts.person) continue;
    run(db, "DELETE FROM sessions WHERE id = ?", r.id);
    n++;
  }
  return n;
}

export function registerSessionAdmin(app: FastifyInstance, db: DB) {
  const parent = requireRole("parent");
  app.get("/api/parent/sessions", { preHandler: parent }, async () => ({ people: listSignedIn(db) }));
  app.post("/api/parent/sessions/sign-out", { preHandler: parent, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = (req.body ?? {}) as { person?: unknown; keepThisDevice?: unknown };
    if (b.person !== undefined && (typeof b.person !== "string" || !/^[0-9a-f]{16}$/.test(b.person))) return reply.code(400).send({ error: "bad person" });
    const keep = b.keepThisDevice === false ? undefined : req.user!.sid;
    const ended = signOutEverywhere(db, { person: b.person as string | undefined, keep });
    if (!keep) reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true, ended };
  });
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user || !roles.includes(req.user.role)) return reply.code(403).send({ error: "Not for you, sorry." });
  };
}
