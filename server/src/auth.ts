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

  app.get("/auth/login", async (_req, reply) => {
    if (!config.oidc.issuer) return reply.code(503).send({ error: "Sign-in isn't set up yet (KITH_OIDC_ISSUER)." });
    const cfg = await discover();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    run(db, "INSERT INTO oidc_state(state, verifier, nonce, created) VALUES (?,?,?,?)", state, verifier, nonce, Date.now());
    const url = oidc.buildAuthorizationUrl(cfg, {
      redirect_uri: redirectUri,
      scope: config.oidc.childGroup || config.oidc.parentGroup ? "openid email profile groups" : "openid email profile",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    return reply.redirect(url.href);
  });

  app.get("/auth/callback", async (req, reply) => {
    const q = req.query as { state?: string; error?: string };
    if (q.error) return reply.redirect("/?signin=failed");
    const row = q.state ? get<{ verifier: string; nonce: string; created: number }>(db, "SELECT verifier, nonce, created FROM oidc_state WHERE state = ?", q.state) : undefined;
    if (!row || Date.now() - row.created > 15 * 60_000) return reply.redirect("/?signin=expired");
    run(db, "DELETE FROM oidc_state WHERE state = ?", q.state!);
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
      if (!role) return reply.redirect("/?signin=not-allowed");
      const viaGroup = role === "parent" ? config.oidc.parentGroup : config.oidc.childGroup;
      const group = viaGroup && groups.some((g) => g.toLowerCase() === viaGroup.toLowerCase()) ? viaGroup : "";
      if (tokens.id_token) idTokens.set(claims.sub, tokens.id_token);
      const sid = createSession(db, { sub: `${claims.sub}|${verified && email ? email : ""}|${group}`, role, name: firstName(claims as { given_name?: unknown; name?: unknown }) });
      setCookie(reply, sid, role);
      return reply.redirect(role === "parent" ? "/parent" : "/");
    } catch (err) {
      req.log.warn({ err }, "sign-in failed");
      return reply.redirect("/?signin=failed");
    }
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
