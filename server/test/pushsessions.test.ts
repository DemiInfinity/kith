// Push subscriptions belong to the session that turned them on: signing out, being signed out
// everywhere, or the session running out stops that device's notifications.

import { beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { openDb, MIGRATIONS, type DB } from "../src/db.js";
import { config } from "../src/config.js";
import { createSession, endSession, registerAuth, signOutEverywhere } from "../src/auth.js";
import { deviceCount, saveSubscription, sendTo, sender } from "../src/checkins/push.js";

const sub = (n: string) => ({ endpoint: `https://web.push.apple.com/${n}`, keys: { p256dh: "p", auth: "a" } });
const sent: string[] = [];
beforeAll(() => {
  config.push.publicKey = "test-public";
  config.push.privateKey = "test-private";
  config.devLogin = true; // dev: sessions stay valid without a configured person
  sender.send = (async (s: { endpoint: string }) => { sent.push(s.endpoint); return {} as never; }) as never;
});
const endpoints = (db: DB) => (db.prepare("SELECT endpoint FROM push_subs ORDER BY endpoint").all() as { endpoint: string }[]).map((r) => r.endpoint.split("/").pop());

describe("push subscriptions and sessions", () => {
  it("the migration adds the session column", () => {
    const db = openDb(":memory:");
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(MIGRATIONS.length);
    const cols = (db.prepare("PRAGMA table_info(push_subs)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("sid");
  });
  it("signing out removes that device's subscription, and only that one", async () => {
    const db = openDb(":memory:");
    const app = Fastify(); await app.register(cookie); registerAuth(app, db);
    const phone = createSession(db, { sub: "dev:child", role: "child", name: "Sam" });
    const laptop = createSession(db, { sub: "dev:child", role: "child", name: "Sam" });
    saveSubscription(db, sub("phone"), "child", phone);
    saveSubscription(db, sub("laptop"), "child", laptop);
    await app.inject({ method: "POST", url: "/auth/logout", cookies: { kith_sid: phone } });
    expect(endpoints(db)).toEqual(["laptop"]);
  });
  it("signing out everywhere removes the subscriptions of every session it ends", () => {
    const db = openDb(":memory:");
    const kid = createSession(db, { sub: "dev:child", role: "child", name: "Sam" });
    const mum = createSession(db, { sub: "dev:parent", role: "parent", name: "Jo" });
    saveSubscription(db, sub("kid"), "child", kid);
    saveSubscription(db, sub("mum"), "parent", mum);
    signOutEverywhere(db, { keep: mum });
    expect(endpoints(db)).toEqual(["mum"]);
    endSession(db, mum);
    expect(endpoints(db)).toEqual([]);
  });
  it("never sends to a device whose session has gone or run out", async () => {
    const db = openDb(":memory:");
    const live = createSession(db, { sub: "dev:child", role: "child", name: "Sam" });
    const old = createSession(db, { sub: "dev:child", role: "child", name: "Sam" });
    saveSubscription(db, sub("live"), "child", live);
    saveSubscription(db, sub("old"), "child", old);
    saveSubscription(db, sub("gone"), "child", "no-such-session");
    saveSubscription(db, sub("legacy"), "child"); // saved before sessions were recorded
    db.prepare("UPDATE sessions SET expires = ? WHERE id = ?").run(Date.now() - 1, old);
    sent.length = 0;
    expect(await sendTo(db, "child", { title: "hi" })).toBe(2);
    expect(sent.map((e) => e.split("/").pop()).sort()).toEqual(["legacy", "live"]);
    expect(endpoints(db)).toEqual(["legacy", "live"]);
    expect(deviceCount(db, "child")).toBe(2);
  });
  it("re-registering a device moves it to the new session", () => {
    const db = openDb(":memory:");
    const a = createSession(db, { sub: "dev:child", role: "child", name: "Sam" });
    const b = createSession(db, { sub: "dev:child", role: "child", name: "Sam" });
    saveSubscription(db, sub("phone"), "child", a);
    saveSubscription(db, sub("phone"), "child", b);
    endSession(db, a);
    expect(endpoints(db)).toEqual(["phone"]);
  });
});
