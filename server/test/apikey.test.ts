import { beforeAll, describe, expect, it } from "vitest";
import { openDb, get } from "../src/db.js";
import { config } from "../src/config.js";
import { checkKey, currentKey, keyStatus, looksLikeKey, removeKey, saveKey } from "../src/apikey.js";

const KEY = "sk-ant-api03-" + "x".repeat(40) + "WXYZ";
beforeAll(() => { process.env.KITH_SECRET_KEY = "a".repeat(64); config.anthropic.apiKey = ""; });

describe("the Anthropic key set in the parent view", () => {
  it("is stored encrypted, and only its last four characters are ever shown", () => {
    const db = openDb(":memory:");
    expect(keyStatus(db)).toMatchObject({ set: false, source: "none" });
    saveKey(db, KEY);
    const raw = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'anthropic_key'")!.json;
    expect(raw).not.toContain("sk-ant");
    expect(currentKey(db)).toEqual({ key: KEY, source: "parent view" });
    expect(keyStatus(db)).toEqual({ set: true, source: "parent view", hint: "…WXYZ", canStore: true });
  });
  it("takes priority over the environment, and removing it falls back", () => {
    const db = openDb(":memory:");
    config.anthropic.apiKey = "sk-ant-env-" + "y".repeat(30) + "ENV1";
    saveKey(db, KEY);
    expect(currentKey(db).source).toBe("parent view");
    removeKey(db);
    expect(currentKey(db)).toMatchObject({ source: "environment" });
    expect(keyStatus(db).hint).toBe("…ENV1");
    config.anthropic.apiKey = "";
  });
  it("checks the shape and asks Anthropic before saving", async () => {
    expect(looksLikeKey(KEY)).toBe(true);
    expect(looksLikeKey("hello")).toBe(false);
    const ok = () => ({ models: { list: async () => ({}) } }) as never;
    const bad = () => ({ models: { list: async () => { throw Object.assign(new Error("no"), { status: 401 }); } } }) as never;
    expect(await checkKey(KEY, ok)).toBeNull();
    expect(await checkKey(KEY, bad)).toMatch(/didn’t accept/);
  });
});
