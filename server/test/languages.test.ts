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
