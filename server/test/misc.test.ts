import { describe, expect, it } from "vitest";
import { planCheckin, templateText, type CheckinState } from "../src/checkins/plan.js";
import { zonedTime } from "../src/budget/time.js";
import { encodeEvent, EventParser, speakable, wav } from "../src/voice/wyoming.js";
import { calculate } from "../src/connections/calculator.js";
import { hostAllowed, isForbiddenTool, stripHtml } from "../src/connections/connections.js";
import { HomeAssistantBoardReporter, type Report } from "../src/reporting/reporter.js";
import { openDb } from "../src/db.js";
import { saveCharacter, sheetProblems } from "../src/desk/oc.js";
import { roleFor } from "../src/auth.js";
import { addMemory, listMemories } from "../src/companion/memory.js";
import { sandboxDocument } from "../src/desk/studio.js";
import { ParentSettings } from "../src/settings.js";

const TZ = "Europe/London";
const at = (d: number, h: number, m = 0) => zonedTime(2026, 11, d, h, m, TZ); // Nov 2026: 23 = Monday

function state(over: Partial<CheckinState> = {}): CheckinState {
  return {
    now: at(25, 16, 30), tz: TZ, quietHours: { start: "22:00", end: "07:00" }, maxPerDay: 2, sentTimes: [],
    lastChildMessageAt: null, toggles: { askHowThingsWent: true, morningHello: true, waterWhileRevising: true },
    memories: [{ id: 1, text: "Presentation on the Victorians", icon: "🎤", about_date: "2026-11-25", asked: 0 }],
    recentChildMessageTimes: [], ...over,
  };
}

describe("check-ins", () => {
  it("asks how a big thing went after school", () => {
    expect(planCheckin(state())).toMatchObject({ kind: "how_did_it_go", memoryId: 1 });
  });
  it("never in quiet hours", () => {
    expect(planCheckin(state({ now: at(25, 22, 30) }))).toBeNull();
    expect(planCheckin(state({ now: at(26, 6, 45), memories: [] }))).toBeNull(); // 06:45 is still quiet hours
  });
  it("at most twice a day, even if the parent sets more", () => {
    expect(planCheckin(state({ sentTimes: [at(25, 8), at(25, 12)] }))).toBeNull();
    expect(planCheckin(state({ maxPerDay: 9, sentTimes: [at(25, 8), at(25, 12)] }))).toBeNull();
    expect(planCheckin(state({ maxPerDay: 1, sentTimes: [at(25, 8)] }))).toBeNull();
  });
  it("leaves a gap between check-ins and doesn't interrupt a chat", () => {
    expect(planCheckin(state({ sentTimes: [at(25, 15)] }))).toBeNull();
    expect(planCheckin(state({ lastChildMessageAt: at(25, 16, 20) }))).toBeNull();
  });
  it("only sends the kinds they switched on", () => {
    expect(planCheckin(state({ toggles: { askHowThingsWent: false, morningHello: false, waterWhileRevising: false } }))).toBeNull();
  });
  it("morning hello only on school days", () => {
    expect(planCheckin(state({ now: at(26, 7, 45), memories: [] }))).toMatchObject({ kind: "morning_hello" });
    expect(planCheckin(state({ now: at(28, 7, 45), memories: [] }))).toBeNull(); // Saturday
  });
  it("water while revising", () => {
    const now = at(25, 19);
    const times = [now - 50 * 60_000, now - 30 * 60_000, now - 15 * 60_000, now - 2 * 60_000];
    expect(planCheckin(state({ now, memories: [], recentChildMessageTimes: times, lastChildMessageAt: times[3] }))).toMatchObject({ kind: "water" });
  });
  it("templates never guilt-trip", () => {
    for (const k of ["how_did_it_go", "morning_hello", "water"] as const) {
      expect(templateText({ kind: k }, 3)).not.toMatch(/miss|lonely|where (have|did) you/i);
    }
  });
});

describe("wyoming", () => {
  it("round-trips events with data and payload, split across chunks", () => {
    const a = encodeEvent("audio-chunk", { rate: 16000, width: 2, channels: 1 }, Buffer.from([1, 2, 3, 4]));
    const b = encodeEvent("transcript", { text: "hello there" });
    const all = Buffer.concat([a, b]);
    const p = new EventParser();
    const out = [...p.push(all.subarray(0, 10)), ...p.push(all.subarray(10, 40)), ...p.push(all.subarray(40))];
    expect(out.map((e) => e.type)).toEqual(["audio-chunk", "transcript"]);
    expect([...out[0].payload!]).toEqual([1, 2, 3, 4]);
    expect(out[1].data.text).toBe("hello there");
  });
  it("accepts inline data in the header (older servers)", () => {
    const p = new EventParser();
    expect(p.push(Buffer.from('{"type":"transcript","data":{"text":"hi"}}\n'))[0].data.text).toBe("hi");
  });
  it("writes a valid WAV header", () => {
    const w = wav(Buffer.alloc(100), 22050, 2, 1);
    expect(w.subarray(0, 4).toString()).toBe("RIFF");
    expect(w.readUInt32LE(24)).toBe(22050);
    expect(w.length).toBe(144);
  });
  it("speaks without emoji or markdown", () => {
    expect(speakable("**Well done!** 🎉 You did it 😊")).toBe("Well done! You did it");
  });
});

describe("homework tools", () => {
  it("calculates safely", () => {
    expect(calculate("3/4 + 1/8")).toBe("0.875 (= 7/8)");
    expect(calculate("2^3^2")).toBe("512");
    expect(calculate("-(2+3)*4")).toBe("-20");
    expect(calculate("sqrt(16) + 1")).toBe("5");
    expect(calculate("process.exit()")).toMatch(/couldn't/);
    expect(calculate("1/0")).toMatch(/zero/);
  });
});

describe("connections", () => {
  it("only reads allow-listed https sites", () => {
    const sites = ["bbc.co.uk/bitesize", "wikipedia.org"];
    expect(hostAllowed("https://www.bbc.co.uk/bitesize/x", sites)).toBe(true);
    expect(hostAllowed("https://en.wikipedia.org/wiki/Fox", sites)).toBe(true);
    expect(hostAllowed("http://en.wikipedia.org/", sites)).toBe(false);
    expect(hostAllowed("https://evilwikipedia.org/", sites)).toBe(false);
    expect(hostAllowed("https://wikipedia.org.evil.com/", sites)).toBe(false);
  });
  it("never offers tools that spend, message or post", () => {
    for (const t of ["send_message", "post_update", "buy_item", "HassBroadcast", "add_note_and_notify", "purchase"]) expect(isForbiddenTool(t)).toBe(true);
    for (const t of ["get_today", "list_events", "HassTurnOn", "room_status", "find_media"]) expect(isForbiddenTool(t)).toBe(false);
  });
  it("strips pages to text", () => {
    expect(stripHtml("<p>Hi <b>there</b></p><script>bad()</script>")).toBe("Hi there");
  });
  it("all connections start switched off", () => {
    expect(ParentSettings.parse({}).connections.every((c) => !c.enabled)).toBe(true);
  });
});

describe("Home Assistant board reporter", () => {
  const r: Report = { id: 1, ts: 0, level: "now", category: "self_harm", childNotice: "", parentText: "They may be in danger.", status: "pending" };
  const opts = { url: "http://ha.local:8123", token: "t", service: "script.ai_board_post", handle: "kith", kinds: { now: "child_now", today: "child_today", fyi: "child_fyi" } };
  it("posts the right kind to the script", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const rep = new HomeAssistantBoardReporter(opts, (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("[]"); }) as never);
    await rep.send(r, { companionName: "Pip", childName: "Sam" });
    expect(calls[0].url).toBe("http://ha.local:8123/api/services/script/ai_board_post");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ kind: "child_now", handle: "kith" });
    expect(body.message).toMatch(/Needs you now: They may be in danger\. \(Pip told Sam first\.\)/);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });
  it("maps each level to its own kind", () => {
    const rep = new HomeAssistantBoardReporter(opts);
    expect(rep.buildRequest({ ...r, level: "today" }, { companionName: "Pip", childName: "" }).body.kind).toBe("child_today");
    expect(rep.buildRequest({ ...r, level: "fyi" }, { companionName: "Pip", childName: "" }).body.kind).toBe("child_fyi");
  });
  it("fails loudly if not configured", async () => {
    await expect(new HomeAssistantBoardReporter({ ...opts, url: "" }).send(r, { companionName: "Pip", childName: "" })).rejects.toThrow(/configured/);
  });
});

describe("OC workshop", () => {
  it("saves and merges character sheets", () => {
    const db = openDb(":memory:");
    const a = saveCharacter(db, { fields: { name: "Ember", powers: "fire breath" } });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = saveCharacter(db, { id: a.character.id, fields: { palette: ["#D9A3E0", "#F59646"], relationships: [{ with: "Moss", kind: "rival", note: "" }] } });
    expect(b.ok && b.character.sheet).toMatchObject({ name: "Ember", powers: "fire breath", palette: ["#D9A3E0", "#F59646"] });
  });
  it("keeps it age-appropriate", () => {
    expect(sheetProblems({ backstory: "She has a crush on the prince and they're dating" })).toContain("no romance");
    expect(sheetProblems({ name: "Ember", backstory: "A brave dragon who's scared of heights" })).toEqual([]);
    const db = openDb(":memory:");
    expect(saveCharacter(db, { fields: { name: "Ember", backstory: "lives at 12 Rose Lane" } }).ok).toBe(false);
  });
});

describe("sign-in roles", () => {
  const people = { child: ["kid@example.com"], parents: ["grownup@example.com", "sub-123"], childName: "", parentLabel: "" };
  it("only lets configured people in", () => {
    expect(roleFor({ sub: "x", email: "kid@example.com", emailVerified: true }, people)).toBe("child");
    expect(roleFor({ sub: "sub-123" }, people)).toBe("parent");
    expect(roleFor({ sub: "x", email: "stranger@example.com", emailVerified: true }, people)).toBeNull();
  });
  it("ignores unverified emails", () => {
    expect(roleFor({ sub: "x", email: "kid@example.com", emailVerified: false }, people)).toBeNull();
  });
});

describe("memory", () => {
  it("never keeps personal details or duplicates", () => {
    const db = openDb(":memory:");
    expect(addMemory(db, { text: "Loves dragons and drawing" }).ok).toBe(true);
    expect(addMemory(db, { text: "loves dragons and drawing!" }).ok).toBe(false);
    expect(addMemory(db, { text: "Lives at 4 Oak Road" }).ok).toBe(false);
    expect(listMemories(db)).toHaveLength(1);
  });
});

describe("desk sandbox", () => {
  it("adds a no-network CSP to interactive things", () => {
    const doc = sandboxDocument("<html><head></head><body>hi</body></html>", "html");
    expect(doc).toMatch(/Content-Security-Policy/);
    expect(doc).toMatch(/connect-src 'none'/);
  });
  it("shows drawings as images (no scripts can run)", () => {
    expect(sandboxDocument("<svg></svg>", "svg")).toMatch(/<img alt="" src="data:image\/svg\+xml;base64,/);
  });
});
