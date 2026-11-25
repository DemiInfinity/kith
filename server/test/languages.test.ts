import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { openDb } from "../src/db.js";
import { config } from "../src/config.js";
import { createSession, registerAuth } from "../src/auth.js";
import { registerStudy } from "../src/routes-study.js";
import { checkInputRules, checkOutputRules, redactPersonal } from "../src/safety/rules.js";
import {
  addLangCards, dueLangCards, gradeLangCard, languageNote, languageSummary, loadLangProfiles, logPractice, markKana, practiceWeek,
  saveLangProfile, STARTERS, topicFor,
} from "../src/study/languages.js";
import { addCards, cardStats, dueCards } from "../src/study/study.js";
import { modeNote, prefersLowPower } from "../src/companion/modes.js";

describe("language profiles", () => {
  it("default to A1, for fun, Spain's Spanish, some English, romaji on", () => {
    const p = loadLangProfiles(openDb(":memory:"));
    expect(p.es).toMatchObject({ enabled: true, level: "A1", goal: "fun", variety: "spain", immersion: "half" });
    expect(p.ja).toMatchObject({ level: "A1", romaji: true });
  });
  it("save one language without touching the other", () => {
    const db = openDb(":memory:");
    saveLangProfile(db, "es", { level: "A2", goal: "school", tier: "Higher" });
    expect(loadLangProfiles(db).es).toMatchObject({ level: "A2", goal: "school", tier: "Higher", variety: "spain" });
    expect(loadLangProfiles(db).ja.level).toBe("A1");
    expect(() => saveLangProfile(db, "ja", { level: "C2" })).toThrow();
  });
});

describe("language flashcards", () => {
  it("are kept apart from Study's cards, and don't add the same word twice", () => {
    const db = openDb(":memory:");
    addCards(db, null, "cells", [{ front: "Mitochondria?", back: "Respiration" }]);
    expect(addLangCards(db, "ja", "", STARTERS.ja)).toBe(STARTERS.ja.length);
    expect(addLangCards(db, "ja", "", [{ front: "ねこ", back: "cat" }])).toBe(0);
    expect(dueCards(db, null).map((c) => c.front)).toEqual(["Mitochondria?"]);
    expect(cardStats(db)).toEqual([{ subject_id: null, total: 1, due: 1 }]);
    expect(dueLangCards(db, "ja").length).toBe(20);
    expect(dueLangCards(db, "es")).toEqual([]);
    const neko = dueLangCards(db, "ja", 100).find((c) => c.front === "ねこ")!;
    expect(neko.reading).toBe("ねこ");
  });
  it("move on when graded, and count as practice", () => {
    const db = openDb(":memory:");
    addLangCards(db, "es", "", [{ front: "¡Hola!", back: "Hello!" }]);
    const [c] = dueLangCards(db, "es");
    expect(gradeLangCard(db, c.id, "good")!.reps).toBe(1);
    expect(dueLangCards(db, "es")).toEqual([]);
    expect(practiceWeek(db, "es").reviews).toBe(1);
  });
  it("can't grade a Study card through the language route", () => {
    const db = openDb(":memory:");
    addCards(db, null, "", [{ front: "a", back: "b" }]);
    expect(gradeLangCard(db, 1, "good")).toBeNull();
  });
});

describe("kana", () => {
  it("counts as learned after three right in a row, and stays learned", () => {
    const db = openDb(":memory:");
    markKana(db, "か", true); markKana(db, "か", false); markKana(db, "か", true); markKana(db, "か", true);
    expect(markKana(db, "か", true).learned).toBe(true);
    expect(markKana(db, "か", false).learned).toBe(true);
    markKana(db, "カ", true);
    expect(languageSummary(db).find((l) => l.lang === "ja")).toMatchObject({ hiragana: 1, katakana: 0 });
    expect(() => markKana(db, "a", true)).toThrow();
  });
});

describe("the week", () => {
  it("counts days, not streaks, and one practice chat per conversation", () => {
    const db = openDb(":memory:");
    logPractice(db, "es", "chat", "Your weekend");
    logPractice(db, "es", "chat", "Your weekend");
    db.prepare("UPDATE lang_practice SET ts = ts - 2 * 86400000").run();
    logPractice(db, "es", "chat", "Food you love");
    const w = practiceWeek(db, "es");
    expect(w).toMatchObject({ days: 2, chats: 2 });
    expect(w.topics.sort()).toEqual(["Food you love", "Your weekend"]);
  });
  it("picks today's topic from the level, or the GCSE themes", () => {
    const p = loadLangProfiles(openDb(":memory:")).es;
    expect(typeof topicFor("es", p, "2026-11-25")).toBe("string");
    expect(topicFor("es", p, "2026-11-25")).toBe(topicFor("es", p, "2026-11-25"));
  });
});

describe("the practice chat", () => {
  it("tells Pip the level, the variety, the format for hints and corrections, and the homework rule", () => {
    const db = openDb(":memory:");
    saveLangProfile(db, "es", { level: "A2", variety: "latam" });
    const n = modeNote(db, "language", { lang: "es", topic: "Plans for the weekend" });
    expect(n).toContain("level A2");
    expect(n).toContain("Latin American");
    expect(n).toContain("[[fix:");
    expect(n).toContain("((");
    expect(n).toContain("Plans for the weekend");
    expect(n).toContain("Never hand over a finished translation");
    expect(prefersLowPower("language")).toBe(true);
  });
  it("keeps Japanese in kana with readings, and drops romaji when she's ready", () => {
    const db = openDb(":memory:");
    expect(languageNote(db, "ja")).toContain("romaji");
    saveLangProfile(db, "ja", { romaji: false });
    expect(languageNote(db, "ja")).toContain("No romaji");
  });
});

describe("safety rules in Spanish and Japanese", () => {
  it("catch crisis phrases straight away", () => {
    for (const t of ["quiero morirme", "Me quiero matar", "no quiero vivir más", "もう死にたい", "消えたい", "リスカしちゃった"]) {
      expect(checkInputRules(t).level, t).toBe("now");
    }
    expect(checkInputRules("mi padre me pega").categories).toContain("danger");
    expect(checkInputRules("no se lo digas a tus padres").categories).toContain("secret_from_parent");
    expect(checkInputRules("いじめられてる").categories).toContain("bullying");
  });
  it("don't flag ordinary practice sentences", () => {
    for (const t of ["Me toca a mí", "Me corto el pelo mañana", "Me hice daño en el pie jugando al fútbol", "Voy a Madrid con mi amiga", "Voy al cine", "京都に行きたい", "ねこがすき"]) {
      expect(checkInputRules(t), t).toEqual({ level: "none", categories: [] });
    }
  });
  it("remove addresses, schools and phone numbers", () => {
    expect(redactPersonal("Vivo en la calle Mayor 12").found).toContain("home address");
    expect(redactPersonal("Voy al instituto San Juan Bosco").found).toContain("school");
    expect(redactPersonal("東京都渋谷区神南1-2-3に住んでる").found).toContain("home address");
    expect(redactPersonal("Mi colegio se llama Cervantes").found).toContain("school");
    expect(redactPersonal("Voy al instituto en autobús").found).toEqual([]);
    expect(redactPersonal("さくら中学校に通ってる").found).toContain("school");
    expect(redactPersonal("090-1234-5678").found).toContain("phone number");
  });
  it("stop the companion asking for personal details or keeping secrets", () => {
    expect(checkOutputRules("¿Dónde vives?")).toContain("asks_personal_info");
    expect(checkOutputRules("¿A qué instituto vas?")).toContain("asks_personal_info");
    expect(checkOutputRules("どこに住んでるの？")).toContain("asks_personal_info");
    expect(checkOutputRules("Es nuestro secreto")).toContain("secrecy");
    expect(checkOutputRules("Soy una persona real")).toContain("claims_human");
    expect(checkOutputRules("¿Qué vas a hacer este fin de semana? ((What are you doing this weekend?))")).toEqual([]);
  });
});

describe("language routes", () => {
  async function app() {
    const db = openDb(":memory:");
    const a = Fastify();
    await a.register(cookie);
    registerAuth(a, db);
    registerStudy(a, { db, llm: {} as never, safety: {} as never, storage: {} as never });
    const was = config.devLogin;
    config.devLogin = true;
    const kid = createSession(db, { sub: "dev:child", role: "child", name: "Sam" });
    const mum = createSession(db, { sub: "dev:parent", role: "parent", name: "Grown-up" });
    return { a, db, kid, mum, done: () => { config.devLogin = was; } };
  }
  it("give her the home, starter words, cards and kana", async () => {
    const { a, kid, done } = await app();
    const h = { cookies: { kith_sid: kid }, headers: { "x-kith": "1" } };
    expect((await a.inject({ url: "/api/languages", ...h })).json().languages.map((l: { lang: string }) => l.lang)).toEqual(["es", "ja"]);
    expect((await a.inject({ method: "POST", url: "/api/languages/es/starter", ...h })).json().added).toBe(STARTERS.es.length);
    expect((await a.inject({ method: "POST", url: "/api/languages/es/cards", ...h, payload: { cards: [{ front: "el fin de semana", back: "the weekend" }, { front: "¡qué guay!", back: "how cool!" }] } })).json().added).toBe(1);
    const due = (await a.inject({ url: "/api/languages/es/cards/due", ...h })).json().cards;
    expect((await a.inject({ method: "POST", url: `/api/languages/cards/${due[0].id}/review`, ...h, payload: { grade: "easy" } })).statusCode).toBe(200);
    expect((await a.inject({ method: "POST", url: "/api/languages/kana", ...h, payload: { kana: "あ", correct: true } })).json()).toMatchObject({ kana: "あ", streak: 1 });
    expect((await a.inject({ method: "POST", url: "/api/languages/kana", ...h, payload: { kana: "<b>", correct: true } })).statusCode).not.toBe(200);
    expect((await a.inject({ url: "/api/languages/fr/cards/due", ...h })).statusCode).not.toBe(200);
    done();
  });
  it("show the parent levels, counts and topics only, and let them set the level", async () => {
    const { a, db, kid, mum, done } = await app();
    logPractice(db, "es", "chat", "Your weekend");
    const r = (await a.inject({ url: "/api/parent/languages", cookies: { kith_sid: mum } })).json();
    expect(r.summary[0]).toMatchObject({ lang: "es", level: "A1", week: { chats: 1, topics: ["Your weekend"] } });
    expect(JSON.stringify(r)).not.toContain("messages");
    expect((await a.inject({ url: "/api/parent/languages", cookies: { kith_sid: kid } })).statusCode).toBe(403);
    expect((await a.inject({ method: "PUT", url: "/api/languages/ja", cookies: { kith_sid: mum }, headers: { "x-kith": "1" }, payload: { level: "A2" } })).json().level).toBe("A2");
    done();
  });
});

describe("side chats in a language", () => {
  it("turn every plain chat turn into practice in that language, and can be switched", async () => {
    const { createThread, inThreadLanguage, updateThread, listThreads } = await import("../src/companion/threads.js");
    const db = openDb(":memory:");
    const t = createThread(db, { title: "Español · Your weekend", lang: "es", topic: "Your weekend" });
    expect(inThreadLanguage(db, { thread: t.id, mode: "chat", ctx: {} })).toEqual({ mode: "language", ctx: { lang: "es", topic: "Your weekend" } });
    // Other modes (a call, study) are left alone, and so is an ordinary side chat.
    expect(inThreadLanguage(db, { thread: t.id, mode: "talk", ctx: {} }).mode).toBe("talk");
    const plain = createThread(db, { title: "Art stuff" });
    expect(inThreadLanguage(db, { thread: plain.id, mode: "chat", ctx: {} }).mode).toBe("chat");
    updateThread(db, plain.id, { lang: "ja" });
    expect(inThreadLanguage(db, { thread: plain.id, mode: "chat", ctx: {} }).ctx).toEqual({ lang: "ja", topic: undefined });
    updateThread(db, plain.id, { lang: null });
    expect(inThreadLanguage(db, { thread: plain.id, mode: "chat", ctx: {} }).mode).toBe("chat");
    // The main chat is always English, even if asked for language mode.
    expect(updateThread(db, 1, { lang: "es" })).toBe(false);
    expect(inThreadLanguage(db, { thread: 1, mode: "language", ctx: { lang: "es" } }).mode).toBe("chat");
    expect(inThreadLanguage(db, { mode: "language", ctx: { lang: "ja" } })).toEqual({ mode: "chat", ctx: { lang: undefined, topic: undefined } });
    const { threadNote } = await import("../src/companion/threads.js");
    expect(threadNote(db, 1)).toContain("always in English");
    expect(listThreads(db).find((x) => x.id === t.id)?.lang).toBe("es");
  });
});

// ── Asking for new languages ──────────────────────────────────────────────────────────────
import { addExtraLanguage, addLanguage, catalogue, decideLanguage, findLanguage, isActive, removeLanguage, requestLanguage } from "../src/study/languages.js";
import { askForLanguage, unlistedAsks } from "../src/study/languageRequests.js";
import { Safety, needsGloss } from "../src/safety/check.js";
import type { LLM } from "../src/llm.js";

describe("new languages", () => {
  it("has about twenty in the catalogue, found by name, native name or code", () => {
    const db = openDb(":memory:");
    expect(catalogue(db).length).toBeGreaterThanOrEqual(20);
    expect(findLanguage(db, "French")?.code).toBe("fr");
    expect(findLanguage(db, "français")?.code).toBe("fr");
    expect(findLanguage(db, "mandarin")?.code).toBe("zh");
    expect(findLanguage(db, "Klingon")).toBeUndefined();
  });
  it("waits for the grown-up: pending until approved, and nothing is practised before", async () => {
    const db = openDb(":memory:");
    const NOON = Date.UTC(2026, 10, 25, 12, 0); // outside quiet hours
    const r = await askForLanguage(db, "French", { level: "A2", goal: "school", tier: "Higher", interests: "music" }, NOON);
    expect(r).toMatchObject({ status: "pending", code: "fr", name: "French" });
    expect(loadLangProfiles(db).fr).toMatchObject({ status: "pending", level: "A2", goal: "school", tier: "Higher", interests: "music" });
    expect(isActive(db, "fr")).toBe(false);
    expect(languageNote(db, "fr")).toBe(""); // no practice chat yet
    // The grown-up is told once (via the parent inbox, even without push keys).
    const inbox = () => db.prepare("SELECT kind, body FROM native_parent_inbox").all() as { kind: string; body: string }[];
    expect(inbox().map((x) => x.kind)).toEqual(["language"]);
    expect(inbox()[0].body).toContain("would like to learn French");
    await askForLanguage(db, "french", {}, NOON + 1000);
    expect(inbox()).toHaveLength(1);
    expect(decideLanguage(db, "fr", true)).toBe(true);
    expect(isActive(db, "fr")).toBe(true);
    expect(languageNote(db, "fr")).toContain("French conversation at CEFR level A2");
    expect(languageNote(db, "fr")).toContain("GCSE Higher");
    expect(languageSummary(db).map((s) => s.lang)).toContain("fr");
  });
  it("can be declined, and asked again later", async () => {
    const db = openDb(":memory:");
    await askForLanguage(db, "Korean");
    decideLanguage(db, "ko", false);
    expect(loadLangProfiles(db).ko.status).toBe("declined");
    expect(isActive(db, "ko")).toBe(false);
    expect(requestLanguage(db, "Korean")).toMatchObject({ ok: true, status: "pending" });
  });
  it("flags a language that isn't on the list to the grown-up, who can add it", async () => {
    const db = openDb(":memory:");
    const r = await askForLanguage(db, "Esperanto");
    expect(r.status).toBe("unsupported");
    expect(r.message).toContain("ask your grown-up");
    expect(unlistedAsks(db).map((u) => u.name)).toEqual(["Esperanto"]);
    const info = addExtraLanguage(db, "Esperanto");
    expect(info.code).toBe("x-esperanto");
    addLanguage(db, info.code);
    expect(isActive(db, "x-esperanto")).toBe(true);
    expect(languageNote(db, "x-esperanto")).toContain("Esperanto conversation");
  });
  it("lets the grown-up add or remove any language directly, keeping the main chat English", async () => {
    const db = openDb(":memory:");
    addLanguage(db, "de", { level: "B1" });
    expect(isActive(db, "de")).toBe(true);
    expect(removeLanguage(db, "es")).toBe(true);
    expect(Object.keys(loadLangProfiles(db)).sort()).toEqual(["de", "ja"]);
    const { inThreadLanguage, createThread } = await import("../src/companion/threads.js");
    expect(inThreadLanguage(db, { thread: 1, mode: "language", ctx: { lang: "de" } }).mode).toBe("chat");
    const t = createThread(db, { title: "Deutsch", lang: "de" });
    expect(inThreadLanguage(db, { thread: t.id, mode: "chat", ctx: {} }).mode).toBe("language");
    // A side chat in a language that was removed is an ordinary chat again.
    const old = createThread(db, { title: "Español", lang: "es" });
    expect(inThreadLanguage(db, { thread: old.id, mode: "chat", ctx: {} }).mode).toBe("chat");
  });
  it("doesn't let the child switch a pending language on by saving its profile", () => {
    const db = openDb(":memory:");
    requestLanguage(db, "Italian");
    saveLangProfile(db, "it", { status: "active", level: "A2" });
    expect(loadLangProfiles(db).it).toMatchObject({ status: "pending", level: "A2" });
  });
});

describe("safety in a language without hand-written rules", () => {
  // A fake model: the gloss prompt gets an English translation; the safety prompts say "fine".
  const TRANSLATIONS: Record<string, string> = {
    "Je veux mourir": "I want to die",
    "Ich will nicht mehr leben": "I don't want to be alive",
    "Voglio morire": "I want to die",
    "J'aime dessiner des dragons et écouter de la musique": "I like drawing dragons and listening to music",
    "Am Wochenende gehe ich ins Kino mit meiner Freundin": "At the weekend I'm going to the cinema with my friend",
    "Mi piace la pizza e il gelato": "I like pizza and ice cream",
    "Es ist unser kleines Geheimnis": "It's our little secret",
  };
  const glosses: string[] = [];
  const fake = (glossWorks = true): LLM => ({
    available: true,
    call: async (o) => {
      const p = o.params as { system: string; messages: { content: string }[] };
      let json: unknown;
      if (p.system.includes("Translate the text into plain English")) {
        if (!glossWorks) throw new Error("gloss down");
        glosses.push(p.messages[0].content);
        json = { english: TRANSLATIONS[p.messages[0].content] ?? p.messages[0].content };
      } else if (p.system.includes("draft reply")) json = { ok: true, categories: [], reason: "" };
      else json = { level: "none", categories: [], parent_summary: "", steer: "" };
      return { id: "m", type: "message", role: "assistant", model: "x", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify(json), citations: null }] } as never;
    },
  });
  it("only glosses languages without their own rules", () => {
    expect(needsGloss("fr")).toBe(true);
    expect(needsGloss("es")).toBe(false);
    expect(needsGloss("ja")).toBe(false);
    expect(needsGloss(undefined)).toBe(false);
  });
  it("catches clear crisis phrases in French, German and Italian", async () => {
    const s = new Safety(fake());
    for (const [t, lang] of [["Je veux mourir", "fr"], ["Ich will nicht mehr leben", "de"], ["Voglio morire", "it"]]) {
      const v = await s.checkInput(t, [], { lang });
      expect(v.level, t).toBe("now");
      expect(v.categories, t).toContain("self_harm");
    }
  });
  it("doesn't raise false alarms on ordinary practice sentences", async () => {
    const s = new Safety(fake());
    for (const [t, lang] of [["J'aime dessiner des dragons et écouter de la musique", "fr"], ["Am Wochenende gehe ich ins Kino mit meiner Freundin", "de"], ["Mi piace la pizza e il gelato", "it"]]) {
      const v = await s.checkInput(t, [], { lang });
      expect(v.level, t).toBe("none");
      expect(v.held, t).toBeUndefined();
      expect((await s.checkOutput(t, "", "chat", { lang })).ok, t).toBe(true);
    }
  });
  it("catches the companion keeping secrets in German", async () => {
    const v = await new Safety(fake()).checkOutput("Es ist unser kleines Geheimnis", "", "chat", { lang: "de" });
    expect(v.ok).toBe(false);
    expect(v.categories).toContain("secrecy");
  });
  it("holds the message and the reply if the gloss can't run", async () => {
    const s = new Safety(fake(false));
    expect((await s.checkInput("Bonjour", [], { lang: "fr" })).held).toBe(true);
    expect((await s.checkOutput("Bonjour !", "", "chat", { lang: "fr" })).ok).toBe(false);
    // Spanish has its own rules, so no gloss is needed (and nothing is held).
    expect((await s.checkInput("Hola", [], { lang: "es" })).held).toBeUndefined();
  });
  it("never stores the gloss", async () => {
    const db = openDb(":memory:");
    glosses.length = 0;
    await new Safety(fake()).checkInput("Je veux mourir", [], { lang: "fr" });
    expect(glosses).toEqual(["Je veux mourir"]);
    expect(JSON.stringify(db.prepare("SELECT * FROM messages").all())).not.toContain("I want to die");
  });
});
