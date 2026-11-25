import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { callback, checkReturn, publicConfig, refresh, settings, start, token } from "../lib/broker.mjs";

const env = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "shh", CONNECT_STATE_KEY: "k".repeat(40), CONNECT_PUBLIC_URL: "https://kith-connect.vercel.app/" };
const s = settings(env);
const challenge = crypto.randomBytes(32).toString("base64url");
const q = (over = {}) => ({ return: "https://kith.example.org/auth/google/callback", state: "kith-state-1234567890", challenge, scope: "openid email https://www.googleapis.com/auth/drive.file", ...over });
const fakeGoogle = (reply = { access_token: "at", refresh_token: "rt", scope: "openid", expires_in: 3600 }) => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, body: Object.fromEntries(new URLSearchParams(init.body.toString())) }); return new Response(JSON.stringify(reply), { status: 200 }); };
  return { f, calls };
};

test("refuses to run half set up", () => {
  assert.throws(() => settings({}), /isn't set up/);
  assert.throws(() => settings({ ...env, CONNECT_STATE_KEY: "short" }), /32 characters/);
});

test("start sends the child to Google with this helper's callback, PKCE and only allowed scopes", () => {
  const u = new URL(start(s, q()));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("redirect_uri"), "https://kith-connect.vercel.app/api/callback");
  assert.equal(u.searchParams.get("code_challenge"), challenge);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("client_id"), "cid");
  assert.equal(u.searchParams.get("client_secret"), null);
  assert.throws(() => start(s, q({ scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly" })), /never asks for/);
  assert.throws(() => start(s, q({ scope: "https://www.googleapis.com/auth/drive" })), /always asks for drive.file/);
  assert.throws(() => start(s, q({ challenge: "" })), /PKCE/);
});

test("only sends sign-ins back to a Kith's own https callback", () => {
  assert.throws(() => checkReturn(s, "http://kith.example.org/auth/google/callback"), /https/);
  assert.throws(() => checkReturn(s, "https://evil.example/steal"), /isn't a Kith return/);
  assert.throws(() => checkReturn(s, "https://kith.example.org/auth/google/callback?x=1"), /isn't a Kith return/);
  assert.equal(checkReturn(s, "http://localhost:8787/auth/google/callback"), "http://localhost:8787/auth/google/callback");
  const only = settings({ ...env, CONNECT_ALLOWED_ORIGINS: "https://ours.example" });
  assert.throws(() => checkReturn(only, "https://kith.example.org/auth/google/callback"), /isn't on/);
});

test("callback hands the code back to that same Kith, with its own state, and nothing else", () => {
  const state = new URL(start(s, q())).searchParams.get("state");
  const back = new URL(callback(s, { state, code: "4/abc" }));
  assert.equal(back.origin + back.pathname, "https://kith.example.org/auth/google/callback");
  assert.equal(back.searchParams.get("code"), "4/abc");
  assert.equal(back.searchParams.get("state"), "kith-state-1234567890");
  assert.equal(new URL(callback(s, { state, error: "access_denied" })).searchParams.get("error"), "access_denied");
});

test("callback refuses a forged, tampered or stale state", () => {
  const state = new URL(start(s, q())).searchParams.get("state");
  const [body] = state.split(".");
  const forged = Buffer.from(JSON.stringify({ r: "https://evil.example/auth/google/callback", s: "x", exp: Date.now() + 1e6 })).toString("base64url");
  assert.throws(() => callback(s, { state: `${forged}.${state.split(".")[1]}`, code: "c" }), /isn't right/);
  assert.throws(() => callback(s, { state: `${body}.AAAA`, code: "c" }), /isn't right/);
  assert.throws(() => callback(s, { state, code: "c" }, Date.now() + 16 * 60_000), /too long/);
  const other = settings({ ...env, CONNECT_STATE_KEY: "z".repeat(40) });
  assert.throws(() => callback(other, { state, code: "c" }), /isn't right/);
});

test("token adds the secret and needs the PKCE verifier; refresh passes straight through", async () => {
  const g = fakeGoogle();
  await assert.rejects(token(s, { code: "c" }, g.f), /verifier/);
  const verifier = crypto.randomBytes(48).toString("base64url");
  const r = await token(s, { code: "4/abc", verifier }, g.f);
  assert.equal(r.status, 200);
  assert.equal(r.body.refresh_token, "rt");
  assert.deepEqual(g.calls[0].body, { code: "4/abc", code_verifier: verifier, client_id: "cid", client_secret: "shh", redirect_uri: "https://kith-connect.vercel.app/api/callback", grant_type: "authorization_code" });
  const rr = await refresh(s, { refresh_token: "1//rt" }, g.f);
  assert.equal(rr.body.access_token, "at");
  assert.equal(g.calls[1].body.grant_type, "refresh_token");
  await assert.rejects(refresh(s, {}, g.f), /Missing/);
});

test("public config never includes the secret", () => {
  assert.ok(!JSON.stringify(publicConfig(s)).includes("shh"));
});
