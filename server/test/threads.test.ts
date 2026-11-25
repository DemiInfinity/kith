import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { all, openDb } from "../src/db.js";
import { config } from "../src/config.js";
import { takeTurn, recentMessages } from "../src/companion/chat.js";
import { createThread, listThreads, MAIN_THREAD, updateThread } from "../src/companion/threads.js";
import { listHistory, purgeHistory, readHistory, searchHistory, writeHistory } from "../src/companion/history.js";
import { loadRolling } from "../src/companion/context.js";
import { Safety } from "../src/safety/check.js";
import { Studio } from "../src/desk/studio.js";
import type { CallOpts, LLM } from "../src/llm.js";
import { CompanionProfile, saveProfile } from "../src/settings.js";

class Scripted implements LLM {
  available = true;
  calls: CallOpts[] = [];
  async call(opts: CallOpts): Promise<Anthropic.Message> {
    this.calls.push(opts);
    const sys = JSON.stringify(opts.params.system);
    const text = sys.includes("Decide whether their grown-up") ? JSON.stringify({ level: "none", categories: [], parent_summary: "", steer: "" })
      : sys.includes("draft reply") ? JSON.stringify({ ok: true, categories: [], reason: "" })
      : sys.includes("running summary") ? "They talked about the dragon story and fractions."
      : "Okay!";
    return { id: "m", type: "message", role: "assistant", model: opts.params.model, stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text, citations: null }] } as unknown as Anthropic.Message;
  }
}

function setup() {
  const db = openDb(":memory:");
  saveProfile(db, CompanionProfile.parse({ setupDone: true }));
  const llm = new Scripted();
  const safety = new Safety(llm);
  return { db, llm, deps: { db, llm, safety, reporters: [], studio: new Studio(db, llm, safety), childName: "Sam" } };
}

describe("side chats", () => {
  it("keep their own messages, and the main chat can't be archived", async () => {
    const { db, deps } = setup();
    await takeTurn(deps, { text: "hi", mode: "chat" });
    const side = createThread(db, { fromText: "Let's plan the Lantern Keepers map" });
    await takeTurn(deps, { text: "where should the lighthouse go?", mode: "chat", thread: side.id });
    expect(recentMessages(db, 50, MAIN_THREAD)).toHaveLength(2);
    expect(recentMessages(db, 50, side.id).map((m) => m.text)).toContain("where should the lighthouse go?");
    expect(listThreads(db).map((t) => t.id)).toEqual(expect.arrayContaining([1, side.id]));
    expect(updateThread(db, MAIN_THREAD, { archived: true })).toBe(false);
  });
  it("tell the companion what the side chat split off from", async () => {
    const { db, llm, deps } = setup();
    const side = createThread(db, { fromText: "Let's plan the Lantern Keepers map" });
    await takeTurn(deps, { text: "go on", mode: "chat", thread: side.id });
    const sys = JSON.stringify(llm.calls.find((c) => c.kind === "chat")!.params.system);
    expect(sys).toContain("side chat");
    expect(sys).toContain("Lantern Keepers map");
  });
});

describe("the compactor and the history archive", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kith-hist-"));
  const old = config.dataDir;

  it("folds long chats into a summary and archives the full text as Markdown", async () => {
    config.dataDir = base;
    const { db, llm, deps } = setup();
    const long = "The dragon story needs a lighthouse scene. ".repeat(120);
    for (let i = 0; i < 10; i++) await takeTurn(deps, { text: `${long} part ${i}`, mode: "chat" });
    expect(loadRolling(db, MAIN_THREAD)?.text).toContain("dragon story");
    const files = listHistory(base);
    expect(files.length).toBeGreaterThan(0);
    const md = readHistory(files[0].file, base)!;
    expect(md).toMatch(/^# Chat: /);
    expect(md).toContain("> In short: They talked about the dragon story");
    expect(md).toContain("**Sam**");
    // Each turn's input stays bounded: the latest chat call doesn't carry every message.
    const lastChat = llm.calls.filter((c) => c.kind === "chat").at(-1)!;
    expect((lastChat.params.messages as unknown[]).length).toBeLessThan(12);
    config.dataDir = old;
    void all;
  });

  it("finds things when asked to recall, and nothing otherwise", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kith-hist2-"));
    writeHistory({ thread: 1, threadTitle: "Chat", companionName: "Pip", childName: "Sam", summary: "Revision.", messages: [
      { id: 1, ts: Date.parse("2026-11-10T16:00:00Z"), role: "child", text: "my biology mock is about osmosis and diffusion" },
      { id: 2, ts: Date.parse("2026-11-10T16:01:00Z"), role: "companion", text: "Osmosis is water moving through a membrane." },
    ] }, dir);
    expect(searchHistory("what did we say about osmosis", dir)[0].excerpt).toContain("osmosis");
    expect(searchHistory("volcanoes", dir)).toEqual([]);
  });

  it("refuses path tricks and is deleted with chats", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kith-hist3-"));
    expect(readHistory("../../etc/passwd", dir)).toBeNull();
    writeHistory({ thread: 1, threadTitle: "Chat", companionName: "Pip", childName: "Sam", summary: "x", messages: [{ id: 1, ts: Date.now(), role: "child", text: "hello" }] }, dir);
    expect(listHistory(dir)).toHaveLength(1);
    purgeHistory(30, Date.now() + 31 * 86_400_000, dir);
    expect(listHistory(dir)).toHaveLength(0);
  });
});
