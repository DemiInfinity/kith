import { beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { openDb, all, type DB } from "../src/db.js";
import { config } from "../src/config.js";
import { createSession } from "../src/auth.js";
import { loadParentSettings, saveParentSettings } from "../src/settings.js";
import { deviceCount, pushToChild, saveSubscription, sender } from "../src/checkins/push.js";
import { flushHeld, notifyParent, parentPayload } from "../src/checkins/parentPush.js";
import { makeReporters } from "../src/reporting/reporter.js";
import { manifestFor } from "../src/manifest.js";

const NOON = Date.UTC(2026, 10, 25, 12, 0); // outside quiet hours (London)
const NIGHT = Date.UTC(2026, 10, 25, 23, 30); // inside them
const sub = (n: string) => ({ endpoint: `https://web.push.apple.com/${n}`, keys: { p256dh: "p", auth: "a" } });
const sent: { endpoint: string; body: { title: string; body: string; url: string; tag: string } }[] = [];
beforeAll(() => {
  config.push.publicKey = "test-public";
  config.push.privateKey = "test-private";
  sender.send = (async (s: { endpoint: string }, body: string) => { sent.push({ endpoint: s.endpoint, body: JSON.parse(body) }); return {} as never; }) as never;
});
function setup(): DB {
  sent.length = 0;
  const db = openDb(":memory:");
  saveSubscription(db, sub("kid-phone"), "child");
  saveSubscription(db, sub("mum-phone"), "parent");
  return db;
}

describe("notifications to the parent", () => {
  it("go only to the parent's devices, and the child's only to the child's", async () => {
    const db = setup();
    expect(deviceCount(db, "parent")).toBe(1);
    await notifyParent(db, { kind: "report-now", summary: "Sam seemed very upset about school." }, NOON);
    expect(sent.map((x) => x.endpoint)).toEqual(["https://web.push.apple.com/mum-phone"]);
    sent.length = 0;
    await pushToChild(db, { title: "Pip", body: "hi" }, "test");
    expect(sent.map((x) => x.endpoint)).toEqual(["https://web.push.apple.com/kid-phone"]);
  });
  it("say only that something needs you, unless the parent chose to show the summary", async () => {
    const db = setup();
    await notifyParent(db, { kind: "report-now", summary: "Sam seemed very upset about school." }, NOON);
    expect(sent[0].body.body).not.toContain("upset");
    expect(sent[0].body.body).toMatch(/needs you/);
    expect(sent[0].body.url).toBe("/parent");
    const s = loadParentSettings(db);
    s.notify.showSummary = true;
    saveParentSettings(db, s);
    sent.length = 0;
    await notifyParent(db, { kind: "report-now", summary: "Sam seemed very upset about school." }, NOON);
    expect(sent[0].body.body).toBe("Sam seemed very upset about school.");
    expect(parentPayload({ kind: "weekly", summary: "chat text" }, true).body).not.toContain("chat text");
  });
  it("send 'Right now' even in quiet hours; other kinds wait and then go once", async () => {
    const db = setup();
    await notifyParent(db, { kind: "report-now" }, NIGHT);
    expect(sent).toHaveLength(1);
    await notifyParent(db, { kind: "weekly" }, NIGHT);
    await notifyParent(db, { kind: "weekly" }, NIGHT + 60_000);
    expect(sent).toHaveLength(1);
    expect(await flushHeld(db, NIGHT + 120_000)).toBe(0); // still quiet hours
    expect(await flushHeld(db, NOON + 86_400_000)).toBe(1); // one, not two
    expect(all(db, "SELECT id FROM push_held")).toHaveLength(0);
  });
  it("follow the parent's choices: 'Today' and 'Just so you know' are off by default", async () => {
    const db = setup();
    expect(await notifyParent(db, { kind: "report-today" }, NOON)).toBe(0);
    expect(await notifyParent(db, { kind: "report-fyi" }, NOON)).toBe(0);
    const s = loadParentSettings(db);
    s.notify.today = true;
    saveParentSettings(db, s);
    expect(await notifyParent(db, { kind: "report-today" }, NOON)).toBe(1);
  });
  it("are a reporter alongside the others", async () => {
    const db = setup();
    const reps = makeReporters(["console"], db);
    expect(reps.map((r) => r.name)).toEqual(["console", "push"]);
    await reps[1].send({ id: 1, ts: NOON, level: "now", category: "x", childNotice: "", parentText: "x", status: "pending" }, { companionName: "Pip", childName: "Sam" });
    expect(sent.some((x) => x.endpoint.endsWith("mum-phone"))).toBe(true);
  });
});

describe("Kith Parent", () => {
  it("the manifest names the app by who's signed in", async () => {
    expect(manifestFor("parent").name).toBe("Kith Parent");
    expect(manifestFor("parent").start_url).toBe("/?app=parent");
    expect(manifestFor("child").start_url).toBe("/?app=child");
    expect(manifestFor("child").name).toBe("Kith");
    expect(manifestFor(null).short_name).toBe("Kith");
  });
  it("is served per session", async () => {
    const db = openDb(":memory:");
    const app = Fastify();
    await app.register(cookie);
    const { sessionFor } = await import("../src/auth.js");
    app.get("/manifest.webmanifest", async (req) => manifestFor(sessionFor(db, req.cookies.kith_sid)?.role ?? null));
    const was = config.devLogin;
    config.devLogin = true; // a dev session, which only counts with dev sign-in on
    const sid = createSession(db, { sub: "dev:parent", role: "parent", name: "Grown-up" });
    expect((await app.inject({ url: "/manifest.webmanifest", cookies: { kith_sid: sid } })).json().name).toBe("Kith Parent");
    expect((await app.inject({ url: "/manifest.webmanifest" })).json().name).toBe("Kith");
    config.devLogin = was;
  });
  it("hands a burst over page by page without skipping any", async () => {
    const db = setup();
    const { parentInboxAfter, recordParentNative } = await import("../src/checkins/parentInbox.js");
    for (let i = 1; i <= 14; i++) recordParentNative(db, { title: "Kith", body: `n${i}` }, "test", false);
    const one = parentInboxAfter(db, 0);
    expect(one.items).toHaveLength(10);
    expect(one.more).toBe(true);
    expect(one.last).toBe(one.items[9].id);
    const two = parentInboxAfter(db, one.last);
    expect(two.items.map((i) => i.body)).toEqual(["n11", "n12", "n13", "n14"]);
    expect(two.more).toBe(false);
  });
});

describe("budget alerts", () => {
  it("tell the parent once when Low power starts, and again only after Full power came back", async () => {
    const db = setup();
    const { budgetAlerts } = await import("../src/scheduler.js");
    // Spend most of this week's chat budget so Low power starts.
    const s = loadParentSettings(db);
    db.prepare("INSERT INTO spend(ts, bucket, kind, model, usd) VALUES (?,?,?,?,?)").run(Date.now(), "chat", "chat", "claude-sonnet-5-5", s.budgets.weeklyUsd);
    await budgetAlerts(db);
    await budgetAlerts(db);
    // Sent now, or held until quiet hours end (depending on when the test runs): exactly once either way.
    const held = all<{ kind: string }>(db, "SELECT kind FROM push_held WHERE kind = 'budget'").length;
    expect(sent.filter((x) => x.body.tag === "kith-parent-budget").length + held).toBe(1);
  });
});

describe("the parent's inbox for the Mac app", () => {
  it("records what the rules let through, with the same private wording, even without VAPID keys", async () => {
    const db = setup();
    const { parentInboxAfter } = await import("../src/checkins/parentInbox.js");
    const key = config.push.privateKey;
    config.push.privateKey = ""; // no web push set up
    await notifyParent(db, { kind: "report-today", summary: "x" }, NOON); // off by default: nothing
    await notifyParent(db, { kind: "report-now", summary: "Sam seemed very upset about school." }, NIGHT); // urgent: through quiet hours
    await notifyParent(db, { kind: "weekly" }, NIGHT); // waits for the morning
    let inbox = parentInboxAfter(db, 0);
    expect(inbox.items.map((i) => i.kind)).toEqual(["report-now"]);
    expect(inbox.items[0].urgent).toBe(true);
    expect(inbox.items[0].body).not.toContain("upset");
    await flushHeld(db, NOON + 86_400_000);
    inbox = parentInboxAfter(db, inbox.last);
    expect(inbox.items.map((i) => [i.kind, i.urgent])).toEqual([["weekly", false]]);
    expect(sent).toHaveLength(0); // nothing went by web push without keys
    config.push.privateKey = key;
  });
  it("is served to the parent only; the first poll only learns where it's up to", async () => {
    const db = setup();
    const was = config.devLogin;
    config.devLogin = true;
    const app = Fastify();
    await app.register(cookie);
    const { registerParentInbox } = await import("../src/checkins/parentInbox.js");
    const { registerAuth } = await import("../src/auth.js");
    registerAuth(app, db);
    registerParentInbox(app, db);
    await notifyParent(db, { kind: "test" }, NOON);
    const mum = createSession(db, { sub: "dev:parent", role: "parent", name: "Grown-up" });
    const kid = createSession(db, { sub: "dev:child", role: "child", name: "Sam" });
    expect((await app.inject({ url: "/api/native/parent-inbox", cookies: { kith_sid: kid } })).statusCode).toBe(403);
    const first = (await app.inject({ url: "/api/native/parent-inbox", cookies: { kith_sid: mum } })).json();
    expect(first).toEqual({ items: [], last: 1, more: false });
    // Polling is how Kith Parent on a Mac shows up as one of the parent's devices.
    const { macAppConnected } = await import("../src/checkins/parentInbox.js");
    expect(macAppConnected(db)).toBe(true);
    expect(macAppConnected(db, Date.now() + 31 * 60_000)).toBe(false);
    const all1 = (await app.inject({ url: "/api/native/parent-inbox?after=0", cookies: { kith_sid: mum } })).json();
    expect(all1.items[0]).toMatchObject({ id: 1, kind: "test", urgent: false, title: "Kith", url: "/parent" });
    config.devLogin = was;
  });
});
