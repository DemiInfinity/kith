// The Mac app's server side (src/native.ts): notifications inbox, shared Calendar & Reminders,
// things Pip asks to add, and documents shared into a chat turn.

import { beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import Fastify from "fastify";
import { openDb, all, type DB } from "../src/db.js";
import { takeTurn, type Deps } from "../src/companion/chat.js";
import { Safety } from "../src/safety/check.js";
import type { CallOpts, LLM } from "../src/llm.js";
import { Studio } from "../src/desk/studio.js";
import { saveProfile, CompanionProfile, loadProfile } from "../src/settings.js";
import { pushToChild } from "../src/checkins/push.js";
import {
  calendarNote, clearCalendar, finishAction, inboxAfter, nativeTools, pendingActions, recordNative, registerNative, saveCalendar, sharedCalendar,
} from "../src/native.js";

class ScriptedLLM implements LLM {
  available = true;
  calls: CallOpts[] = [];
  async call(opts: CallOpts): Promise<Anthropic.Message> {
    this.calls.push(opts);
    const sys = JSON.stringify(opts.params.system);
    const text = sys.includes("Decide whether their grown-up")
      ? JSON.stringify({ level: "none", categories: [], parent_summary: "", steer: "" })
      : sys.includes("draft reply") ? JSON.stringify({ ok: true, categories: [], reason: "" }) : "Looks good!";
    return {
      id: "m", type: "message", role: "assistant", model: opts.params.model, stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: "text", text, citations: null }],
    } as unknown as Anthropic.Message;
  }
}

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  saveProfile(db, CompanionProfile.parse({ name: "Pip", setupDone: true }));
});

function deps(llm: LLM): Deps {
  const safety = new Safety(llm);
  return { db, llm, safety, reporters: [], studio: new Studio(db, llm, safety), childName: "Sam" };
}

const HOUR = 3_600_000;
const snap = (now = Date.now()) => ({
  events: [{ title: "Maths test, call 07700 900123", start: now + 2 * HOUR, end: now + 3 * HOUR, allDay: false, calendar: "School" }],
  reminders: [{ title: "Hand in English essay", due: now + 24 * HOUR, list: "Homework" }],
});

describe("notifications for the Mac app", () => {
  it("the first poll only learns where the inbox is up to; later polls get what's new", () => {
    recordNative(db, { title: "Old", body: "before the app opened" }, "checkins");
    const first = inboxAfter(db, null);
    expect(first.items).toEqual([]);
    recordNative(db, { title: "Pip", body: "How did the test go?" }, "checkins");
    const next = inboxAfter(db, first.last);
    expect(next.items.map((i) => i.body)).toEqual(["How did the test go?"]);
    expect(inboxAfter(db, next.last).items).toEqual([]);
  });

  it("pushToChild records for the Mac app even without web push keys, and respects her choices", async () => {
    await pushToChild(db, { title: "Pip", body: "Revision time" }, "reminders");
    expect(inboxAfter(db, 0).items.map((i) => i.body)).toEqual(["Revision time"]);
    const p = loadProfile(db);
    saveProfile(db, { ...p, notifications: { ...p.notifications, checkins: false } });
    await pushToChild(db, { title: "Pip", body: "Just checking in" }, "checkins");
    expect(inboxAfter(db, 0).items).toHaveLength(1);
  });
});

describe("shared Calendar & Reminders", () => {
  it("is redacted, goes in the prompt, is logged for the parent, and stops when cleared", () => {
    expect(calendarNote(db)).toBe("");
    expect(nativeTools(db)).toEqual([]);
    saveCalendar(db, snap());
    const shared = sharedCalendar(db)!;
    expect(shared.events[0].title).not.toContain("07700 900123");
    const note = calendarNote(db, "Europe/London");
    expect(note).toContain("Maths test");
    expect(note).toContain("Hand in English essay");
    expect(nativeTools(db).map((t) => t.name)).toEqual(["add_calendar_event", "add_reminder"]);
    clearCalendar(db);
    expect(calendarNote(db)).toBe("");
    const log = all<{ text: string }>(db, "SELECT text FROM desk_activity").map((r) => r.text).join("\n");
    expect(log).toContain("Shared their Calendar and Reminders");
    expect(log).toContain("Stopped sharing");
  });

  it("a day-old snapshot isn't used", () => {
    const old = Date.now() - 25 * HOUR;
    saveCalendar(db, snap(old), old);
    expect(sharedCalendar(db)).toBeNull();
  });

  it("Pip's additions wait for her yes on the Mac; at most five wait at once", async () => {
    saveCalendar(db, snap());
    const [addEvent, addReminder] = nativeTools(db, "Europe/London");
    const future = new Date(Date.now() + 48 * HOUR).toISOString().slice(0, 10);
    expect(await addEvent.run({ title: "Revise fractions", start: `${future}T16:00`, end: `${future}T17:00` })).toContain("confirm");
    expect(await addReminder.run({ title: "Pack PE kit", due: "" })).toContain("confirm");
    const acts = pendingActions(db);
    expect(acts.map((a) => a.kind)).toEqual(["event", "reminder"]);
    expect(acts[0]).toMatchObject({ title: "Revise fractions", allDay: false });
    finishAction(db, acts[0].id, "added");
    expect(pendingActions(db)).toHaveLength(1);
    for (let i = 0; i < 4; i++) await addReminder.run({ title: `Thing ${i}`, due: "" });
    expect(await addReminder.run({ title: "One too many", due: "" })).toContain("catch up");
    expect(await addEvent.run({ title: "Yesterday", start: "2020-01-01T10:00", end: "" })).toContain("already gone");
    clearCalendar(db);
    expect(pendingActions(db)).toEqual([]);
  });
});

describe("a chat turn", () => {
  it("a shared document is safety-checked, shown to Pip for this turn, and stored as its name", async () => {
    const llm = new ScriptedLLM();
    saveCalendar(db, snap());
    const turn = await takeTurn(deps(llm), { text: "Can you check my essay?", mode: "chat", file: { name: "essay.docx", text: "The Victorians built railways." } });
    expect(turn.child.text).toBe("Can you check my essay?\n\n📄 essay.docx");
    const safetyCall = llm.calls.find((c) => JSON.stringify(c.params.system).includes("Decide whether their grown-up"))!;
    expect(JSON.stringify(safetyCall.params.messages)).toContain("The Victorians built railways.");
    const chat = llm.calls.find((c) => c.kind === "chat")!.params as unknown as { system: { text: string }[]; tools: { name: string }[]; messages: { role: string; content: unknown }[] };
    const last = chat.messages[chat.messages.length - 1];
    expect(last.content).toEqual([
      { type: "document", source: { type: "text", media_type: "text/plain", data: "The Victorians built railways." }, title: "essay.docx" },
      { type: "text", text: "Can you check my essay?" },
    ]);
    expect(chat.system.map((b) => b.text).join("\n")).toContain("Maths test");
    expect(chat.tools.map((t) => t.name)).toContain("add_calendar_event");
  });
});

describe("routes", () => {
  it("are for the child only", async () => {
    const app = Fastify();
    let role: string | null = "parent";
    app.addHook("onRequest", async (req) => { (req as unknown as { user: unknown }).user = role ? { role } : undefined; });
    registerNative(app, db);
    expect((await app.inject({ method: "GET", url: "/api/native/inbox" })).statusCode).toBe(403);
    role = "child";
    const r = await app.inject({ method: "GET", url: "/api/native/inbox" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ items: [], last: 0 });
    expect((await app.inject({ method: "PUT", url: "/api/native/calendar", payload: snap() })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/api/native/calendar", payload: { events: "nope" } })).statusCode).toBe(500);
    expect((await app.inject({ method: "DELETE", url: "/api/native/calendar" })).statusCode).toBe(200);
    expect(sharedCalendar(db)).toBeNull();
  });
});
