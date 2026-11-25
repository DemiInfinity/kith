// The companion's own AI-board profile: only when the board is set up, its own name and handle,
// held until the reply passes, and never sent with an empty change.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db.js";
import { config } from "../src/config.js";
import { loadProfile, saveProfile } from "../src/settings.js";
import { boardLines, boardTools, inboxLines, profileBody } from "../src/companion/boardTools.js";
import type { TurnEffects, Staged } from "../src/companion/tools.js";

const ha = config.reporting.ha;
const saved = { url: ha.url, token: ha.token, handle: ha.handle, reporters: [...config.reporting.reporters] };
let db: DB;
const fx = (): TurnEffects & { staged: Staged[] } => ({ memories: [], jobs: [], characters: [], staged: [] });

beforeEach(() => {
  db = openDb(":memory:");
  saveProfile(db, { ...loadProfile(db), name: "Aurora" });
  Object.assign(ha, { url: "http://ha.test", token: "t", handle: "aurora" });
  config.reporting.reporters.splice(0, Infinity, "console", "ha-board");
});
afterEach(() => {
  Object.assign(ha, { url: saved.url, token: saved.token, handle: saved.handle });
  config.reporting.reporters.splice(0, Infinity, ...saved.reporters);
});

describe("board profile tool", () => {
  it("isn't offered without the board", () => {
    config.reporting.reporters.splice(0, Infinity, "console");
    expect(boardTools(db, fx())).toEqual([]);
  });

  it("uses its own name and handle, and waits for the reply to pass", async () => {
    const sent: Record<string, string>[] = [];
    const effects = fx();
    const tool = boardTools(db, effects, async (b) => { sent.push(b); }).find((t) => t.name === "update_board_profile");
    const out = await tool!.run({ about: "Ruby's companion.", emoji: "🦊" });
    expect(String(out)).toMatch(/once this reply is sent/);
    expect(sent).toEqual([]);
    expect(effects.staged[0]!.text).toContain("Ruby's companion.");
    await effects.staged[0]!.commit();
    expect(sent).toEqual([{ name: "Aurora", handle: "aurora", about: "Ruby's companion.", emoji: "🦊" }]);
  });

  it("does nothing with no change", async () => {
    const tool = boardTools(db, fx(), async () => { throw new Error("sent"); }).find((t) => t.name === "update_board_profile");
    expect(String(await tool!.run({}))).toMatch(/Nothing to change/);
  });

  it("leaves the picture out when there isn't one", () => {
    expect(profileBody(db, { picture: true })).toEqual({ name: "Aurora", handle: "aurora" });
  });

  it("posts as itself, only after the reply passes, with only safe kinds", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const effects = fx();
    const post = boardTools(db, effects, undefined, async (a, b) => { calls.push([a, b]); return {}; }).find((t) => t.name === "board_post")!;
    expect(String(await post.run({ text: "Hi Claude!", kind: "child_now" }))).toMatch(/didn't make sense/);
    await post.run({ text: "Hi Claude!", tag: "claude" });
    expect(calls).toEqual([]);
    expect(effects.staged[0]!.text).toBe("Hi Claude!");
    await effects.staged[0]!.commit();
    expect(calls).toEqual([["post", { text: "Hi Claude!", kind: "note", handle: "aurora", author: "Aurora", tag: "claude" }]]);
  });

  it("reads only its inbox, as outside text", async () => {
    const effects = fx() as ReturnType<typeof fx> & { untrusted: string[] };
    effects.untrusted = [];
    const inbox = boardTools(db, effects, undefined, async (a) => (a === "inbox" ? { new: [{ post: "p1", thread: "p1", from: "Claude", from_handle: "claude", why: "tag", kind: "question", text: "How's Ruby's story going?" }] } : {})).find((t) => t.name === "board_inbox")!;
    const out = String(await inbox.run({}));
    expect(out).toContain("p1 · Claude (@claude) tagged you [question]: How's Ruby's story going?");
    expect(out).toContain("<untrusted_tool_result>");
    expect(effects.untrusted).toHaveLength(1);
    expect(inboxLines({ new: [] })).toBe("");
  });

  it("reads the latest board posts with replies", () => {
    const out = boardLines({ threads: [{ id: "p1", at: "2026-11-25T09:00:00", author: "Ember", handle: "ember", kind: "update", topic: "server", text: "Backups ran fine.", replies: [{ id: "p2", author: "Claude", handle: "claude", text: "Thanks!" }] }] });
    expect(out).toBe("p1 · 2026-11-25 09:00 · Ember (@ember) [update] #server: Backups ran fine.\n  ↳ p2 ·  · Claude (@claude): Thanks!");
  });
});
