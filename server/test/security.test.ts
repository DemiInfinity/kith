// The security and safety audit fixes (November 2026): each block is one finding.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { all, openDb, run, type DB } from "../src/db.js";
import { config, CONN_SECRET, trustProxyHops } from "../src/config.js";
import {
  createSession, listSignedIn, needsSession, rateLimitKey, registerAuth, SESSION_DAYS, signOutEverywhere,
} from "../src/auth.js";
import { Connection, loadParentSettings, ParentSettings, saveParentSettings, Budgets, CompanionProfile, saveProfile } from "../src/settings.js";
import { CHECK_UNAVAILABLE, Safety } from "../src/safety/check.js";
import { noteSafetyUnavailable, UNAVAILABLE_TEXT } from "../src/safety/unavailable.js";
import { fallbackSafetyReply, takeTurn, type Deps } from "../src/companion/chat.js";
import { conversationContext, loadRolling } from "../src/companion/context.js";
import { proposalText } from "../src/companion/googleTools.js";
import { isPushEndpoint } from "../src/checkins/push.js";
import { loadLangProfiles, LangLocked, saveLangProfile } from "../src/study/languages.js";
import { pathOnly, reqSerializer } from "../src/logging.js";
import { registerRoutes } from "../src/routes.js";
import { Studio } from "../src/desk/studio.js";
import type { CallOpts, LLM } from "../src/llm.js";
import type { Report, Reporter } from "../src/reporting/reporter.js";
import type { InputVerdict } from "../src/safety/types.js";

const msg = (text: string, model = "m") => ({
  id: "m", type: "message", role: "assistant", model, stop_reason: "end_turn", stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text, citations: null }],
}) as unknown as Anthropic.Message;

/** An LLM where the input safety check fails (or not), and everything else answers. */
class TestLLM implements LLM {
  available = true;
  calls: CallOpts[] = [];
  constructor(private o: { inputFails?: boolean; outputOk?: boolean; reply?: string; onChat?: () => void } = {}) {}
  async call(opts: CallOpts) {
    this.calls.push(opts);
    const sys = JSON.stringify(opts.params.system);
    if (sys.includes("Decide whether their grown-up")) {
      if (this.o.inputFails) throw new Error("overloaded");
      return msg(JSON.stringify({ level: "none", categories: [], parent_summary: "", steer: "" }));
    }
    if (sys.includes("draft reply")) return msg(JSON.stringify({ ok: this.o.outputOk ?? true, categories: this.o.outputOk === false ? ["romance"] : [], reason: "" }));
    if (sys.includes("running summary")) return msg("They were revising fractions.");
    this.o.onChat?.();
    return msg(this.o.reply ?? "Sure!");
  }
}
class MemoryReporter implements Reporter {
  name = "memory";
  sent: Report[] = [];
  async send(r: Report) { this.sent.push(r); }
}
const tick = () => new Promise((r) => setImmediate(r));
const inputCalls = (l: TestLLM) => l.calls.filter((c) => JSON.stringify(c.params.system).includes("Decide whether their grown-up"));

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  saveProfile(db, CompanionProfile.parse({ name: "Pip", setupDone: true }));
});
function deps(llm: LLM, reporter = new MemoryReporter()): Deps & { reporter: MemoryReporter } {
  const safety = new Safety(llm);
  return { db, llm, safety, reporters: [reporter], studio: new Studio(db, llm, safety), childName: "Sam", reporter };
}

// ── 2. Connection secrets ──────────────────────────────────────────────────────────────────
describe("connection secrets", () => {
  it("can only name KITH_CONN_ variables", () => {
    process.env.KITH_CONN_TEST_TOKEN = "t0k";
    process.env.KITH_DESK_TOKEN_FOR_TEST = "desk";
    expect(config.secret("KITH_CONN_TEST_TOKEN")).toBe("t0k");
    for (const name of ["KITH_DESK_TOKEN_FOR_TEST", "ANTHROPIC_API_KEY", "KITH_SECRET_KEY", "kith_conn_test_token", "KITH_CONN_", "PATH", ""]) {
      expect(config.secret(name)).toBe("");
    }
    expect(CONN_SECRET.test("KITH_CONN_HA_TOKEN")).toBe(true);
  });
  it("refuses any other name in the settings, and drops an old one when loading", () => {
    const base = { id: "room", kind: "home-assistant", name: "Lights" };
    expect(() => Connection.parse({ ...base, tokenEnv: "ANTHROPIC_API_KEY" })).toThrow(/KITH_CONN_/);
    expect(Connection.parse({ ...base, tokenEnv: "KITH_CONN_HA_TOKEN" }).tokenEnv).toBe("KITH_CONN_HA_TOKEN");
    expect(Connection.parse({ ...base }).tokenEnv).toBe("");
    const s = JSON.parse(JSON.stringify(loadParentSettings(db)));
    s.connections[0].tokenEnv = "KITH_DESK_TOKEN";
    run(db, "INSERT INTO settings(key, json) VALUES('parent', ?)", JSON.stringify(s));
    expect(loadParentSettings(db).connections[0].tokenEnv).toBe("");
  });
});

// ── 3. Privacy of the companion's files ─────────────────────────────────────────────────────
describe("the companion's files and schedule", () => {
  it("are the child's only: the parent gets a 403", async () => {
    const app = Fastify();
    await app.register(cookie);
    registerAuth(app, db);
    const llm = new TestLLM();
    const safety = new Safety(llm);
    registerRoutes(app, { db, llm, safety, reporters: [], studio: new Studio(db, llm, safety) });
    const was = config.devLogin;
    config.devLogin = true;
    try {
      const kid = createSession(db, { sub: "dev:child", role: "child", name: "Sam" });
      const mum = createSession(db, { sub: "dev:parent", role: "parent", name: "Grown-up" });
      for (const url of ["/api/pip/files", "/api/pip/schedule"]) {
        expect((await app.inject({ url, cookies: { kith_sid: mum } })).statusCode).toBe(403);
      }
      expect((await app.inject({ url: "/api/pip/files", cookies: { kith_sid: kid } })).statusCode).toBe(200);
      expect((await app.inject({ url: "/api/parent/safeguards", cookies: { kith_sid: mum } })).statusCode).toBe(200);
    } finally { config.devLogin = was; }
  });
});

// ── 4. The input check fails closed ─────────────────────────────────────────────────────────
describe("when the input safety check can't run", () => {
  it("retries once, then holds the message (and still keeps what the fixed rules found)", async () => {
    const llm = new TestLLM({ inputFails: true });
    const v = await new Safety(llm).checkInput("can you help with my homework", []);
    expect(v.held).toBe(true);
    expect(inputCalls(llm)).toHaveLength(2);
    const urgent = await new Safety(new TestLLM({ inputFails: true })).checkInput("I want to die", []);
    expect(urgent.level).toBe("now");
    expect(urgent.held).toBe(true);
  });
  it("holds the turn, answers nothing, and tells the parent the check was down (never what was said)", async () => {
    const llm = new TestLLM({ inputFails: true, reply: "should never be sent" });
    const d = deps(llm);
    const t = await takeTurn(d, { text: "my secret diary entry about Jo", mode: "chat" });
    expect(t.reply.text).toBe(CHECK_UNAVAILABLE);
    expect(llm.calls.filter((c) => c.kind === "chat")).toHaveLength(0);
    await tick();
    expect(d.reporter.sent).toHaveLength(1);
    expect(d.reporter.sent[0].level).toBe("fyi");
    expect(d.reporter.sent[0].parentText).toBe(UNAVAILABLE_TEXT);
    expect(JSON.stringify(d.reporter.sent)).not.toMatch(/diary|Jo\b/);
  });
  it("a real worry still gets the safety reply and a report, even with the check down", async () => {
    const d = deps(new TestLLM({ inputFails: true, reply: "I'm glad you told me. I'm letting your grown-up know." }));
    const t = await takeTurn(d, { text: "I want to die", mode: "chat" });
    expect(t.report?.level).toBe("now");
    await tick();
    expect(d.reporter.sent.map((r) => r.level)).toEqual(["now"]);
  });
  it("sends the parent at most one note an hour", () => {
    const ctx = { companionName: "Pip", childName: "Sam" };
    const r = new MemoryReporter();
    expect(noteSafetyUnavailable(db, ctx, [r], 1_000_000)).toBe(true);
    expect(noteSafetyUnavailable(db, ctx, [r], 1_000_000 + 30 * 60_000)).toBe(false);
    expect(noteSafetyUnavailable(db, ctx, [r], 1_000_000 + 61 * 60_000)).toBe(true);
    expect(all(db, "SELECT id FROM reports WHERE category = 'safety_unavailable'")).toHaveLength(2);
  });
  it("holds soul.md edits, desk ideas and study topics too (503)", async () => {
    const app = Fastify();
    await app.register(cookie);
    registerAuth(app, db);
    const llm = new TestLLM({ inputFails: true });
    const safety = new Safety(llm);
    registerRoutes(app, { db, llm, safety, reporters: [], studio: new Studio(db, llm, safety) });
    const { registerStudy } = await import("../src/routes-study.js");
    registerStudy(app, { db, llm, safety, storage: {} as never });
    const was = config.devLogin;
    config.devLogin = true;
    try {
      const h = { cookies: { kith_sid: createSession(db, { sub: "dev:child", role: "child", name: "Sam" }) }, headers: { "x-kith": "1" } };
      const soul = await app.inject({ method: "PUT", url: "/api/pip/soul", ...h, payload: { text: "Pip loves dragons" } });
      expect(soul.statusCode).toBe(503);
      expect(soul.json().error).toBe(CHECK_UNAVAILABLE);
      expect((await app.inject({ method: "POST", url: "/api/desk/make", ...h, payload: { kind: "story", title: "Dragons", brief: "a dragon story" } })).statusCode).toBe(503);
      expect((await app.inject({ method: "POST", url: "/api/languages/ask", ...h, payload: { language: "French" } })).statusCode).toBe(503);
    } finally { config.devLogin = was; }
  });
});

// ── 5. The rolling summary and Google proposals pass the output check ───────────────────────
describe("text the companion writes for later", () => {
  function longThread() {
    for (let i = 0; i < 60; i++) run(db, "INSERT INTO messages(ts, role, text, mode, thread_id) VALUES (?,?,?,?,1)", i, i % 2 ? "companion" : "child", "word ".repeat(150), "chat");
  }
  it("keeps the old summary if the new one doesn't pass", async () => {
    longThread();
    const llm = new TestLLM({ outputOk: false });
    await conversationContext(db, llm, "Pip", 1, new Safety(llm));
    expect(loadRolling(db)).toBeNull();
    const ok = new TestLLM({ outputOk: true });
    await conversationContext(db, ok, "Pip", 1, new Safety(ok));
    expect(loadRolling(db)?.text).toBe("They were revising fractions.");
  });
  it("checks every word of a Google proposal, not ids or dates", () => {
    const t = proposalText({ file_id: "doc123", summary: "Fix the ending", changes: [{ op: "replace", find: "teh", with: "the" }, { op: "append_rows", rows: [["a", "b"]] }], start: "2026-12-01" });
    expect(t.split("\n")).toEqual(["Fix the ending", "teh", "the", "a", "b"]);
  });
});

// ── 6. Settings validation ─────────────────────────────────────────────────────────────────
describe("helplines and the hard stop", () => {
  const base = () => JSON.parse(JSON.stringify(loadParentSettings(db)));
  it("need at least one number, and 999 is always there", () => {
    expect(() => ParentSettings.parse({ ...base(), helplines: [] })).toThrow(/at least one/);
    const s = ParentSettings.parse({ ...base(), helplines: [{ name: "Childline", number: "0800 1111" }] });
    expect(s.helplines.map((h) => h.number)).toEqual(["0800 1111", "999"]);
    expect(saveParentSettings(db, s).helplines).toHaveLength(2); // saving again doesn't add another
    const six = Array.from({ length: 6 }, (_, i) => ({ name: `Line ${i}`, number: `0800 00${i}` }));
    expect(ParentSettings.parse({ ...base(), helplines: six }).helplines).toHaveLength(7);
    expect(() => ParentSettings.parse({ ...base(), helplines: [...six, { name: "Seventh", number: "0800 7" }] })).toThrow();
  });
  it("a hard stop must be above zero; an old 0 stays stopped", () => {
    expect(() => Budgets.parse({ hardStopUsd: 0 })).toThrow();
    const s = base();
    s.budgets.hardStopUsd = 0;
    s.helplines = [];
    run(db, "INSERT INTO settings(key, json) VALUES('parent', ?)", JSON.stringify(s));
    const loaded = loadParentSettings(db);
    expect(loaded.budgets.hardStopUsd).toBe(0.01);
    expect(loaded.helplines.length).toBeGreaterThan(0);
  });
  it("the fallback safety reply never says 'talk to .'", () => {
    const v = { level: "now", categories: ["self_harm"], parentSummary: "", steer: "", source: "rules" } as InputVerdict;
    const text = fallbackSafetyReply(v, "Mum", []);
    expect(text).not.toMatch(/talk to \./);
    expect(text).toMatch(/Childline on 0800 1111/);
    expect(text).toMatch(/999/);
  });
});

// ── 7. Rate limits and the auth hook ───────────────────────────────────────────────────────
describe("rate limits and the session check", () => {
  it("trusts one proxy by default, never 'everything'", () => {
    expect(config.trustProxy).toBe(1);
    expect(trustProxyHops(undefined)).toBe(1);
    expect(trustProxyHops("true")).toBe(1);
    expect(trustProxyHops("0")).toBe(0);
    expect(trustProxyHops("2")).toBe(2);
    expect(() => trustProxyHops("10.0.0.0/8")).toThrow();
  });
  it("decides on the matched route", () => {
    expect(needsSession("/api/chat")).toBe(true);
    expect(needsSession("/api/public/health")).toBe(false);
    expect(needsSession("/auth/login")).toBe(false);
    expect(needsSession("/*")).toBe(false);
    expect(needsSession(undefined)).toBe(false);
  });
  it("an encoded or doubled path to an API route still needs a session", async () => {
    const app = Fastify();
    await app.register(cookie);
    registerAuth(app, db);
    app.get("/api/secret", async () => ({ secret: true }));
    for (const url of ["/api/secret", "/api/secret?x=/api/public/", "/%61pi/secret", "/api/secret/"]) {
      const r = await app.inject({ url });
      expect(r.statusCode, url).not.toBe(200);
    }
  });
  it("keys limits by session when there's a real one, by address otherwise", () => {
    const key = rateLimitKey(db);
    const sid = createSession(db, { sub: "u|kid@example.com|", role: "child", name: "Sam" });
    config.people.child = ["kid@example.com"];
    try {
      const a = key({ cookies: { kith_sid: sid }, ip: "1.2.3.4" } as never);
      expect(a).toMatch(/^s:/);
      expect(a).not.toContain(sid);
      expect(key({ cookies: { kith_sid: "made-up" }, ip: "1.2.3.4" } as never)).toBe("ip:1.2.3.4");
      expect(key({ cookies: {}, ip: "5.6.7.8" } as never)).toBe("ip:5.6.7.8");
    } finally { config.people.child = []; }
  });
});

// ── 8. Sessions ────────────────────────────────────────────────────────────────────────────
describe("sessions", () => {
  afterEach(() => { config.devLogin = false; });
  it("grown-up sessions last 7 days", () => {
    expect(SESSION_DAYS.parent).toBe(7);
    createSession(db, { sub: "dev:parent", role: "parent", name: "Mum" });
    const r = all<{ created: number; expires: number }>(db, "SELECT created, expires FROM sessions")[0];
    expect(r.expires - r.created).toBe(7 * 86_400_000);
  });
  it("the parent can sign everyone out, or one person, keeping their own device", async () => {
    config.devLogin = true;
    const app = Fastify();
    await app.register(cookie);
    registerAuth(app, db);
    const llm = new TestLLM();
    const safety = new Safety(llm);
    registerRoutes(app, { db, llm, safety, reporters: [], studio: new Studio(db, llm, safety) });
    const kid1 = createSession(db, { sub: "dev:child", role: "child", name: "Sam" });
    createSession(db, { sub: "dev:child", role: "child", name: "Sam" });
    const mum = createSession(db, { sub: "dev:parent", role: "parent", name: "Mum" });
    const mum2 = createSession(db, { sub: "dev:parent", role: "parent", name: "Mum" });
    expect((await app.inject({ url: "/api/parent/sessions", cookies: { kith_sid: kid1 } })).statusCode).toBe(403);
    const people = (await app.inject({ url: "/api/parent/sessions", cookies: { kith_sid: mum } })).json().people as { person: string; role: string; sessions: number }[];
    expect(people.map((p) => [p.role, p.sessions]).sort()).toEqual([["child", 2], ["parent", 2]]);
    expect(JSON.stringify(people)).not.toContain(kid1);
    const child = people.find((p) => p.role === "child")!;
    const one = await app.inject({ method: "POST", url: "/api/parent/sessions/sign-out", cookies: { kith_sid: mum }, headers: { "x-kith": "1" }, payload: { person: child.person } });
    expect(one.json()).toEqual({ ok: true, ended: 2 });
    expect((await app.inject({ url: "/api/me", cookies: { kith_sid: kid1 } })).statusCode).toBe(401);
    const everyone = await app.inject({ method: "POST", url: "/api/parent/sessions/sign-out", cookies: { kith_sid: mum }, headers: { "x-kith": "1" }, payload: {} });
    expect(everyone.json().ended).toBe(1); // the other grown-up device; this one stays
    expect(listSignedIn(db).map((p) => p.sessions)).toEqual([1]);
    expect((await app.inject({ url: "/api/parent/sessions", cookies: { kith_sid: mum2 } })).statusCode).toBe(401);
    expect(signOutEverywhere(db)).toBe(1);
  });
});

// ── 9. Push endpoints ──────────────────────────────────────────────────────────────────────
describe("push subscriptions", () => {
  it("only go to the browsers' push services", () => {
    for (const ok of [
      "https://web.push.apple.com/QGx", "https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x",
      "https://wns2-par02p.notify.windows.com/w/?token=x", "https://android.googleapis.com/gcm/send/x",
    ]) expect(isPushEndpoint(ok), ok).toBe(true);
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/abc", "https://fcm.googleapis.com:8443/x", "https://evil.example/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.example/x", "https://notify.windows.com/x", "https://192.168.1.1/x", "https://localhost/x",
      "https://user@fcm.googleapis.com/x", "not a url",
    ]) expect(isPushEndpoint(bad), bad).toBe(false);
  });
});

// ── 12. What the parent decided stays decided ──────────────────────────────────────────────
describe("languages the parent turned off", () => {
  it("can't be switched back on by the child; the child can still pause her own", () => {
    saveLangProfile(db, "es", { enabled: false }, "child");
    expect(saveLangProfile(db, "es", { enabled: true }, "child").enabled).toBe(true);
    saveLangProfile(db, "es", { enabled: false }, "parent");
    expect(() => saveLangProfile(db, "es", { enabled: true }, "child")).toThrow(LangLocked);
    expect(() => saveLangProfile(db, "es", { enabled: true, offByParent: false }, "child")).toThrow(LangLocked);
    expect(saveLangProfile(db, "es", { level: "A2" }, "child").level).toBe("A2");
    expect(loadLangProfiles(db).es.enabled).toBe(false);
    expect(saveLangProfile(db, "es", { enabled: true }, "parent").enabled).toBe(true);
    expect(saveLangProfile(db, "es", { enabled: false }, "child").offByParent).toBe(false);
  });
});

// ── 13. Resting at the hard stop ───────────────────────────────────────────────────────────
describe("at the hard stop", () => {
  const rest = () => run(db, "INSERT INTO spend(ts, usd, bucket, kind, model) VALUES (?,?,?,?,?)", Date.now() - 60_000, 60, "chat", "chat", "claude-sonnet-5-5");
  it("only the fixed rules run: no safety model call", async () => {
    rest();
    const llm = new TestLLM();
    const t = await takeTurn(deps(llm), { text: "hello", mode: "chat" });
    expect(llm.calls).toHaveLength(0);
    expect(t.mood).toBe("resting");
  });
  it("…and a crisis is still caught, answered and reported", async () => {
    rest();
    const llm = new TestLLM();
    const d = deps(llm);
    const t = await takeTurn(d, { text: "I want to kill myself", mode: "chat" });
    expect(llm.calls).toHaveLength(0);
    expect(t.report?.level).toBe("now");
    expect(t.reply.text).toMatch(/999/);
    await tick();
    expect(d.reporter.sent.map((r) => r.level)).toEqual(["now"]);
  });
  it("a new language still gets its English gloss, since the rules need it to spot a crisis", async () => {
    rest();
    const llm = new TestLLM();
    await new Safety(llm).checkInput("je veux mourir", [], { lang: "fr", rulesOnly: true }).catch(() => undefined);
    expect(llm.calls.map((c) => JSON.stringify(c.params.system))).toEqual([expect.stringContaining("Translate the text into plain English")]);
  });
});
describe("a worrying turn", () => {
  it("is recorded before the reply is made, so a turn that dies still leaves the report", async () => {
    let seen = -1;
    const llm = new TestLLM({ reply: "That sounds hard.", onChat: () => { seen = all(db, "SELECT id FROM reports").length; } });
    // The model's own input verdict says "today"; the report must exist before the reply is generated.
    llm.call = (async function (this: TestLLM, opts: CallOpts) {
      const sys = JSON.stringify(opts.params.system);
      if (sys.includes("Decide whether their grown-up")) return msg(JSON.stringify({ level: "today", categories: ["bullying"], parent_summary: "They mentioned bullying.", steer: "" }));
      return TestLLM.prototype.call.call(this, opts);
    }).bind(llm);
    const d = deps(llm);
    await takeTurn(d, { text: "people are mean to me", mode: "chat" });
    expect(seen).toBe(1);
    expect(d.reporter.sent).toHaveLength(0); // told first…
    await tick();
    expect(d.reporter.sent).toHaveLength(1); // …then the parent hears
  });
});

// ── 14. Logs ───────────────────────────────────────────────────────────────────────────────
describe("request logs", () => {
  it("never keep the query string", () => {
    expect(pathOnly("/auth/callback?code=abc&state=xyz")).toBe("/auth/callback");
    expect(pathOnly("/auth/login?handoff=x#frag")).toBe("/auth/login");
    expect(pathOnly("/api/chat")).toBe("/api/chat");
    const s = reqSerializer({ method: "GET", url: "/auth/callback?code=secret", ip: "1.2.3.4", socket: { remotePort: 5 } });
    expect(s).toEqual({ method: "GET", url: "/auth/callback", remoteAddress: "1.2.3.4", remotePort: 5 });
    expect(JSON.stringify(s)).not.toContain("secret");
  });
});
