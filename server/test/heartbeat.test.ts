import { describe, expect, it } from "vitest";
import { openDb, all, type DB } from "../src/db.js";
import { heartbeat, heartbeatStatus } from "../src/companion/heartbeat.js";
import { loadProfile, saveProfile } from "../src/settings.js";
import type { LLM } from "../src/llm.js";
import type { SafetyChecker } from "../src/safety/check.js";

const NOON = Date.UTC(2026, 10, 25, 12, 0); // midday in London: outside quiet hours
const NIGHT = Date.UTC(2026, 10, 25, 23, 30);
const okSafety = { checkOutput: async () => ({ ok: true, categories: [], reason: "" }) } as unknown as SafetyChecker;
function fakeLLM(decision: object, available = true) {
  const calls: unknown[] = [];
  const llm = { available, calls, call: async (o: unknown) => { calls.push(o); return { content: [{ type: "text", text: JSON.stringify(decision) }], stop_reason: "end_turn", usage: {} }; } };
  return llm as unknown as LLM & { calls: unknown[] };
}
function setup(): DB {
  const db = openDb(":memory:");
  saveProfile(db, { ...loadProfile(db), setupDone: true });
  return db;
}
const deps = (db: DB, llm: LLM) => ({ db, llm, safety: okSafety, deskCanWork: () => true });

describe("the heartbeat", () => {
  it("always beats, every 30 minutes", async () => {
    const db = setup();
    const llm = fakeLLM({ action: "nothing", message: "", why: "all quiet" });
    expect(await heartbeat(deps(db, llm), NOON)).toBe("quiet");
    expect(await heartbeat(deps(db, llm), NOON + 10 * 60_000)).toBeNull();
    expect(await heartbeat(deps(db, llm), NOON + 30 * 60_000)).not.toBeNull();
    expect(heartbeatStatus(db, NOON + 30 * 60_000).everyMinutes).toBe(30);
  });
  it("in quiet hours it beats asleep, without asking Claude", async () => {
    const db = setup();
    const llm = fakeLLM({ action: "checkin", message: "hi", why: "x" });
    expect(await heartbeat(deps(db, llm), NIGHT)).toBe("asleep");
    expect(llm.calls).toHaveLength(0);
  });
  it("rests without an API key", async () => {
    const db = setup();
    expect(await heartbeat(deps(db, fakeLLM({}, false)), NOON)).toBe("resting");
  });
  it("can send a gentle check-in, which shows in chat", async () => {
    const db = setup();
    const llm = fakeLLM({ action: "checkin", message: "Your maths mock is on Friday. Fancy a quick quiz later? No rush.", why: "maths mock on Friday" });
    expect(await heartbeat(deps(db, llm), NOON)).toBe("checked in");
    expect(all<{ text: string }>(db, "SELECT text FROM messages WHERE role = 'companion'")[0].text).toMatch(/maths mock/);
    expect(heartbeatStatus(db, NOON).last?.note).toBe("maths mock on Friday");
  });
  it("holds a check-in back when today's check-ins are used up", async () => {
    const db = setup();
    for (let i = 0; i < 2; i++) db.prepare("INSERT INTO checkins(ts, kind, text, delivered) VALUES (?,?,?,?)").run(NOON - 60_000 * (i + 1), "x", "x", 0);
    const llm = fakeLLM({ action: "checkin", message: "Hello!", why: "just because" });
    expect(await heartbeat(deps(db, llm), NOON)).toBe("quiet");
    expect(all(db, "SELECT id FROM messages")).toHaveLength(0);
  });
  it("doesn't ask Claude again when nothing has changed", async () => {
    const db = setup();
    const llm = fakeLLM({ action: "nothing", message: "", why: "all quiet" });
    await heartbeat(deps(db, llm), NOON);
    await heartbeat(deps(db, llm), NOON + 30 * 60_000);
    expect(llm.calls).toHaveLength(1);
  });
});
