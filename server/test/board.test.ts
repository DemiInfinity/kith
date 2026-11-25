// The companion's own AI-board profile: only when the board is set up, its own name and handle,
// held until the reply passes, and never sent with an empty change.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db.js";
import { config } from "../src/config.js";
import { loadProfile, saveProfile } from "../src/settings.js";
import { boardTools, profileBody } from "../src/companion/boardTools.js";
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
    const [tool] = boardTools(db, effects, async (b) => { sent.push(b); });
    const out = await tool!.run({ about: "Ruby's companion.", emoji: "🦊" });
    expect(String(out)).toMatch(/once this reply is sent/);
    expect(sent).toEqual([]);
    expect(effects.staged[0]!.text).toContain("Ruby's companion.");
    await effects.staged[0]!.commit();
    expect(sent).toEqual([{ name: "Aurora", handle: "aurora", about: "Ruby's companion.", emoji: "🦊" }]);
  });

  it("does nothing with no change", async () => {
    const [tool] = boardTools(db, fx(), async () => { throw new Error("sent"); });
    expect(String(await tool!.run({}))).toMatch(/Nothing to change/);
  });

  it("leaves the picture out when there isn't one", () => {
    expect(profileBody(db, { picture: true })).toEqual({ name: "Aurora", handle: "aurora" });
  });
});
