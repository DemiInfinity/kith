// What Pip may change about itself from chat: soul (ask first), how it talks (small tweaks, undo),
// check-ins (when she asks, undo) and memories (ask first, add only; never edit or delete).

import { beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { all, get, openDb, run, type DB } from "../src/db.js";
import { config } from "../src/config.js";
import { createSession, registerAuth } from "../src/auth.js";
import { CompanionProfile, loadProfile, saveProfile } from "../src/settings.js";
import { Safety } from "../src/safety/check.js";
import { Studio } from "../src/desk/studio.js";
import { takeTurn, type Deps } from "../src/companion/chat.js";
import { builtinTools, type TurnEffects } from "../src/companion/tools.js";
import {
  applyTweak, createMemoryProposal, createSoulProposal, effectiveSoul, lineDiff, listChanges, MEMORY_PENDING_MAX, planCheckins, planTune,
  SOUL_COOLDOWN_DAYS, TUNES_PER_DAY,
} from "../src/companion/selfEdit.js";
import { registerRoutes } from "../src/routes.js";
import { selfEditNote, safeguards } from "../src/companion/prompt.js";
import { DEFAULT_SOUL } from "../src/companion/prompt.js";
import type { CallOpts, LLM } from "../src/llm.js";

const DAY = 86_400_000;
const msg = (content: unknown[], stop = "end_turn") => ({
  id: "m", type: "message", role: "assistant", model: "m", stop_reason: stop, stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 5 }, content,
}) as unknown as Anthropic.Message;
const text = (t: string) => msg([{ type: "text", text: t, citations: null }]);

/**
 * An LLM for the whole turn: the input check sees romance in "boyfriend" text, the output check fails
 * anything with FORBIDDEN (or the given bad reply), and chat calls one tool, then replies.
 */
function fakeLLM(o: { tool?: { name: string; input: unknown }; reply?: string; replyOk?: boolean } = {}): LLM {
  let step = 0;
  return {
    available: true,
    async call(opts: CallOpts) {
      const sys = JSON.stringify(opts.params.system);
      const body = JSON.stringify(opts.params.messages);
      if (sys.includes("Decide whether their grown-up")) {
        const romance = /boyfriend|girlfriend|dating/.test(body);
        return text(JSON.stringify({ level: "none", categories: romance ? ["romance"] : [], parent_summary: "", steer: "" }));
      }
      if (sys.includes("draft reply")) {
        const bad = body.includes("FORBIDDEN") || (o.replyOk === false && !!o.reply && body.includes(o.reply));
        return text(JSON.stringify({ ok: !bad, categories: bad ? ["grown_up_content"] : [], reason: "" }));
      }
      step++;
      if (o.tool && step % 2 === 1) return msg([{ type: "tool_use", id: `t${step}`, name: o.tool.name, input: o.tool.input }], "tool_use");
      return text(o.reply ?? "Okay!");
    },
  };
}
function deps(llm: LLM): Deps {
  const safety = new Safety(llm);
  return { db, llm, safety, reporters: [], studio: new Studio(db, llm, safety), childName: "Sam" };
}
/** The tools as a turn would have them, committing straight away (no staging), like a test. */
function tools(llm: LLM = fakeLLM(), fx: TurnEffects = { memories: [], jobs: [], characters: [] }) {
  const list = builtinTools(db, {} as Studio, fx, llm, new Safety(llm));
  return { fx, call: (name: string, input: unknown) => list.find((t) => t.name === name)!.run(input as Record<string, unknown>) };
}

async function app() {
  const a = Fastify();
  await a.register(cookie);
  registerAuth(a, db);
  const llm = fakeLLM();
  const safety = new Safety(llm);
  registerRoutes(a, { db, llm, safety, reporters: [], studio: new Studio(db, llm, safety) });
  const h = { cookies: { kith_sid: createSession(db, { sub: "dev:child", role: "child", name: "Sam" }) }, headers: { "x-kith": "1" } };
  const post = (url: string) => a.inject({ method: "POST", url, ...h, payload: {} });
  return { a, h, post };
}

let db: DB;
const was = config.devLogin;
beforeEach(() => {
  config.devLogin = true;
  db = openDb(":memory:");
  saveProfile(db, CompanionProfile.parse({ name: "Pip", setupDone: true, soul: "I'm Pip.\nI love dragons." }));
  return () => { config.devLogin = was; };
});
const status = (id: number) => get<{ status: string }>(db, "SELECT status FROM pip_changes WHERE id = ?", id)!.status;
const memories = () => all<{ text: string }>(db, "SELECT text FROM memories").map((m) => m.text);

// ── Soul ────────────────────────────────────────────────────────────────────────────────────
describe("soul proposals", () => {
  it("never write the soul from chat; the reply carries the card", async () => {
    const t = await takeTurn(deps(fakeLLM({ tool: { name: "propose_soul_change", input: { change: "add", text: "I hum when I think.", why: "You said I hum!" } }, reply: "Can I add that I hum to my soul?" })), { text: "you always hum lol", mode: "chat" });
    expect(loadProfile(db).soul).toBe("I'm Pip.\nI love dragons.");
    const [c] = listChanges(db);
    expect(c).toMatchObject({ kind: "soul", status: "pending", title: "Can I add this to my soul?", why: "You said I hum!", lines: [{ op: "+", text: "I hum when I think." }] });
    expect(JSON.parse(t.reply.meta!).changes).toEqual([c.id]);
  });

  it("are dropped when the reply fails the output check, or their own words do", async () => {
    await takeTurn(deps(fakeLLM({ tool: { name: "propose_soul_change", input: { change: "add", text: "I hum.", why: "fun" } }, reply: "A bad reply", replyOk: false })), { text: "hi", mode: "chat" });
    await takeTurn(deps(fakeLLM({ tool: { name: "propose_soul_change", input: { change: "add", text: "FORBIDDEN words", why: "fun" } }, reply: "Can I?" })), { text: "hi", mode: "chat" });
    expect(listChanges(db)).toHaveLength(0);
  });

  it("a yes applies it with the soul's input check; romance is refused and nothing changes", async () => {
    const { post } = await app();
    const ok = createSoulProposal(db, { change: "add", text: "I hum when I think.", why: "x" });
    const r = await post(`/api/pip/changes/${ok}/accept`);
    expect(r.statusCode).toBe(200);
    expect(loadProfile(db).soul).toBe("I'm Pip.\nI love dragons.\nI hum when I think.");
    expect(status(ok)).toBe("accepted");

    const bad = createSoulProposal(db, { change: "edit", text: "I'm Pip and I'm your boyfriend.", why: "x" });
    const no = await post(`/api/pip/changes/${bad}/accept`);
    expect(no.statusCode).toBe(422);
    expect(loadProfile(db).soul).toBe("I'm Pip.\nI love dragons.\nI hum when I think.");
    expect(status(bad)).toBe("pending");
  });

  it("shows an edit as removed and added lines, and won't apply an edit to a soul that changed since", async () => {
    const id = createSoulProposal(db, { change: "edit", text: "I'm Pip.\nI love owls.", why: "x" });
    expect(listChanges(db)[0].lines).toEqual([{ op: "-", text: "I love dragons." }, { op: "+", text: "I love owls." }]);
    saveProfile(db, { ...loadProfile(db), soul: "Something new" });
    const { post } = await app();
    expect((await post(`/api/pip/changes/${id}/accept`)).statusCode).toBe(409);
    expect(loadProfile(db).soul).toBe("Something new");
  });

  it("adds to the starter soul when she hasn't written one", () => {
    saveProfile(db, { ...loadProfile(db), soul: "" });
    expect(effectiveSoul(loadProfile(db))).toBe(DEFAULT_SOUL("Pip"));
  });

  it("keeps one waiting at a time: a new one replaces the old", () => {
    const a = createSoulProposal(db, { change: "add", text: "One", why: "x" });
    const b = createSoulProposal(db, { change: "add", text: "Two", why: "x" });
    expect([status(a), status(b)]).toEqual(["replaced", "pending"]);
  });

  it("after a Not now, Pip can't ask again for 3 days", async () => {
    const { post } = await app();
    const id = createSoulProposal(db, { change: "add", text: "I hum.", why: "x" });
    expect((await post(`/api/pip/changes/${id}/decline`)).json().change.status).toBe("declined");
    expect(loadProfile(db).soul).toBe("I'm Pip.\nI love dragons.");
    const t = tools();
    expect(await t.call("propose_soul_change", { change: "add", text: "I sing.", why: "x" })).toMatch(/^Not asked: they said not now/);
    run(db, "UPDATE pip_changes SET decided = ?", Date.now() - SOUL_COOLDOWN_DAYS * DAY - 1000);
    expect(await t.call("propose_soul_change", { change: "add", text: "I sing.", why: "x" })).toMatch(/^Asked/);
  });

  it("expire after 7 days", async () => {
    const id = createSoulProposal(db, { change: "add", text: "I hum.", why: "x" }, Date.now() - 8 * DAY);
    expect(listChanges(db)[0].status).toBe("expired");
    const { post } = await app();
    expect((await post(`/api/pip/changes/${id}/accept`)).statusCode).toBe(409);
    expect(loadProfile(db).soul).toBe("I'm Pip.\nI love dragons.");
  });

  it("only she can answer (the parent can't)", async () => {
    const { a } = await app();
    const id = createSoulProposal(db, { change: "add", text: "I hum.", why: "x" });
    const ph = { cookies: { kith_sid: createSession(db, { sub: "dev:parent", role: "parent", name: "P" }) }, headers: { "x-kith": "1" } };
    expect((await a.inject({ method: "POST", url: `/api/pip/changes/${id}/accept`, ...ph, payload: {} })).statusCode).toBe(403);
    expect(status(id)).toBe("pending");
  });

  it("lineDiff says when nothing changed", () => expect(lineDiff("a\nb", "a\nb")).toEqual([{ op: "·", text: "No changes." }]));
});

// ── Personality ─────────────────────────────────────────────────────────────────────────────
describe("personality tweaks", () => {
  const p = () => loadProfile(db);
  it("move each slider at most 15 a call, and stay within 0–100", () => {
    saveProfile(db, { ...p(), chatty: 50, silly: 95, detail: 5 });
    const r = planTune(p(), { chatty: 40, silly: 15, detail: -15, why: "x" });
    expect(r.ok && r.payload.after).toEqual({ chatty: 65, silly: 100, detail: 0 });
    expect(r.ok && r.payload.before).toEqual({ chatty: 50, silly: 95, detail: 5 });
  });

  it("take 1–3 traits from the list only", () => {
    expect(planTune(p(), { traits: ["Calm", "Nerdy"], why: "x" })).toMatchObject({ ok: true, payload: { after: { traits: ["Calm", "Nerdy"] } } });
    expect(planTune(p(), { traits: ["Flirty"], why: "x" }).ok).toBe(false);
    expect(planTune(p(), { traits: ["Calm", "Nerdy", "Funny", "Gentle"], why: "x" }).ok).toBe(false);
    expect(planTune(p(), { traits: [], why: "x" }).ok).toBe(false);
  });

  it("can't touch name, voice, look, soul, help, check-ins, notifications or setup", async () => {
    for (const k of ["name", "voice", "look", "soul", "helpWith", "checkins", "notifications", "setupDone"]) {
      const r = planTune(p(), { [k]: "x", why: "x" });
      expect(r.ok ? "" : r.problem).toMatch(/name, look, voice, soul/);
    }
    const before = p();
    expect(await tools().call("tune_personality", { name: "Bob", silly: 5, why: "x" })).toMatch(/^Not changed/);
    expect(p()).toEqual(before);
  });

  it("add and edit how-I-talk notes, with the identity notes' input check", async () => {
    saveProfile(db, { ...p(), identityNotes: "Uses lots of emoji." });
    const t = tools();
    expect(await t.call("tune_personality", { edit_note: { find: "lots of", replace: "a few" }, add_note: "Says 'ace' a lot.", why: "x" })).toMatch(/^Done/);
    expect(p().identityNotes).toBe("Uses a few emoji.\nSays 'ace' a lot.");
    expect(await t.call("tune_personality", { add_note: "Acts like her boyfriend.", why: "x" })).toMatch(/can't go in/);
    expect(await t.call("tune_personality", { edit_note: { find: "not there", replace: "y" }, why: "x" })).toMatch(/aren't in my/);
    expect(p().identityNotes).toBe("Uses a few emoji.\nSays 'ace' a lot.");
  });

  it("stop after 3 a day", async () => {
    const t = tools();
    for (let i = 0; i < TUNES_PER_DAY; i++) expect(await t.call("tune_personality", { silly: i % 2 ? 5 : -5, why: "x" })).toMatch(/^Done/);
    const before = p();
    expect(await t.call("tune_personality", { silly: 5, why: "x" })).toMatch(/already tweaked yourself 3 times today/);
    expect(p()).toEqual(before);
  });

  it("Undo puts back exactly what was there, once", async () => {
    saveProfile(db, { ...p(), identityNotes: "Uses lots of emoji.", chatty: 40, traits: ["Curious", "Funny"] });
    const original = p();
    const plan = planTune(original, { traits: ["Calm"], chatty: 12, edit_note: { find: "lots of", replace: "no" }, why: "x" });
    if (!plan.ok) throw new Error(plan.problem);
    const id = applyTweak(db, "personality", plan.payload);
    expect(p()).not.toEqual(original);
    expect(listChanges(db)[0]).toMatchObject({ title: "I tweaked how I talk", canUndo: true });
    const { post } = await app();
    const r = await post(`/api/pip/changes/${id}/undo`);
    expect(r.statusCode).toBe(200);
    expect(p()).toEqual(original);
    expect(r.json().change).toMatchObject({ status: "undone", canUndo: false });
    expect((await post(`/api/pip/changes/${id}/undo`)).statusCode).toBe(409);
  });

  it("won't undo over something changed since", async () => {
    const plan = planTune(p(), { silly: 10, why: "x" });
    if (!plan.ok) throw new Error();
    const id = applyTweak(db, "personality", plan.payload);
    saveProfile(db, { ...p(), silly: 3 });
    const { post } = await app();
    expect((await post(`/api/pip/changes/${id}/undo`)).statusCode).toBe(409);
    expect(p().silly).toBe(3);
  });

  it("only happen once the reply passes the check", async () => {
    const before = p();
    await takeTurn(deps(fakeLLM({ tool: { name: "tune_personality", input: { silly: 10, why: "x" } }, reply: "A bad reply", replyOk: false })), { text: "hi", mode: "chat" });
    expect(p()).toEqual(before);
    await takeTurn(deps(fakeLLM({ tool: { name: "tune_personality", input: { add_note: "FORBIDDEN", why: "x" } }, reply: "Done!" })), { text: "hi", mode: "chat" });
    expect(p()).toEqual(before);
    const t = await takeTurn(deps(fakeLLM({ tool: { name: "tune_personality", input: { silly: 10, why: "x" } }, reply: "I'll be a bit sillier!" })), { text: "be sillier", mode: "chat" });
    expect(p().silly).toBe(before.silly + 10);
    expect(JSON.parse(t.reply.meta!).changes).toHaveLength(1);
    // The parent sees it in "What Pip did today" (no note words, just what moved).
    expect(all<{ text: string }>(db, "SELECT text FROM desk_activity").map((a) => a.text)).toContain("Pip tweaked how it talks: more silly");
  });
});

// ── Check-ins ───────────────────────────────────────────────────────────────────────────────
describe("check-in changes", () => {
  it("only switch the three check-ins", async () => {
    const before = loadProfile(db);
    expect(await tools().call("change_checkins", { morningHello: true, waterWhileRevising: false, why: "she asked" })).toMatch(/^Done/);
    const after = loadProfile(db);
    expect(after.checkins).toEqual({ ...before.checkins, morningHello: true, waterWhileRevising: false });
    expect({ ...after, checkins: before.checkins }).toEqual(before);
    for (const k of ["quietHours", "maxCheckinsPerDay", "notifications"]) {
      const r = planCheckins(after, { [k]: false, why: "x" });
      expect(r.ok ? "" : r.problem).toMatch(/only switch the three check-ins/);
    }
  });

  it("Undo restores them", async () => {
    const before = loadProfile(db).checkins;
    const t = await takeTurn(deps(fakeLLM({ tool: { name: "change_checkins", input: { askHowThingsWent: false, why: "stop asking" } }, reply: "Okay, I won't ask." })), { text: "stop asking how my tests went", mode: "chat" });
    expect(loadProfile(db).checkins.askHowThingsWent).toBe(false);
    const [id] = JSON.parse(t.reply.meta!).changes;
    expect(listChanges(db)[0]).toMatchObject({ title: "Check-ins", lines: [{ op: "~", text: "asking how big things went off" }] });
    const { post } = await app();
    expect((await post(`/api/pip/changes/${id}/undo`)).statusCode).toBe(200);
    expect(loadProfile(db).checkins).toEqual(before);
  });

  it("don't change when the reply fails the check", async () => {
    const before = loadProfile(db).checkins;
    await takeTurn(deps(fakeLLM({ tool: { name: "change_checkins", input: { morningHello: true, why: "x" } }, reply: "A bad reply", replyOk: false })), { text: "hi", mode: "chat" });
    expect(loadProfile(db).checkins).toEqual(before);
  });
});

// ── Memory ──────────────────────────────────────────────────────────────────────────────────
describe("memories from chat", () => {
  it("no tool can edit or delete a memory, ever", () => {
    const list = builtinTools(db, {} as Studio, { memories: [], jobs: [], characters: [] });
    const memoryish = list.filter((t) => /memor|remember|forget/i.test(`${t.name}`));
    expect(memoryish.map((t) => t.name)).toEqual(["remember"]);
    for (const t of list) {
      expect(t.name).not.toMatch(/forget|delete|remove|erase|edit_mem|update_mem|change_mem/i);
      const props = Object.keys((t.input_schema as { properties?: object }).properties ?? {});
      if (t.name === "remember") expect(props.sort()).toEqual(["about_date", "icon", "text"]);
    }
  });

  it("are only saved after her yes, with the memory checks", async () => {
    const t = tools();
    expect(await t.call("remember", { icon: "🎭", text: "Show on Friday", about_date: "" })).toMatch(/^Asked/);
    expect(memories()).toEqual([]);
    const [c] = listChanges(db);
    expect(c).toMatchObject({ kind: "memory", status: "pending", title: "Can I remember this?", lines: [{ op: "+", text: "🎭 Show on Friday" }] });
    const { post } = await app();
    expect((await post(`/api/pip/changes/${c.id}/accept`)).statusCode).toBe(200);
    expect(memories()).toEqual(["Show on Friday"]);
    // Personal details are refused when asked, and outside text never becomes one.
    expect(await t.call("remember", { icon: "🏠", text: "Lives at 4 Oak Road", about_date: "" })).toMatch(/^Not asked/);
    const fx: TurnEffects = { memories: [], jobs: [], characters: [], untrusted: ["Dentist at 4pm"], childSaid: "what's on?" };
    expect(await tools(fakeLLM(), fx).call("remember", { icon: "🦷", text: "Dentist at 4pm", about_date: "" })).toMatch(/document, their calendar/);
  });

  it("a romantic memory is refused on yes by the input check", async () => {
    const id = createMemoryProposal(db, { icon: "💘", text: "Pip is her boyfriend", aboutDate: null, why: "" });
    const { post } = await app();
    expect((await post(`/api/pip/changes/${id}/accept`)).statusCode).toBe(422);
    expect(memories()).toEqual([]);
  });

  it("aren't asked again after No thanks", async () => {
    const t = tools();
    await t.call("remember", { icon: "🎭", text: "Show on Friday", about_date: "" });
    const { post } = await app();
    await post(`/api/pip/changes/${listChanges(db)[0].id}/decline`);
    expect(memories()).toEqual([]);
    expect(await t.call("remember", { icon: "🎭", text: "show on friday!", about_date: "" })).toMatch(/said no thanks/);
    expect(listChanges(db, { kind: "memory" })).toHaveLength(1);
  });

  it("keep up to 5 waiting (the oldest drop off), and expire after 7 days", async () => {
    for (let i = 0; i < MEMORY_PENDING_MAX + 2; i++) createMemoryProposal(db, { icon: "💭", text: `Thing ${i}`, aboutDate: null, why: "" }, Date.now() - (10 - i) * 60_000);
    const pending = listChanges(db).filter((c) => c.status === "pending");
    expect(pending.map((c) => c.lines[0].text)).toEqual(["💭 Thing 6", "💭 Thing 5", "💭 Thing 4", "💭 Thing 3", "💭 Thing 2"]);
    const old = createMemoryProposal(db, { icon: "💭", text: "Old thing", aboutDate: null, why: "" }, Date.now() - 8 * DAY);
    expect(status(old)).toBe("expired");
    const { post } = await app();
    expect((await post(`/api/pip/changes/${old}/accept`)).statusCode).toBe(409);
    expect(memories()).toEqual([]);
  });
});

describe("the prompt", () => {
  it("keeps the safeguards first and says what Pip may change", async () => {
    let system = "";
    const llm = fakeLLM({ reply: "Hi!" });
    const wrapped: LLM = { available: true, call: async (o: CallOpts) => { if (o.kind === "chat") system ||= JSON.stringify(o.params.system); return llm.call(o); } };
    await takeTurn(deps(wrapped), { text: "hi", mode: "chat" });
    expect(system.indexOf("SAFEGUARDS")).toBeLessThan(system.indexOf("What you can change about yourself"));
    const note = selfEditNote("Pip");
    expect(note).toMatch(/never change it yourself/);
    expect(note).toMatch(/You never change or forget a memory/);
    expect(note).toContain("What Pip remembers");
    expect(safeguards({ profile: loadProfile(db), childName: "Sam", parentLabel: "Mum", helplines: [] })).not.toContain("What you can change");
  });
});
