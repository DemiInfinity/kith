// Sign-in end to end against a stand-in provider shaped like Pocket ID: discovery at
// /.well-known/openid-configuration, /authorize, /api/oidc/token, /.well-known/jwks.json,
// /api/oidc/end-session; a public client with PKCE (S256); RS256 ID tokens with email,
// email_verified and groups.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { openDb } from "../src/db.js";
import { config } from "../src/config.js";
import { registerAuth, resetOidcForTests } from "../src/auth.js";
import type { Report } from "../src/reporting/reporter.js";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sign(claims: Record<string, unknown>) {
  const head = b64({ alg: "RS256", typ: "JWT", kid: "k1" });
  const body = b64(claims);
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}

let issuer = "";
let user: Record<string, unknown> = {};
const codes = new Map<string, { challenge: string; nonce: string }>();

const provider = http.createServer(async (req, res) => {
  const url = new URL(req.url!, issuer);
  const json = (o: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (url.pathname === "/.well-known/openid-configuration") {
    return json({
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/api/oidc/token`,
      userinfo_endpoint: `${issuer}/api/oidc/userinfo`, jwks_uri: `${issuer}/.well-known/jwks.json`,
      end_session_endpoint: `${issuer}/api/oidc/end-session`, response_types_supported: ["code"],
      subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"], scopes_supported: ["openid", "profile", "email", "groups"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    });
  }
  if (url.pathname === "/.well-known/jwks.json") return json({ keys: [jwk] });
  if (url.pathname === "/api/oidc/token" && req.method === "POST") {
    let body = "";
    for await (const c of req) body += c;
    const p = new URLSearchParams(body);
    const code = codes.get(p.get("code") ?? "");
    const verifierHash = crypto.createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url");
    if (!code || verifierHash !== code.challenge || p.get("client_id") !== "kith") {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid_grant" }));
    }
    const now = Math.floor(Date.now() / 1000);
    return json({
      access_token: "at", token_type: "Bearer", expires_in: 3600,
      id_token: sign({ iss: issuer, aud: "kith", iat: now, exp: now + 3600, nonce: code.nonce, ...user }),
    });
  }
  res.writeHead(404).end();
});

beforeAll(async () => {
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
  Object.assign(config.oidc, { issuer, clientId: "kith", clientSecret: "", childGroup: "kith-child", parentGroup: "kith-parent", trustEmail: false });
  config.people.child = [];
  config.people.parents = [];
  config.publicUrl = "http://localhost:8787";
  resetOidcForTests();
});
afterAll(() => provider.close());

type H = { id: string; secret: string };
async function fresh() {
  const db = openDb(":memory:");
  const app = Fastify();
  await app.register(cookie);
  registerAuth(app, db);
  return { app, db };
}
async function startHandoff(app: ReturnType<typeof Fastify>, appName?: string): Promise<H> {
  const r = await app.inject({ method: "POST", url: "/auth/handoff/start", payload: appName ? { app: appName } : {} });
  expect(r.statusCode).toBe(200);
  return r.json() as H;
}
/** The sign-in window after the provider: the confirm page, then Yes or No. */
async function confirm(app: ReturnType<typeof Fastify>, back: { headers: Record<string, unknown> }, answer: "yes" | "no" = "yes") {
  expect(back.headers.location).toBe("/auth/handoff/confirm");
  const token = /kith_confirm=([^;]+)/.exec(String(back.headers["set-cookie"]))![1];
  const page = await app.inject({ method: "GET", url: "/auth/handoff/confirm", cookies: { kith_confirm: token } });
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)![1];
  const post = await app.inject({
    method: "POST", url: "/auth/handoff/confirm", cookies: { kith_confirm: token },
    headers: { "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams({ csrf, answer }).toString(),
  });
  return { page, post, token, csrf };
}
const pollH = (app: ReturnType<typeof Fastify>, h: H, secret = h.secret) =>
  app.inject({ method: "GET", url: `/auth/handoff/${h.id}`, headers: secret ? { "x-kith-handoff-secret": secret } : {} });

async function signIn(claims: Record<string, unknown>, handoff?: string, existing?: { app: ReturnType<typeof Fastify>; db: ReturnType<typeof openDb> }, appHint?: string) {
  user = claims;
  const db = existing?.db ?? openDb(":memory:");
  const app = existing?.app ?? Fastify();
  if (!existing) { await app.register(cookie); registerAuth(app, db); }
  const q = [handoff && `handoff=${handoff}`, appHint && `app=${appHint}`].filter(Boolean).join("&");
  const start = await app.inject({ method: "GET", url: q ? `/auth/login?${q}` : "/auth/login" });
  expect(start.statusCode).toBe(302);
  const auth = new URL(start.headers.location as string);
  expect(auth.origin + auth.pathname).toBe(`${issuer}/authorize`);
  expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
  expect(auth.searchParams.get("scope")).toContain("groups");
  // What Pocket ID would do after the person signs in with their passkey:
  const code = crypto.randomBytes(8).toString("hex");
  codes.set(code, { challenge: auth.searchParams.get("code_challenge")!, nonce: auth.searchParams.get("nonce")! });
  const back = await app.inject({ method: "GET", url: `/auth/callback?code=${code}&state=${auth.searchParams.get("state")}&iss=${encodeURIComponent(issuer)}` });
  return { app, db, back };
}

describe("signing in with Pocket ID", () => {
  it("lets the child in by group, with PKCE", async () => {
    const { back } = await signIn({ sub: "u-123", email: "kid@example.com", email_verified: false, given_name: "Sam", groups: ["kith-child"] });
    expect(back.headers.location).toBe("/");
    expect(String(back.headers["set-cookie"])).toContain("kith_sid=");
  });
  it("sends the parent to the parent view", async () => {
    const { back } = await signIn({ sub: "u-456", email: "grownup@example.com", email_verified: false, groups: ["kith-parent"] });
    expect(back.headers.location).toBe("/parent");
  });
  it("keeps everyone else out", async () => {
    const { back } = await signIn({ sub: "u-789", email: "someone@example.com", email_verified: true, groups: ["family"] });
    expect(back.headers.location).toBe("/?signin=not-allowed");
  });
  it("doesn't trust an unverified email (Pocket ID's default) unless told to", async () => {
    config.people.child = ["kid@example.com"];
    const a = await signIn({ sub: "u-1", email: "kid@example.com", email_verified: false, groups: [] });
    expect(a.back.headers.location).toBe("/?signin=not-allowed");
    config.oidc.trustEmail = true;
    const b = await signIn({ sub: "u-1", email: "kid@example.com", email_verified: false, groups: [] });
    expect(b.back.headers.location).toBe("/");
    config.oidc.trustEmail = false;
    config.people.child = [];
  });
  it("matches the Pocket ID user ID", async () => {
    config.people.child = ["u-555"];
    const { back } = await signIn({ sub: "u-555", groups: [] });
    expect(back.headers.location).toBe("/");
    config.people.child = [];
  });
  it("signs out of Pocket ID too", async () => {
    const { app, back } = await signIn({ sub: "u-123", groups: ["kith-child"], given_name: "Sam" });
    const sid = /kith_sid=([^;]+)/.exec(String(back.headers["set-cookie"]))![1];
    const out = await app.inject({ method: "POST", url: "/auth/logout", cookies: { kith_sid: sid } });
    const redirect = new URL(out.json().redirect);
    expect(redirect.origin + redirect.pathname).toBe(`${issuer}/api/oidc/end-session`);
    expect(redirect.searchParams.get("post_logout_redirect_uri")).toBe("http://localhost:8787/");
    expect(redirect.searchParams.get("id_token_hint")).toBeTruthy();
  });
  it("rejects a tampered state", async () => {
    user = { sub: "u-123", groups: ["kith-child"] };
    const db = openDb(":memory:");
    const app = Fastify();
    await app.register(cookie);
    registerAuth(app, db);
    const r = await app.inject({ method: "GET", url: "/auth/callback?code=x&state=forged" });
    expect(r.headers.location).toBe("/?signin=expired");
  });
  describe("each app lets in only its own person (?app=)", () => {
    const both = { sub: "u-both", groups: ["kith-child", "kith-parent"] };
    it("a parent who's also in the child group can't get into the child app", async () => {
      const { back, db } = await signIn(both, undefined, undefined, "child");
      expect(back.headers.location).toBe("/?signin=use-parent-app&app=child");
      expect(String(back.headers["set-cookie"] ?? "")).not.toContain("kith_sid=");
      expect(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    });
    it("…but gets into the parent app", async () => {
      const { back } = await signIn(both, undefined, undefined, "parent");
      expect(back.headers.location).toBe("/parent");
      expect(String(back.headers["set-cookie"])).toContain("kith_sid=");
    });
    it("the child can't get into the parent app, and can get into theirs", async () => {
      const kid = { sub: "u-123", groups: ["kith-child"] };
      expect((await signIn(kid, undefined, undefined, "parent")).back.headers.location).toBe("/?signin=use-child-app&app=parent");
      expect((await signIn(kid, undefined, undefined, "child")).back.headers.location).toBe("/");
    });
    it("strangers are still not allowed, and no hint behaves as before", async () => {
      expect((await signIn({ sub: "u-x", groups: [] }, undefined, undefined, "child")).back.headers.location).toBe("/?signin=not-allowed&app=child");
      expect((await signIn(both)).back.headers.location).toBe("/parent");
    });
    it("hands the error back to an installed app's handoff", async () => {
      const f = await fresh();
      const h = await startHandoff(f.app, "child");
      await signIn(both, h.id, f, "child");
      const poll = await pollH(f.app, h);
      expect(poll.statusCode).toBe(403);
      expect(poll.json()).toEqual({ error: "use-parent-app" });
    });
    it("a handoff keeps the app it was started for", async () => {
      const f = await fresh();
      const h = await startHandoff(f.app, "child");
      expect((await f.app.inject({ method: "GET", url: `/auth/login?handoff=${h.id}&app=parent` })).statusCode).toBe(400);
      // Without ?app= on the login, the start's app still applies.
      const r = await signIn(both, h.id, f);
      expect(r.back.headers.location).toBe("/?signin=done-use-parent-app");
    });
    it("refuses an unknown app name", async () => {
      const app = Fastify(); await app.register(cookie); registerAuth(app, openDb(":memory:"));
      expect((await app.inject({ method: "GET", url: "/auth/login?app=admin" })).statusCode).toBe(400);
    });
    it("an app sending X-Kith-App with someone else's session gets a friendly 403", async () => {
      const { db, back } = await signIn({ sub: "u-123", groups: ["kith-child"] });
      const sid = /kith_sid=([^;]+)/.exec(String(back.headers["set-cookie"]))![1];
      const app = Fastify(); await app.register(cookie); registerAuth(app, db);
      app.get("/api/me", async (req) => ({ role: req.user?.role }));
      const wrong = await app.inject({ method: "GET", url: "/api/me", cookies: { kith_sid: sid }, headers: { "x-kith-app": "parent" } });
      expect(wrong.statusCode).toBe(403);
      expect(wrong.json()).toMatchObject({ code: "wrong-app", role: "child" });
      expect(wrong.json().error).toBe("This is the grown-ups’ app. Kids use Kith.");
      expect((await app.inject({ method: "GET", url: "/api/me", cookies: { kith_sid: sid }, headers: { "x-kith-app": "child" } })).json()).toEqual({ role: "child" });
      expect((await app.inject({ method: "GET", url: "/api/me", cookies: { kith_sid: sid } })).json()).toEqual({ role: "child" });
    });
  });
  describe("from an installed web app (Dock or Home Screen)", () => {
    const newId = () => crypto.randomBytes(32).toString("base64url");
    it("hands the session to the app's poll once, and the sign-in window finishes on a 'done' page", async () => {
      const f = await fresh();
      const h = await startHandoff(f.app);
      const first = await signIn({ sub: "u-123", groups: ["kith-child"], given_name: "Sam" }, h.id, f);
      expect(String(first.back.headers["set-cookie"])).not.toContain("kith_sid=");
      expect((await pollH(f.app, h)).json()).toEqual({ pending: true }); // nothing until Yes
      expect((await confirm(f.app, first.back)).post.headers.location).toBe("/?signin=done");
      const poll = await pollH(f.app, h);
      expect(poll.json()).toEqual({ ok: true, redirect: "/" });
      const sid = /kith_sid=([^;]+)/.exec(String(poll.headers["set-cookie"]))![1];
      const me = await f.app.inject({ method: "POST", url: "/auth/logout", cookies: { kith_sid: sid } });
      expect(me.statusCode).toBe(200);
      // Single use: the handoff is gone.
      expect((await pollH(f.app, h)).statusCode).toBe(410);
    });
    it("says pending until sign-in finishes, and passes on a refusal", async () => {
      const f = await fresh();
      const h = await startHandoff(f.app);
      expect((await pollH(f.app, h)).json()).toEqual({ pending: true });
      const r = await signIn({ sub: "u-9", groups: ["family"] }, h.id, f);
      expect(r.back.headers.location).toBe("/?signin=done-not-allowed");
      const poll = await pollH(f.app, h);
      expect(poll.statusCode).toBe(403);
      expect(poll.headers["set-cookie"]).toBeUndefined();
    });
    it("expires after 2 minutes, and rejects malformed ids", async () => {
      const f = await fresh();
      const h = await startHandoff(f.app);
      await confirm(f.app, (await signIn({ sub: "u-123", groups: ["kith-child"] }, h.id, f)).back);
      f.db.prepare("UPDATE auth_handoff SET created = ?").run(Date.now() - 3 * 60_000);
      expect((await pollH(f.app, h)).json()).toEqual({ pending: true });
      // And the started handoff itself after 15 minutes.
      f.db.prepare("UPDATE auth_handoff_start SET created = ?").run(Date.now() - 16 * 60_000);
      expect((await pollH(f.app, h)).statusCode).toBe(410);
      expect((await f.app.inject({ method: "GET", url: "/auth/handoff/short" })).statusCode).toBe(400);
      expect((await f.app.inject({ method: "GET", url: "/auth/login?handoff=bad!" })).statusCode).toBe(400);
    });
    it("gives the provider's address as JSON for the app to open in the browser, and that sign-in still hands over", async () => {
      const { app } = await fresh();
      const h = await startHandoff(app);
      const r = await app.inject({ method: "GET", url: `/auth/login?handoff=${h.id}&json=1` });
      expect(r.statusCode).toBe(200);
      const auth = new URL(r.json().url);
      expect(auth.origin + auth.pathname).toBe(`${issuer}/authorize`);
      user = { sub: "u-123", groups: ["kith-child"] };
      const code = crypto.randomBytes(8).toString("hex");
      codes.set(code, { challenge: auth.searchParams.get("code_challenge")!, nonce: auth.searchParams.get("nonce")! });
      const back = await app.inject({ method: "GET", url: `/auth/callback?code=${code}&state=${auth.searchParams.get("state")}&iss=${encodeURIComponent(issuer)}` });
      expect((await confirm(app, back)).post.headers.location).toBe("/?signin=done");
      expect((await pollH(app, h)).json()).toEqual({ ok: true, redirect: "/" });
      // Without a handoff, json=1 changes nothing.
      expect((await app.inject({ method: "GET", url: "/auth/login?json=1" })).statusCode).toBe(302);
    });
    it("never stores the id or secret, or puts a session id in a URL", async () => {
      const f = await fresh();
      const h = await startHandoff(f.app);
      const first = await signIn({ sub: "u-123", groups: ["kith-child"] }, h.id, f);
      await confirm(f.app, first.back);
      const stored = f.db.prepare("SELECT id_hash, sid FROM auth_handoff").all() as { id_hash: string; sid: string }[];
      expect(stored[0].id_hash).not.toContain(h.id);
      const started = JSON.stringify(f.db.prepare("SELECT * FROM auth_handoff_start").all());
      expect(started).not.toContain(h.id);
      expect(started).not.toContain(h.secret);
      expect(String(first.back.headers.location)).not.toContain(stored[0].sid);
    });

    // The hijack: someone makes up (or reads from a log) a handoff id, gets the victim to sign in
    // with it, and polls for their session.
    it("refuses a handoff the app didn't start", async () => {
      const { app } = await fresh();
      const id = newId();
      expect((await app.inject({ method: "GET", url: `/auth/login?handoff=${id}&json=1` })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: `/auth/login?handoff=${id}` })).statusCode).toBe(400);
    });
    it("uses a started handoff for one sign-in only", async () => {
      const { app } = await fresh();
      const h = await startHandoff(app);
      expect((await app.inject({ method: "GET", url: `/auth/login?handoff=${h.id}&json=1` })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/auth/login?handoff=${h.id}&json=1` })).statusCode).toBe(400);
    });
    it("only hands the session to a poll with the handoff's secret", async () => {
      const f = await fresh();
      const h = await startHandoff(f.app);
      await confirm(f.app, (await signIn({ sub: "u-123", groups: ["kith-child"] }, h.id, f)).back);
      const noSecret = await pollH(f.app, h, "");
      expect(noSecret.statusCode).toBe(403);
      expect(noSecret.headers["set-cookie"]).toBeUndefined();
      const wrong = await pollH(f.app, h, crypto.randomBytes(32).toString("base64url"));
      expect(wrong.statusCode).toBe(403);
      expect(wrong.headers["set-cookie"]).toBeUndefined();
      // A wrong guess doesn't use it up: the real app still collects it.
      expect((await pollH(f.app, h)).json()).toEqual({ ok: true, redirect: "/" });
    });
    // The other trick: someone starts a handoff on their own device and gets a family member to
    // finish the sign-in with its link. The family member is asked first, with the app's code.
    describe("the confirm page", () => {
      it("shows the code from the app, kindly, and hands over nothing until Yes", async () => {
        const f = await fresh();
        const h = (await f.app.inject({ method: "POST", url: "/auth/handoff/start", payload: { app: "child", device: "mac" } })).json() as H & { code: string };
        expect(h.code).toMatch(/^\d{4}$/);
        const { back } = await signIn({ sub: "u-123", groups: ["kith-child"] }, h.id, f);
        const { page } = await confirm(f.app, back);
        expect(page.statusCode).toBe(200);
        expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
        expect(page.body).toContain(`Finish signing in to Kith on your Mac app?`);
        expect(page.body).toContain(`>${h.code}<`);
        expect(page.body).toContain("If you didn't just open Kith yourself, press No.");
        expect(page.body).toContain("Yes, that's my app");
        expect(page.body).toContain("No, cancel");
        expect(page.body).not.toContain("<script");
        expect((await pollH(f.app, h)).json()).toEqual({ ok: true, redirect: "/" });
      });
      it("No cancels it: the app gets a refusal, no session is made, and the parent hears", async () => {
        const reports: Report[] = [];
        const f = { db: openDb(":memory:"), app: Fastify() };
        await f.app.register(cookie);
        registerAuth(f.app, f.db, { reporters: [{ name: "mem", send: async (r: Report) => { reports.push(r); } }] });
        const h = await startHandoff(f.app, "parent");
        const { back } = await signIn({ sub: "u-456", groups: ["kith-parent"] }, h.id, f);
        const { post } = await confirm(f.app, back, "no");
        expect(post.headers.location).toBe("/?signin=done-cancelled");
        expect(String(post.headers["set-cookie"])).not.toContain("kith_sid=");
        const poll = await pollH(f.app, h);
        expect(poll.statusCode).toBe(403);
        expect(poll.json()).toEqual({ error: "cancelled" });
        expect(f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
        await new Promise((r) => setImmediate(r));
        expect(reports.map((r) => [r.level, r.category])).toEqual([["fyi", "signin_cancelled"]]);
        expect(reports[0].parentText).toMatch(/A sign-in was cancelled/);
      });
      it("needs the page's own form token (a forged form gets nothing), and answers once", async () => {
        const f = await fresh();
        const h = await startHandoff(f.app);
        const { back } = await signIn({ sub: "u-123", groups: ["kith-child"] }, h.id, f);
        const token = /kith_confirm=([^;]+)/.exec(String(back.headers["set-cookie"]))![1];
        const form = (csrf: string) => ({ method: "POST" as const, url: "/auth/handoff/confirm", cookies: { kith_confirm: token },
          headers: { "content-type": "application/x-www-form-urlencoded" }, payload: new URLSearchParams({ csrf, answer: "yes" }).toString() });
        // Before the page is shown there's no token at all; a guessed one doesn't work either.
        expect((await f.app.inject(form("guess"))).statusCode).toBe(403);
        await f.app.inject({ method: "GET", url: "/auth/handoff/confirm", cookies: { kith_confirm: token } });
        expect((await f.app.inject(form("guess"))).statusCode).toBe(403);
        expect((await pollH(f.app, h)).json()).toEqual({ pending: true });
        // Without the cookie (another browser), nothing.
        expect((await f.app.inject({ method: "GET", url: "/auth/handoff/confirm" })).headers.location).toBe("/?signin=expired");
        // The real page works once.
        const page = await f.app.inject({ method: "GET", url: "/auth/handoff/confirm", cookies: { kith_confirm: token } });
        const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)![1];
        expect((await f.app.inject(form(csrf))).headers.location).toBe("/?signin=done");
        expect((await f.app.inject(form(csrf))).headers.location).toBe("/?signin=expired");
      });
      it("expires with the handoff", async () => {
        const f = await fresh();
        const h = await startHandoff(f.app);
        const { back } = await signIn({ sub: "u-123", groups: ["kith-child"] }, h.id, f);
        f.db.prepare("UPDATE auth_handoff_start SET created = ?").run(Date.now() - 16 * 60_000);
        const token = /kith_confirm=([^;]+)/.exec(String(back.headers["set-cookie"]))![1];
        expect((await f.app.inject({ method: "GET", url: "/auth/handoff/confirm", cookies: { kith_confirm: token } })).headers.location).toBe("/?signin=expired");
        expect(f.db.prepare("SELECT COUNT(*) AS n FROM auth_handoff_confirm").get()).toEqual({ n: 0 });
      });
      it("says 'Home Screen app' or just 'app', and Kith Parent for the grown-ups' app", async () => {
        const { confirmPage } = await import("../src/auth.js");
        expect(confirmPage({ app: "parent", device: "homescreen", code: "0042", csrf: "x" })).toContain("Finish signing in to Kith Parent on your Home Screen app?");
        expect(confirmPage({ app: null, device: null, code: "0042", csrf: "x" })).toContain("on your app?");
        expect(confirmPage({ app: null, device: null, code: "<b>", csrf: "\"><script>" })).not.toMatch(/<b>|<script>/);
      });
      it("refuses an unknown device", async () => {
        const { app } = await fresh();
        expect((await app.inject({ method: "POST", url: "/auth/handoff/start", payload: { device: "fridge" } })).statusCode).toBe(400);
      });
    });
    it("refuses an unknown app when starting", async () => {
      const { app } = await fresh();
      expect((await app.inject({ method: "POST", url: "/auth/handoff/start", payload: { app: "admin" } })).statusCode).toBe(400);
    });
  });
});
