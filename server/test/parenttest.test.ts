import { describe, expect, it } from "vitest";
import { openDb, all } from "../src/db.js";
import { parentTestChat } from "../src/companion/parentTest.js";
import type { LLM } from "../src/llm.js";
import type { SafetyChecker } from "../src/safety/check.js";

function fake(reply: string) {
  const calls: { params: { model: string; system: { text: string }[]; tools?: unknown; messages: unknown[] } }[] = [];
  const llm = { available: true, calls, call: async (o: never) => { calls.push(o); return { content: [{ type: "text", text: reply }], stop_reason: "end_turn", usage: {} }; } };
  return llm as unknown as LLM & { calls: typeof calls };
}
const safety = (inputLevel = "none", ok = true) => ({
  checkInput: async () => ({ level: inputLevel, categories: [], parentSummary: "", steer: "", source: "rules" }),
  checkOutput: async () => ({ ok, categories: [], reason: "" }),
}) as unknown as SafetyChecker;

describe("the parent's test chat", () => {
  it("answers through the same safeguards, without tools, and saves nothing", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO memories(ts, icon, text) VALUES (?,?,?)").run(Date.now(), "📝", "Maths mock on Friday");
    const llm = fake("Hi! Yes, I'm working.");
    const r = await parentTestChat({ db, llm, safety: safety(), childName: "Sam" }, "Are you working?");
    expect(r.reply).toBe("Hi! Yes, I'm working.");
    expect(r.model).toBe("claude-sonnet-5-5");
    expect(r.safety).toEqual({ input: "fine", output: "ok" });
    const p = llm.calls[0].params;
    expect(p.tools).toBeUndefined();
    expect(p.system[0].text.startsWith("SAFEGUARDS.")).toBe(true);
    expect(p.system.map((b) => b.text).join("\n")).not.toContain("Maths mock");
    expect(all(db, "SELECT id FROM messages")).toHaveLength(0);
    expect(all(db, "SELECT id FROM reports")).toHaveLength(0);
  });
  it("shows when the safety check would step in", async () => {
    const db = openDb(":memory:");
    const r = await parentTestChat({ db, llm: fake("something unsuitable"), safety: safety("today", false), childName: "Sam" }, "test");
    expect(r.reply).toMatch(/safety check held that reply back/);
    expect(r.safety.input).toMatch(/today/);
    expect(r.safety.output).toBe("held back");
  });
});
