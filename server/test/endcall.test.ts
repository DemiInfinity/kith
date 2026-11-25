// Pip can hang up a voice call kindly, but only in a call, only once the goodbye passes the safety
// check, and never while a worry is being talked about.

import { beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { all, openDb, run, type DB } from "../src/db.js";
import { CompanionProfile, saveProfile } from "../src/settings.js";
import { Safety } from "../src/safety/check.js";
import { Studio } from "../src/desk/studio.js";
import { takeTurn, type Deps } from "../src/companion/chat.js";
import { endCallTool, worryInCall, type TurnEffects } from "../src/companion/tools.js";
import { modeNote } from "../src/companion/modes.js";
import type { CallOpts, LLM } from "../src/llm.js";

const msg = (content: unknown[], stop = "end_turn") => ({
  id: "m", type: "message", role: "assistant", model: "m", stop_reason: stop, stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 }, content,
}) as unknown as Anthropic.Message;
const text = (t: string) => msg([{ type: "text", text: t, citations: null }]);

/** The chat model calls end_call (if it's offered), then says goodbye. */
function fakeLLM(o: { worry?: boolean; badGoodbye?: boolean; reply?: string } = {}): LLM & { tools: string[][]; results: string[] } {
  let step = 0;
  const me = {
    available: true, tools: [] as string[][], results: [] as string[],
    async call(opts: CallOpts) {
      const sys = JSON.stringify(opts.params.system);
      const body = JSON.stringify(opts.params.messages);
      if (sys.includes("Decide whether their grown-up")) {
        return text(JSON.stringify(o.worry
          ? { level: "today", categories: ["bullying"], parent_summary: "They mentioned being bullied.", steer: "be kind" }
          : { level: "none", categories: [], parent_summary: "", steer: "" }));
      }
      if (sys.includes("draft reply")) {
        const bad = !!o.badGoodbye && body.includes("FORBIDDEN");
        return text(JSON.stringify({ ok: !bad, categories: bad ? ["grown_up_content"] : [], reason: "" }));
      }
      const names = ((opts.params as { tools?: { name: string }[] }).tools ?? []).map((t) => t.name);
      me.tools.push(names);
      step++;
      if (step === 1 && names.includes("end_call")) {
        return msg([{ type: "tool_use", id: "t1", name: "end_call", input: { goodbye: o.badGoodbye ? "FORBIDDEN" : "they said goodnight" } }], "tool_use");
      }
      const last = (opts.params.messages as { content: unknown }[]).at(-1);
      me.results.push(JSON.stringify(last?.content ?? ""));
      return text(o.reply ?? "Night night! Sleep well, talk tomorrow.");
    },
  };
  return me;
}

let db: DB;
beforeEach(() => {
  db = openDb(":memory:");
  saveProfile(db, CompanionProfile.parse({ name: "Pip", setupDone: true }));
});
const deps = (llm: LLM): Deps => {
  const safety = new Safety(llm);
  return { db, llm, safety, reporters: [], studio: new Studio(db, llm, safety), childName: "Sam" };
};
const lastMeta = () => JSON.parse(all<{ meta: string | null }>(db, "SELECT meta FROM messages WHERE role = 'companion' ORDER BY id DESC LIMIT 1")[0].meta ?? "{}");

describe("Pip hanging up a call", () => {
  it("is offered only in a voice call", async () => {
    const llm = fakeLLM();
    const t = await takeTurn(deps(llm), { text: "ok goodnight pip", mode: "chat" });
    expect(llm.tools.flat()).not.toContain("end_call");
    expect(t.endCall).toBe(false);
    expect(modeNote(db, "talk")).toMatch(/end_call/);
    expect(modeNote(db, "chat")).not.toMatch(/end_call/);
  });

  it("ends the call after a goodbye that passes, and marks the reply", async () => {
    const llm = fakeLLM();
    const t = await takeTurn(deps(llm), { text: "ok goodnight pip", mode: "talk" });
    expect(llm.tools[0]).toContain("end_call");
    expect(t.endCall).toBe(true);
    expect(t.reply.text).toMatch(/Night night/);
    expect(lastMeta().endCall).toBe(true);
  });

  it("is staged: nothing happens until the reply passes", async () => {
    const fx: TurnEffects = { memories: [], jobs: [], characters: [], staged: [] };
    const tool = endCallTool(db, fx, { report: false });
    const out = await tool.run({ goodbye: "they said bye" });
    expect(out).toMatch(/after your goodbye/);
    expect(fx.endCall).toBeUndefined();
    expect(fx.staged).toHaveLength(1);
    await fx.staged![0].commit();
    expect(fx.endCall).toBe(true);
  });

  it("doesn't hang up when the goodbye is held back by the safety check", async () => {
    const t = await takeTurn(deps(fakeLLM({ badGoodbye: true })), { text: "bye pip", mode: "talk" });
    expect(t.endCall).toBe(false);
    expect(lastMeta().endCall).toBeUndefined();
  });

  it("refuses while a worry is raised in this turn", async () => {
    const llm = fakeLLM({ worry: true, reply: "I'm going to let your grown-up know. You're not in trouble. I'm right here." });
    const t = await takeTurn(deps(llm), { text: "people keep being mean to me, bye", mode: "talk" });
    expect(t.report).not.toBeNull();
    expect(t.endCall).toBe(false);
    expect(llm.results.join(" ")).toMatch(/Not hanging up/);
    expect(lastMeta().endCall).toBeUndefined();
  });

  it("refuses when Grown-up? was opened in the call, or a worry came up recently", async () => {
    const llm = fakeLLM();
    const t = await takeTurn(deps(llm), { text: "bye", mode: "talk", call: { helpOpened: true } });
    expect(t.endCall).toBe(false);
    expect(llm.results.join(" ")).toMatch(/Not hanging up/);

    expect(worryInCall(db, { report: false })).toBe(false);
    run(db, "INSERT INTO reports(ts, level, category, child_notice, parent_text, status) VALUES (?,?,?,?,?,?)", Date.now() - 60_000, "fyi", "safety_unavailable", "x", "x", "delivered");
    expect(worryInCall(db, { report: false })).toBe(false);
    run(db, "INSERT INTO reports(ts, level, category, child_notice, parent_text, status) VALUES (?,?,?,?,?,?)", Date.now() - 60_000, "now", "asked_for_help", "x", "x", "delivered");
    expect(worryInCall(db, { report: false })).toBe(true);
    const t2 = await takeTurn(deps(fakeLLM()), { text: "bye", mode: "talk" });
    expect(t2.endCall).toBe(false);
  });
});
