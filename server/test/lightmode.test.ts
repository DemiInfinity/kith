import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { config } from "../src/config.js";
import { loadParentSettings, saveParentSettings } from "../src/settings.js";
import { voiceSetup } from "../src/voice/settings.js";
import { diskBlock, diskUsage, resetDiskCache } from "../src/disk.js";
import type { DeskClient } from "../src/desk/deskClient.js";

const GB = 1024 ** 3;

describe("voice settings", () => {
  it("use .env until the parent sets something, then the parent's choice", () => {
    const db = openDb(":memory:");
    expect(voiceSetup(db).sttHost).toBe(config.voice.sttHost);
    expect(voiceSetup(db).voices).toEqual(config.voice.voices);
    const s = loadParentSettings(db);
    s.voice = { sttHost: "192.168.1.20", sttPort: 10300, ttsHost: "", ttsPort: 0, whisperModel: "base-int8", voices: [{ label: "Sky", voice: "en_GB-alba-medium" }] };
    saveParentSettings(db, s);
    const v = voiceSetup(db);
    expect(v.sttHost).toBe("192.168.1.20");
    expect(v.ttsHost).toBe(config.voice.ttsHost);
    expect(v.whisperModel).toBe("base-int8");
    expect(v.voices.map((x) => x.label)).toEqual(["Sky"]);
  });
});

describe("the disk budget", () => {
  const desk = (items: number) => ({ usage: async () => ({ items, trash: 0, screenshots: 0, browser: 0, total: items, capItems: 5 * GB }) }) as unknown as DeskClient;
  it("lets desk work start under budget", async () => {
    resetDiskCache();
    const u = await diskUsage(openDb(":memory:"), desk(1 * GB), true);
    expect(u.totalCap).toBe(15 * GB);
    expect(diskBlock(u)).toBeNull();
  });
  it("stops new desk work when the desk files reach their cap, or the total its budget", async () => {
    const db = openDb(":memory:");
    expect(diskBlock(await diskUsage(db, desk(5 * GB), true))).toMatch(/desk is full/);
    const s = loadParentSettings(db);
    s.disk = { totalGb: 2, deskGb: 5, keepDays: 7 };
    saveParentSettings(db, s);
    expect(diskBlock(await diskUsage(db, desk(3 * GB), true))).toMatch(/all the disk space/);
  });
  it("still works when the desk can't be reached", async () => {
    const down = { usage: async () => { throw new Error("asleep"); } } as unknown as DeskClient;
    const u = await diskUsage(openDb(":memory:"), down, true);
    expect(u.desk).toBeNull();
    expect(diskBlock(u)).toBeNull();
  });
});
