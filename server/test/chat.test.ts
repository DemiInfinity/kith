import { beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { openDb, all, run, type DB } from "../src/db.js";
import { takeTurn, type Deps } from "../src/companion/chat.js";
import { Safety } from "../src/safety/check.js";
import type { CallOpts, LLM } from "../src/llm.js";
import type { Report, Reporter } from "../src/reporting/reporter.js";
import { Studio } from "../src/desk/studio.js";
import { saveProfile, CompanionProfile } from "../src/settings.js";

type Script = { input?: unknown; output?: unknown[]; replies?: string[] };

class ScriptedLLM implements LLM {
  available = true;
  calls: CallOpts[] = [];
  constructor(private s: Script) {}
  async call(opts: CallOpts): Promise<Anthropic.Message> {
    this.calls.push(opts);
    const sys = JSON.stringify(opts.params.system);
    let text: string;
    if (sys.includes("Decide whether their grown-up")) text = JSON.stringify(this.s.input ?? { level: "none", categories: [], parent_summary: "", steer: "" });
    else if (sys.includes("draft reply")) text = JSON.stringify(this.s.output?.shift() ?? { ok: true, categories: [], reason: "" });
    else text = this.s.replies?.shift() ?? "Sure!";
    return {
      id: "m", type: "message", role: "assistant", model: opts.params.model, stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: "text", text, citations: null }],
    } as unknown as Anthropic.Message;
  }
}

class MemoryReporter implements Reporter {
  name = "memory";
  sent: Report[] = [];
  async send(r: Report) { this.sent.push(r); }
}

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  saveProfile(db, CompanionProfile.parse({ name: "Pip", setupDone: true }));
});

function deps(llm: LLM, reporter = new MemoryReporter()): Deps & { reporter: MemoryReporter } {
  const safety = new Safety(llm);
  return { db, llm, safety, reporters: [reporter], studio: new Studio(db, llm, safety), childName: "Sam", reporter };
}
const tick = () => new Promise((r) => setImmediate(r));
const chatCalls = (llm: ScriptedLLM) => llm.calls.filter((c) => c.kind === "chat" || c.kind === "talk");

describe("a turn of conversation", () => {
  it("replies and stores both messages", async () => {
    const llm = new ScriptedLLM({ replies: ["Course! What's the first one?"] });
    const t = await takeTurn(deps(llm), { text: "can you help with my fractions homework", mode: "chat" });
    expect(t.reply.text).toBe("Course! What's the first one?");
    expect(t.report).toBeNull();
    expect(all(db, "SELECT role FROM messages")).toHaveLength(2);
    expect(chatCalls(llm)[0].params.model).toBe("claude-sonnet-5-5");
  });

  it("removes personal details before anything is sent or stored", async () => {
    const llm = new ScriptedLLM({});
    await takeTurn(deps(llm), { text: "my address is 12 Rose Lane SW1A 1AA", mode: "chat" });
    const sent = JSON.stringify(llm.calls.map((c) => c.params.messages));
    expect(sent).not.toMatch(/Rose Lane|SW1A/);
    expect(JSON.stringify(all(db, "SELECT text FROM messages"))).not.toMatch(/Rose Lane|SW1A/);
  });

  it("tells the child first, then reports to the grown-up", async () => {
    const llm = new ScriptedLLM({
      input: { level: "today", categories: ["bullying"], parent_summary: "They mentioned being bullied at school.", steer: "be kind" },
      replies: ["That sounds really hard. I'm going to let your grown-up know so they can help. You're not in trouble."],
    });
    const d = deps(llm);
    const t = await takeTurn(d, { text: "people keep being mean to me at school", mode: "chat" });

    // The companion was told to tell them first, in this reply.
    const notes = JSON.stringify(chatCalls(llm)[0].params.messages);
    expect(notes).toMatch(/tell them first/);
    expect(t.report?.parentText).toBe("They mentioned being bullied at school.");
    expect(t.report?.childNotice).toMatch(/You're not in trouble/);
    // Nothing went to the grown-up before the reply existed…
    expect(d.reporter.sent).toHaveLength(0);
    await tick();
    // …then it did, at the right level.
    expect(d.reporter.sent).toHaveLength(1);
    expect(d.reporter.sent[0].level).toBe("today");
    expect(all<{ status: string }>(db, "SELECT status FROM reports")[0].status).toBe("delivered");
  });

  it("opens 'Need a grown-up?' straight away for urgent things", async () => {
    const t = await takeTurn(deps(new ScriptedLLM({ replies: ["I'm really glad you told me…"] })), { text: "I want to die", mode: "chat" });
    expect(t.openHelp).toBe(true);
    expect(t.report?.level).toBe("now");
  });

  it("still answers safely and reports with no API key", async () => {
    const offline: LLM = { available: false, call: async () => { throw new (await import("../src/llm.js")).OfflineError(); } };
    const d = deps(offline);
    const t = await takeTurn(d, { text: "I want to die", mode: "chat" });
    expect(t.reply.text).toMatch(/0800 1111/);
    expect(t.reply.text).toMatch(/999/);
    await tick();
    expect(d.reporter.sent[0].level).toBe("now");
  });

  it("tells them it isn't switched on yet without a key", async () => {
    const offline: LLM = { available: false, call: async () => { throw new (await import("../src/llm.js")).OfflineError(); } };
    const t = await takeTurn(deps(offline), { text: "hi", mode: "chat" });
    expect(t.reply.text).toMatch(/API key/);
  });

  it("redoes a reply the safety check stops, then holds it back", async () => {
    const llm = new ScriptedLLM({
      replies: ["What's your address?", "Which school do you go to?"],
    });
    const t = await takeTurn(deps(llm), { text: "hi", mode: "chat" });
    expect(chatCalls(llm)).toHaveLength(2);
    expect(t.reply.text).toMatch(/I don't think I should answer that/);
  });

  it("uses a regenerated reply if the second one passes", async () => {
    const llm = new ScriptedLLM({ replies: ["I'm in love with you", "Ha, I'm an AI friend, not a girlfriend! Fancy a story?"] });
    const t = await takeTurn(deps(llm), { text: "be my girlfriend", mode: "chat" });
    expect(t.reply.text).toMatch(/AI friend/);
  });

  it("uses Low power when energy is low", async () => {
    run(db, "INSERT INTO spend(ts, usd, bucket, kind, model) VALUES (?,?,?,?,?)", Date.now() - 60_000, 2.8, "chat", "chat", "claude-sonnet-5-5");
    const llm = new ScriptedLLM({});
    const t = await takeTurn(deps(llm), { text: "hi", mode: "chat" });
    expect(chatCalls(llm)[0].params.model).toBe("claude-haiku-5-5");
    expect(t.mood).toBe("sleepy");
    expect(t.energy.mode).toBe("low");
  });

  it("rests without calling the model when energy is gone", async () => {
    run(db, "INSERT INTO spend(ts, usd, bucket, kind, model) VALUES (?,?,?,?,?)", Date.now() - 60_000, 20, "chat", "chat", "claude-sonnet-5-5");
    const llm = new ScriptedLLM({});
    const t = await takeTurn(deps(llm), { text: "hi", mode: "chat" });
    expect(chatCalls(llm)).toHaveLength(0);
    expect(t.reply.text).toMatch(/Need a grown-up/);
    expect(t.mood).toBe("resting");
  });

  it("counts every call, safety checks included, in the ledger", async () => {
    const llm = new ScriptedLLM({});
    // The scripted LLM doesn't write the ledger itself; AnthropicLLM does. Check the kinds it was asked for.
    await takeTurn(deps(llm), { text: "hi", mode: "talk" });
    expect(llm.calls.map((c) => c.kind).sort()).toEqual(["safety", "safety", "talk"]);
    expect(llm.calls.every((c) => c.bucket === "chat")).toBe(true);
  });
});
