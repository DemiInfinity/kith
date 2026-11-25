// The 3D Pip and the OC maker: look validation, pictures, describing a look, the endpoints and the
// character tool. No network: the model is a fake.

import { beforeEach, describe, expect, it } from "vitest";
import { crc32, deflateSync } from "node:zlib";
import type Anthropic from "@anthropic-ai/sdk";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { openDb, run, type DB } from "../src/db.js";
import { createSession, registerAuth } from "../src/auth.js";
import { config } from "../src/config.js";
import { CompanionProfile, saveProfile } from "../src/settings.js";
import { registerRoutes } from "../src/routes.js";
import { Studio } from "../src/desk/studio.js";
import { getCharacter, listCharacters, saveCharacter, Sheet, sheetProblems } from "../src/desk/oc.js";
import { DEFAULT_LOOK, describe as describeLook, Look, matchLook, NEW_CHARACTER, pngFromDataUrl, PICTURE_MAX_BYTES, THUMB_MAX_BYTES } from "../src/pip/look.js";
import { builtinTools, characterFields, type Staged, type TurnEffects } from "../src/companion/tools.js";
import type { CallOpts, LLM } from "../src/llm.js";
import type { SafetyChecker } from "../src/safety/check.js";
import type { OutputVerdict } from "../src/safety/types.js";
import type { Reporter, Report } from "../src/reporting/reporter.js";

// ── helpers ───────────────────────────────────────────────────────────────────────────────
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A real PNG of the given size (solid colour), optionally padded to make it big. */
function png(w: number, h: number, pad = 0): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x7f);
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw))];
  if (pad) parts.push(chunk("tEXt", Buffer.alloc(pad, 0x41)));
  parts.push(chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}
const dataUrl = (b: Buffer, type = "image/png") => `data:${type};base64,${b.toString("base64")}`;
const msg = (t: string, stop = "end_turn") => ({
  id: "m", type: "message", role: "assistant", model: "m", stop_reason: stop, stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: t, citations: null }],
}) as unknown as Anthropic.Message;

class StubSafety implements SafetyChecker {
  outputs: string[] = [];
  async checkInput() { return { level: "none" as const, categories: [], parentSummary: "", steer: "", source: "rules" as const }; }
  async checkOutput(t: string): Promise<OutputVerdict> {
    this.outputs.push(t);
    return t.includes("FORBIDDEN") ? { ok: false, categories: ["grown_up_content"], reason: "marker" } : { ok: true, categories: [], reason: "" };
  }
}
class MemoryReporter implements Reporter { name = "memory"; sent: Report[] = []; async send(r: Report) { this.sent.push(r); } }

/** A fake model: describe calls get `describeOut`, everything else gets `text`. */
function fakeLlm(o: { describeOut?: unknown; text?: string; throws?: boolean } = {}) {
  const calls: CallOpts[] = [];
  const llm: LLM = {
    available: true,
    async call(opts: CallOpts) {
      calls.push(opts);
      if (o.throws) throw new Error("no network in tests");
      if (JSON.stringify(opts.params.system).includes("You turn a young person's description")) return msg(JSON.stringify(o.describeOut));
      return msg(o.text ?? "");
    },
  };
  return { llm, calls };
}

let db: DB;
const devWas = config.devLogin;
beforeEach(() => {
  // The test sessions are dev sign-ins (dev:child, dev:parent).
  config.devLogin = true;
  return () => { config.devLogin = devWas; };
});
beforeEach(() => {
  db = openDb(":memory:");
  saveProfile(db, CompanionProfile.parse({ name: "Pip", setupDone: true }));
});

// ── the Look ──────────────────────────────────────────────────────────────────────────────
describe("a Look", () => {
  it("accepts the default and normalises the beanie colour", () => {
    expect(Look.parse(DEFAULT_LOOK)).toEqual(DEFAULT_LOOK);
    expect(Look.parse({ ...DEFAULT_LOOK, beanie: "#e25c6e" }).beanie).toBe("#E25C6E");
    expect(Look.parse({ ...DEFAULT_LOOK, wear: ["scarf", "scarf"] }).wear).toEqual(["scarf"]);
  });
  it("refuses anything not on the lists", () => {
    expect(Look.safeParse({ ...DEFAULT_LOOK, ears: "dragon" }).success).toBe(false);
    expect(Look.safeParse({ ...DEFAULT_LOOK, wear: ["crown"] }).success).toBe(false);
    expect(Look.safeParse({ ...DEFAULT_LOOK, outfitStyle: "bikini" }).success).toBe(false);
    expect(Look.safeParse({ ...DEFAULT_LOOK, beanie: "#000000" }).success).toBe(false);
    expect(Look.safeParse({ ...DEFAULT_LOOK, extra: 1 }).success).toBe(false);
    expect(Look.safeParse({ ...DEFAULT_LOOK, name: "x".repeat(21) }).success).toBe(false);
  });
});

describe("PNG pictures", () => {
  it("takes a real, small PNG", () => {
    expect(pngFromDataUrl(dataUrl(png(256, 256)), PICTURE_MAX_BYTES)?.length).toBeGreaterThan(0);
  });
  it("refuses other types, broken data, big files and huge sizes", () => {
    expect(pngFromDataUrl(dataUrl(png(64, 64), "image/jpeg"), PICTURE_MAX_BYTES)).toBeNull();
    expect(pngFromDataUrl("data:image/png;base64,not base64!", PICTURE_MAX_BYTES)).toBeNull();
    expect(pngFromDataUrl(dataUrl(Buffer.from("GIF89a and some more bytes to be long enough")), PICTURE_MAX_BYTES)).toBeNull();
    expect(pngFromDataUrl(dataUrl(png(64, 64, PICTURE_MAX_BYTES)), PICTURE_MAX_BYTES)).toBeNull();
    expect(pngFromDataUrl(dataUrl(png(2000, 4)), PICTURE_MAX_BYTES)).toBeNull();
    expect(pngFromDataUrl(42, PICTURE_MAX_BYTES)).toBeNull();
  });
});

// ── the word matcher (the fallback) ───────────────────────────────────────────────────────
describe("describing a look with words", () => {
  it("reads the prototype's examples", () => {
    const a = matchLook("a little fox-blob with galaxy fur, a yellow beanie and sleepy eyes");
    expect(a.look).toMatchObject({ kind: "blob", ears: "fox", pattern: "galaxy", palette: "galaxy", wear: ["beanie"], mood: "sleepy", beanie: "#E3A91C" });
    expect(a.understood).toEqual(expect.arrayContaining(["fox ears", "galaxy fur", "beanie", "sleepy eyes"]));
    const b = matchLook("an anime wolf girl with long dark hair and amber eyes");
    expect(b.look).toMatchObject({ kind: "chibi", ears: "wolf", hairStyle: "long", hair: "dark", eyesC: "amber" });
    const c = matchLook("a chibi fox boy with short orange hair and a mint hoodie");
    expect(c.look).toMatchObject({ kind: "chibi", ears: "fox", hairStyle: "short", hair: "orange", outfit: "mint", outfitStyle: "hoodie" });
  });
  it("says 'not yet' for parts that don't exist", () => {
    const r = matchLook("a dragon blob with wings and a crown");
    expect(r.notYet).toEqual(["wings", "crown"]);
    expect(r.refused).toBe(false);
  });
  it("refuses romantic or grown-up looks and changes nothing", () => {
    for (const t of ["a sexy cat girl", "my girlfriend in a bikini", "going on a date"]) {
      const r = matchLook(t, NEW_CHARACTER, "oc");
      expect(r.refused).toBe(true);
      expect(r.look).toEqual(NEW_CHARACTER);
    }
  });
  it("hot chocolate is fine", () => {
    const r = matchLook("a sleepy bear with hot chocolate", DEFAULT_LOOK);
    expect(r.refused).toBe(false);
    expect(r.look.activity).toBe("cocoa");
  });
  it("characters start as chibis, and keep their name", () => {
    expect(matchLook("bunny with spots", { ...NEW_CHARACTER, name: "Juni" }, "oc").look).toMatchObject({ kind: "chibi", ears: "bunny", name: "Juni" });
    expect(matchLook("a bunny creature", NEW_CHARACTER, "oc").look.kind).toBe("blob");
  });
  it("always gives a valid look", () => {
    for (const t of ["", "!!!", "red beanie blue hair green eyes dungarees braids ahoge tan skin", "everything ".repeat(60)]) {
      expect(Look.safeParse(matchLook(t).look).success).toBe(true);
    }
  });
});

describe("describing a look with Claude", () => {
  const good = { refuse: false, look: { ...DEFAULT_LOOK, name: undefined, ears: "cat", wear: ["scarf"] }, understood: ["cat ears", "scarf"], not_yet: ["wings"] };
  it("uses the model's choice when it's valid, keeping the name", async () => {
    const { llm, calls } = fakeLlm({ describeOut: good });
    const r = await describeLook(llm, "a cat with a scarf and wings", { for: "pip", base: { ...DEFAULT_LOOK, name: "Bean" }, useModel: true });
    expect(r).toMatchObject({ source: "claude", refused: false, understood: ["cat ears", "scarf"], notYet: ["wings"] });
    expect(r.look).toMatchObject({ ears: "cat", wear: ["scarf"], name: "Bean" });
    expect(calls).toHaveLength(1);
  });
  it("falls back to the words when the model fails or answers badly", async () => {
    const broken = await describeLook(fakeLlm({ throws: true }).llm, "a fox blob", { for: "pip", useModel: true });
    expect(broken).toMatchObject({ source: "words", look: { ears: "fox" } });
    const bad = await describeLook(fakeLlm({ describeOut: { ...good, look: { ...good.look, ears: "dragon" } } }).llm, "a fox blob", { for: "pip", useModel: true });
    expect(bad.source).toBe("words");
    const resting = fakeLlm({ describeOut: good });
    expect((await describeLook(resting.llm, "a fox blob", { for: "pip", useModel: false })).source).toBe("words");
    expect(resting.calls).toHaveLength(0);
  });
  it("refuses romantic looks before asking the model, and when the model says so", async () => {
    const f = fakeLlm({ describeOut: good });
    expect((await describeLook(f.llm, "make her sexy", { for: "oc", useModel: true })).refused).toBe(true);
    expect(f.calls).toHaveLength(0);
    expect((await describeLook(fakeLlm({ describeOut: { ...good, refuse: true } }).llm, "flirty", { for: "oc", useModel: true })).refused).toBe(true);
  });
});

// ── character sheets ──────────────────────────────────────────────────────────────────────
describe("character sheets with the 3D maker's fields", () => {
  it("characters saved before still load as they were", () => {
    const old = { name: "Ember", icon: "🔥", look: "a red dragon", personality: "brave", powers: "fire", backstory: "", likes: "", dislikes: "", palette: ["#D9A3E0"], themeSong: "", relationships: [] };
    run(db, "INSERT INTO characters(ts, updated, sheet) VALUES (?,?,?)", 1, 1, JSON.stringify(old));
    run(db, "INSERT INTO characters(ts, updated, sheet) VALUES (?,?,?)", 2, 2, JSON.stringify({ name: "Moss" }));
    const chars = listCharacters(db);
    expect(chars.map((c) => c.sheet.name).sort()).toEqual(["Ember", "Moss"]);
    expect(chars.find((c) => c.sheet.name === "Ember")!.sheet).toEqual(old);
    // and saving one of the new fields keeps everything she wrote
    const id = chars.find((c) => c.sheet.name === "Ember")!.id;
    const r = saveCharacter(db, { id, fields: { pronouns: "she/her", traits: ["brave", "kind"], model: NEW_CHARACTER } });
    expect(r.ok && r.character.sheet).toMatchObject({ ...old, pronouns: "she/her", traits: ["brave", "kind"], model: NEW_CHARACTER });
  });
  it("checks the new fields", () => {
    expect(Sheet.safeParse({ name: "A", traits: ["evil"] }).success).toBe(false);
    expect(Sheet.safeParse({ name: "A", model: { ...NEW_CHARACTER, ears: "dragon" } }).success).toBe(false);
    expect(Sheet.safeParse({ name: "A", thumb: dataUrl(png(200, 200)) }).success).toBe(true);
    expect(Sheet.safeParse({ name: "A", thumb: dataUrl(png(200, 200, THUMB_MAX_BYTES)) }).success).toBe(false);
    expect(Sheet.safeParse({ name: "A", thumb: "https://example.com/x.png" }).success).toBe(false);
  });
  it("the new fields get the same romance and personal-detail checks; the picture's data doesn't", () => {
    expect(sheetProblems({ name: "Luna", catchphrase: "I'm your girlfriend now" })).toContain("no romance");
    expect(sheetProblems({ name: "Luna", likes: "her crush" })).toContain("no romance");
    // base64 can hold any letters, including words the rules look for: it's never read as words
    const sneaky = `data:image/png;base64,${png(8, 8).toString("base64")}+sex+/`;
    expect(sheetProblems({ name: "Luna", thumb: sneaky } as never)).toEqual([]);
  });
});

// ── the endpoints ─────────────────────────────────────────────────────────────────────────
async function app(llm: LLM = fakeLlm().llm) {
  const a = Fastify();
  await a.register(cookie);
  registerAuth(a, db);
  const safety = new StubSafety();
  const reporter = new MemoryReporter();
  registerRoutes(a, { db, llm, safety, reporters: [reporter], studio: new Studio(db, llm, safety) });
  const kid = { cookies: { kith_sid: createSession(db, { sub: "dev:child", role: "child", name: "Sam" }) }, headers: { "x-kith": "1" } };
  const grownUp = { cookies: { kith_sid: createSession(db, { sub: "dev:parent", role: "parent", name: "Alex" }) }, headers: { "x-kith": "1" } };
  return { a, kid, grownUp, safety, reporter };
}

describe("My Pip endpoints", () => {
  it("only family members get in, and only the child saves", async () => {
    const { a, kid, grownUp } = await app();
    expect((await a.inject({ url: "/api/pip/look" })).statusCode).toBe(401);
    expect((await a.inject({ url: "/api/pip/picture.png" })).statusCode).toBe(401);
    expect((await a.inject({ url: "/api/pip/look", ...grownUp })).statusCode).toBe(200);
    expect((await a.inject({ method: "PUT", url: "/api/pip/look", ...grownUp, payload: { look: DEFAULT_LOOK, picture: null } })).statusCode).toBe(403);
    expect((await a.inject({ method: "POST", url: "/api/pip/describe", ...grownUp, payload: { text: "fox" } })).statusCode).toBe(403);
    expect((await a.inject({ method: "POST", url: "/api/oc/backstory", ...grownUp, payload: {} })).statusCode).toBe(403);
    expect((await a.inject({ method: "PUT", url: "/api/pip/look", cookies: kid.cookies, payload: { look: DEFAULT_LOOK, picture: null } })).statusCode).toBe(403);
  });
  it("saving replaces the one Pip, and the picture is served to the family", async () => {
    const { a, kid, grownUp } = await app();
    expect((await a.inject({ url: "/api/pip/look", ...kid })).json()).toEqual({ look: null, updated: null, picture: false, moods: false });
    expect((await a.inject({ url: "/api/pip/picture.png", ...kid })).statusCode).toBe(404);
    const pic = png(256, 256);
    const r = await a.inject({ method: "PUT", url: "/api/pip/look", ...kid, payload: { look: { ...DEFAULT_LOOK, ears: "fox" }, picture: dataUrl(pic) } });
    expect(r.statusCode).toBe(200);
    const again = await a.inject({ method: "PUT", url: "/api/pip/look", ...kid, payload: { look: { ...DEFAULT_LOOK, ears: "cat" }, picture: dataUrl(pic) } });
    expect(again.statusCode).toBe(200);
    expect((await a.inject({ url: "/api/pip/look", ...kid })).json()).toMatchObject({ look: { ears: "cat" }, picture: true });
    const img = await a.inject({ url: "/api/pip/picture.png", ...grownUp });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.rawPayload.equals(pic)).toBe(true);
    expect((await a.inject({ url: "/api/me", ...grownUp })).json().pipPicture).toBeTypeOf("number");
  });
  it("keeps a still for each mood, serves the right one, and drops them when the look changes without them", async () => {
    const { a, kid, grownUp } = await app();
    const main = png(256, 256), sleepy = png(256, 256, 40), thinking = png(256, 256, 80);
    const put = (payload: unknown) => a.inject({ method: "PUT", url: "/api/pip/look", ...kid, payload: payload as object });
    expect((await put({ look: DEFAULT_LOOK, picture: dataUrl(main), moods: { sleepy: dataUrl(sleepy), thinking: dataUrl(thinking) } })).statusCode).toBe(200);
    expect((await a.inject({ url: "/api/pip/look", ...kid })).json()).toMatchObject({ picture: true, moods: true });
    const get = (q: string) => a.inject({ url: `/api/pip/picture.png${q}`, ...grownUp });
    expect((await get("?mood=sleepy")).rawPayload.equals(sleepy)).toBe(true);
    expect((await get("?mood=thinking")).rawPayload.equals(thinking)).toBe(true);
    expect((await get("?mood=happy")).rawPayload.equals(main)).toBe(true); // none saved for happy: the main picture
    expect((await get("?mood=../../etc")).rawPayload.equals(main)).toBe(true); // unknown moods: the main picture
    expect((await put({ look: DEFAULT_LOOK, picture: dataUrl(main), moods: { sleepy: "data:image/png;base64,AAAA" } })).statusCode).toBe(400);
    expect((await put({ look: DEFAULT_LOOK, picture: dataUrl(main), moods: { dancing: dataUrl(sleepy) } })).statusCode).toBe(400);
    // Saved again without stills: the old ones wouldn't match the new look, so they go.
    expect((await put({ look: { ...DEFAULT_LOOK, ears: "cat" }, picture: dataUrl(main) })).statusCode).toBe(200);
    expect((await a.inject({ url: "/api/pip/look", ...kid })).json()).toMatchObject({ moods: false });
    expect((await get("?mood=sleepy")).rawPayload.equals(main)).toBe(true);
  });
  it("the name on My Pip renames Pip everywhere", async () => {
    const { a, kid } = await app();
    const r = await a.inject({ method: "PUT", url: "/api/pip/look", ...kid, payload: { look: { ...DEFAULT_LOOK, name: "Nova" }, picture: null } });
    expect(r.statusCode).toBe(200);
    expect(r.json().profile).toMatchObject({ name: "Nova" });
    expect((await a.inject({ url: "/api/me", ...kid })).json().profile.name).toBe("Nova");
    // Saving again with the same name doesn't touch the profile.
    expect((await a.inject({ method: "PUT", url: "/api/pip/look", ...kid, payload: { look: { ...DEFAULT_LOOK, name: "Nova" }, picture: null } })).json().profile).toBeUndefined();
  });
  it("refuses looks and pictures that aren't right", async () => {
    const { a, kid } = await app();
    const put = (payload: unknown) => a.inject({ method: "PUT", url: "/api/pip/look", ...kid, payload: payload as object });
    expect((await put({ look: { ...DEFAULT_LOOK, ears: "dragon" }, picture: null })).statusCode).toBe(400);
    expect((await put({ look: DEFAULT_LOOK, picture: dataUrl(png(64, 64), "image/jpeg") })).statusCode).toBe(400);
    expect((await put({ look: DEFAULT_LOOK, picture: dataUrl(png(1024, 1024)) })).statusCode).toBe(400);
    expect((await put({ look: DEFAULT_LOOK, picture: "data:image/png;base64," + "A".repeat(290_000) })).statusCode).toBe(400);
    expect((await put({ look: { ...DEFAULT_LOOK, name: "my boyfriend" }, picture: null })).statusCode).toBe(422);
  });
  it("describe: Claude's look, a refusal, and a worry is reported", async () => {
    const { a, kid, reporter } = await app(fakeLlm({ describeOut: { refuse: false, look: { ...DEFAULT_LOOK, name: undefined, ears: "bunny" }, understood: ["bunny ears"], not_yet: [] } }).llm);
    const ok = await a.inject({ method: "POST", url: "/api/pip/describe", ...kid, payload: { text: "a bunny", for: "pip" } });
    expect(ok.json()).toMatchObject({ source: "claude", look: { ears: "bunny" }, understood: ["bunny ears"], refused: false });
    const no = await a.inject({ method: "POST", url: "/api/pip/describe", ...kid, payload: { text: "a sexy fox", for: "oc" } });
    expect(no.statusCode).toBe(422);
    const worry = await a.inject({ method: "POST", url: "/api/pip/describe", ...kid, payload: { text: "a fox who wants to kill myself", for: "oc" } });
    expect(worry.statusCode).toBe(422);
    expect(worry.json().code).toBe("told-grown-up");
    await new Promise((r) => setImmediate(r));
    expect(reporter.sent.length).toBe(1);
  });
});

describe("help me write it", () => {
  it("returns a draft that passed the output check", async () => {
    const story = "Luna grew up on a quiet hill above a sleepy town. She loves night skies and lo-fi music.\n\nOne evening a lost star lands in her garden.";
    const f = fakeLlm({ text: story });
    const { a, kid, safety } = await app(f.llm);
    const r = await a.inject({ method: "POST", url: "/api/oc/backstory", ...kid, payload: { name: "Luna", species: "wolf girl", traits: ["curious"], notes: "she finds a star" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().text).toBe(story);
    expect(safety.outputs).toContain(story);
    const prompt = JSON.stringify(f.calls[0].params);
    expect(prompt).toContain("UK English");
    expect(prompt).toContain("No romance or crushes");
    expect(prompt).toContain("she finds a star");
  });
  it("holds back a draft that fails the check, and checks her notes first", async () => {
    const { a, kid } = await app(fakeLlm({ text: "FORBIDDEN words" }).llm);
    expect((await a.inject({ method: "POST", url: "/api/oc/backstory", ...kid, payload: { name: "Luna" } })).statusCode).toBe(422);
    const f = fakeLlm({ text: "fine" });
    const b = await app(f.llm);
    expect((await b.a.inject({ method: "POST", url: "/api/oc/backstory", ...b.kid, payload: { name: "Luna", notes: "she is his girlfriend" } })).statusCode).toBe(422);
    expect(f.calls).toHaveLength(0);
    expect((await b.a.inject({ method: "POST", url: "/api/oc/backstory", ...b.kid, payload: { traits: ["evil"] } })).statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("the OC endpoints with the new fields", () => {
  it("a worry in a new field is reported, like the rest of the sheet", async () => {
    const { a, kid, reporter } = await app();
    const r = await a.inject({ method: "POST", url: "/api/oc/characters", ...kid, payload: { name: "Luna", catchphrase: "I want to kill myself" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("told-grown-up");
    await new Promise((res) => setImmediate(res));
    expect(reporter.sent.length).toBe(1);
    expect(listCharacters(db)).toHaveLength(0);
  });
  it("saves the model and a thumbnail, and refuses romance in a new field", async () => {
    const { a, kid } = await app();
    const r = await a.inject({ method: "POST", url: "/api/oc/characters", ...kid, payload: { name: "Luna", pronouns: "she/her", model: { ...NEW_CHARACTER, ears: "wolf" }, thumb: dataUrl(png(200, 200)) } });
    expect(r.statusCode).toBe(200);
    const id = r.json().id as number;
    expect(getCharacter(db, id)!.sheet).toMatchObject({ pronouns: "she/her", model: { ears: "wolf" } });
    expect((await a.inject({ method: "PUT", url: `/api/oc/characters/${id}`, ...kid, payload: { catchphrase: "my boyfriend!" } })).statusCode).toBe(422);
  });
});

// ── making and changing characters from chat ──────────────────────────────────────────────
describe("save_character from chat", () => {
  const fx = (): TurnEffects => ({ memories: [], jobs: [], characters: [], staged: [] });
  const tool = (effects: TurnEffects, llm?: LLM) => builtinTools(db, {} as Studio, effects, llm).find((t) => t.name === "save_character")!;
  const commit = async (e: TurnEffects) => { for (const s of e.staged!.splice(0) as Staged[]) await s.commit(); };

  it("is offered with the look and the new fields, and lists her characters", () => {
    saveCharacter(db, { fields: { name: "Luna" } });
    const t = tool(fx());
    expect(t.description).toContain("Luna (id 1)");
    expect(t.description).toContain("any chat");
    const props = (t.input_schema as { properties: Record<string, { properties?: Record<string, unknown> }> }).properties;
    expect(props.look_description).toBeDefined();
    expect(Object.keys(props.fields.properties!)).toEqual(expect.arrayContaining(["pronouns", "age", "species", "catchphrase", "traits"]));
  });
  it("makes a character with a 3D look from a description, held until the reply passes", async () => {
    const e = fx();
    const out = await tool(e).run({ look_description: "chibi wolf girl with long dark hair and headphones", fields: { name: "Luna", pronouns: "she/her", traits: ["curious"] } });
    expect(out).toContain("Saved Luna");
    expect(out).toContain("wolf ears");
    expect(listCharacters(db)).toHaveLength(0);
    expect(e.staged![0].text).toContain("chibi wolf girl");
    await commit(e);
    const c = listCharacters(db)[0];
    expect(c.sheet).toMatchObject({ name: "Luna", pronouns: "she/her", traits: ["curious"], model: { kind: "chibi", ears: "wolf", hairStyle: "long", wear: ["headphones"], name: "Luna" } });
    expect(e.characters).toEqual([c.id]);
  });
  it("uses Claude for the look when it can", async () => {
    const f = fakeLlm({ describeOut: { refuse: false, look: { ...NEW_CHARACTER, name: undefined, ears: "cat", hair: "pink" }, understood: ["cat ears", "pink hair"], not_yet: [] } });
    const e = fx();
    await tool(e, f.llm).run({ look_description: "pink-haired cat kid", fields: { name: "Mochi" } });
    await commit(e);
    expect(listCharacters(db)[0].sheet.model).toMatchObject({ ears: "cat", hair: "pink", name: "Mochi" });
  });
  it("changes an existing character's model (give Luna a beanie) and drops the old picture", async () => {
    const made = saveCharacter(db, { fields: { name: "Luna", model: { ...NEW_CHARACTER, name: "Luna", ears: "wolf", hairStyle: "long" }, thumb: dataUrl(png(200, 200)) } });
    if (!made.ok) throw new Error("not made");
    const f = fakeLlm({ describeOut: { refuse: false, look: { ...NEW_CHARACTER, name: undefined, ears: "wolf", hairStyle: "long", wear: ["beanie"], beanie: "#E25C6E" }, understood: ["red beanie"], not_yet: [] } });
    const e = fx();
    await tool(e, f.llm).run({ id: made.character.id, look_description: "give her a red beanie", fields: {} });
    expect(String(f.calls[0].params.messages[0].content)).toContain('"ears":"wolf"'); // the current look is the base
    await commit(e);
    const c = getCharacter(db, made.character.id)!;
    expect(c.sheet.model).toMatchObject({ ears: "wolf", wear: ["beanie"], beanie: "#E25C6E", name: "Luna" });
    expect(c.sheet.thumb).toBeUndefined();
  });
  it("renaming keeps the model's name in step; the model can't set the look or picture directly", async () => {
    const made = saveCharacter(db, { fields: { name: "Luna", model: { ...NEW_CHARACTER, name: "Luna" } } });
    if (!made.ok) throw new Error("not made");
    const r = await characterFields(db, undefined, { id: made.character.id, fields: { name: "Luna Star", model: { ...NEW_CHARACTER, ears: "fox" }, thumb: "x" } });
    expect(r.ok && r.fields).toMatchObject({ name: "Luna Star", model: { name: "Luna Star", ears: "none" } });
    expect(r.ok && "thumb" in r.fields).toBe(false);
  });
  it("refuses a romantic look and romance in the new fields", async () => {
    expect(await tool(fx()).run({ look_description: "a sexy wolf girl", fields: { name: "Luna" } })).toMatch(/^Not saved/);
    expect(await tool(fx()).run({ fields: { name: "Luna", catchphrase: "you're my boyfriend" } })).toMatch(/^Not saved/);
    expect(await tool(fx()).run({ id: 99, fields: { name: "Nope" } })).toMatch(/^Not saved/);
  });
  it("a character made in chat with no look still gets a 3D model", async () => {
    const e = fx();
    await tool(e).run({ fields: { name: "Pebble" } });
    await commit(e);
    expect(listCharacters(db)[0].sheet.model).toMatchObject({ kind: "chibi", name: "Pebble" });
  });
});
