// Sign-in through an OpenID Connect provider (e.g. Pocket ID). Only configured people get in:
// the child, and one or more parents. Authorization code flow with PKCE, state and nonce.

import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as oidc from "openid-client";
import type { DB } from "./db.js";
import { get, run } from "./db.js";
import { config } from "./config.js";

export type Role = "child" | "parent";
export interface SessionUser { sid: string; sub: string; role: Role; name: string }

const COOKIE = "kith_sid";
const DAY = 86_400_000;
const SESSION_DAYS: Record<Role, number> = { child: 30, parent: 14 };

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
// window may not share cookies with the app. So the app makes a random one-time id, opens
// /auth/login?handoff=<id>, and polls /auth/handoff/<id>. After the callback the new session is tied
// to that id (only its SHA-256 is stored), for one use within 2 minutes; the poll sets the cookie in
// the app's own context. No session id ever goes in a URL.
export const HANDOFF_ID = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url
const HANDOFF_MS = 2 * 60_000;
const hashId = (id: string) => crypto.createHash("sha256").update(id).digest("hex");

function finishHandoff(db: DB, handoff: string | null | undefined, result: { sid: string; role: Role } | { error: string }) {
  if (!handoff) return;
  run(db, "INSERT OR REPLACE INTO auth_handoff(id_hash, sid, role, error, created) VALUES (?,?,?,?,?)",
    handoff, "sid" in result ? result.sid : null, "sid" in result ? result.role : null, "error" in result ? result.error : null, Date.now());
}

/** Clears handoffs that were never collected. */
export function expireHandoffs(db: DB, now = Date.now()) {
  run(db, "DELETE FROM auth_handoff WHERE created < ?", now - HANDOFF_MS);
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
  const redirectUri = `${config.publicUrl}/auth/callback`;

  app.get("/auth/login", async (req, reply) => {
    if (!config.oidc.issuer) return reply.code(503).send({ error: "Sign-in isn't set up yet (KITH_OIDC_ISSUER)." });
    const handoffId = (req.query as { handoff?: string }).handoff;
    if (handoffId !== undefined && !HANDOFF_ID.test(handoffId)) return reply.code(400).send({ error: "bad handoff" });
    const cfg = await discover();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    run(db, "INSERT INTO oidc_state(state, verifier, nonce, created, handoff) VALUES (?,?,?,?,?)", state, verifier, nonce, Date.now(), handoffId ? hashId(handoffId) : null);
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
    const row = q.state ? get<{ verifier: string; nonce: string; created: number; handoff: string | null }>(db, "SELECT verifier, nonce, created, handoff FROM oidc_state WHERE state = ?", q.state) : undefined;
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
      const role = roleFor({ sub: claims.sub, email, emailVerified: verified, groups });
      if (!role) return done("/?signin=not-allowed", { error: "not-allowed" });
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

  // The installed app polls here. Single use: the first successful poll sets the cookie and the
  // handoff is gone.
  app.get("/auth/handoff/:id", { config: { rateLimit: { max: 90, timeWindow: "1 minute" } } }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!HANDOFF_ID.test(id)) return reply.code(400).send({ error: "bad handoff" });
    expireHandoffs(db);
    const h = hashId(id);
    const row = get<{ sid: string | null; role: Role | null; error: string | null }>(db, "SELECT sid, role, error FROM auth_handoff WHERE id_hash = ?", h);
    if (!row) return { pending: true };
    run(db, "DELETE FROM auth_handoff WHERE id_hash = ?", h);
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
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.url.startsWith("/api/public/")) return;
    const user = sessionFor(db, req.cookies[COOKIE]);
    if (!user) return reply.code(401).send({ error: "Please sign in." });
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers["x-kith"] !== "1") return reply.code(403).send({ error: "Missing X-Kith header." });
    req.user = user;
  });
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user || !roles.includes(req.user.role)) return reply.code(403).send({ error: "Not for you, sorry." });
  };
}
