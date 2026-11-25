// Languages: Spanish and Japanese, learned the way she already uses Kith. A profile per language
// (level, goal, Spanish variety, how much English Pip uses, romaji or not), flashcards with a
// reading, a kana chart she fills in, a practice chat mode, and a small practice log so both she and
// the parent can see "4 days this week" (never a streak to lose). The parent sees topics and counts,
// never the practice chats themselves. Drills and flashcards use no AI at all.

import { z } from "zod";
import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { config } from "../config.js";
import { localDate } from "../budget/time.js";
import { redactPersonal } from "../safety/rules.js";
import { review, type Grade } from "./study.js";

export const LANGS = ["es", "ja"] as const;
export type Lang = (typeof LANGS)[number];
export const LANG_NAME: Record<Lang, string> = { es: "Spanish", ja: "Japanese" };
export const LEVELS = ["A1", "A2", "B1"] as const;

export const LangProfile = z.object({
  enabled: z.boolean().default(true),
  level: z.enum(LEVELS).default("A1"),
  // "school" follows the GCSE themes (Spanish) or JLPT N5 (Japanese); "fun" follows her interests.
  goal: z.enum(["school", "fun"]).default("fun"),
  board: z.string().max(40).default(""),
  tier: z.enum(["Foundation", "Higher"]).default("Foundation"),
  // Spanish only: GCSE uses Spain's Spanish (with vosotros).
  variety: z.enum(["spain", "latam"]).default("spain"),
  // How much English Pip uses: lots, about half, or hardly any (a hint is always one tap away).
  immersion: z.enum(["light", "half", "full"]).default("half"),
  // Japanese only: show romaji as a crutch she can switch off.
  romaji: z.boolean().default(true),
  interests: z.string().max(200).default(""),
});
export type LangProfile = z.infer<typeof LangProfile>;
export type LangProfiles = Record<Lang, LangProfile>;

const DEFAULTS: Record<Lang, Partial<LangProfile>> = { es: {}, ja: {} };

export function loadLangProfiles(db: DB): LangProfiles {
  const r = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'languages'");
  const raw = (r ? JSON.parse(r.json) : {}) as Partial<Record<Lang, unknown>>;
  return { es: LangProfile.parse(raw.es ?? DEFAULTS.es), ja: LangProfile.parse(raw.ja ?? DEFAULTS.ja) };
}
export function saveLangProfile(db: DB, lang: Lang, input: unknown): LangProfile {
  const all = loadLangProfiles(db);
  all[lang] = LangProfile.parse({ ...all[lang], ...(input as object) });
  run(db, "INSERT INTO settings(key, json) VALUES('languages', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(all));
  return all[lang];
}

// ── Flashcards (the same spaced repetition as Study, kept apart from Study's cards) ─────────

export interface LangCard { id: number; lang: Lang; topic: string; front: string; back: string; reading: string; ease: number; interval_days: number; reps: number; due: number }

export function addLangCards(db: DB, lang: Lang, topic: string, cards: { front: string; back: string; reading?: string }[]): number {
  const now = Date.now();
  let n = 0;
  for (const c of cards.slice(0, 60)) {
    const front = redactPersonal(c.front.trim()).text.slice(0, 200);
    const back = redactPersonal(c.back.trim()).text.slice(0, 300);
    const reading = (c.reading ?? "").trim().slice(0, 120);
    if (!front || !back) continue;
    // The same word twice is just noise.
    if (get(db, "SELECT 1 FROM cards WHERE lang = ? AND front = ?", lang, front)) continue;
    run(db, "INSERT INTO cards(subject_id, topic, front, back, due, created, lang, reading) VALUES (NULL,?,?,?,?,?,?,?)", topic.slice(0, 80), front, back, now, now, lang, reading);
    n++;
  }
  return n;
}
export function dueLangCards(db: DB, lang: Lang, limit = 20): LangCard[] {
  return all<LangCard>(db, "SELECT id, lang, topic, front, back, reading, ease, interval_days, reps, due FROM cards WHERE lang = ? AND due <= ? ORDER BY due LIMIT ?", lang, Date.now(), limit);
}
export function gradeLangCard(db: DB, id: number, grade: Grade) {
  const c = get<LangCard>(db, "SELECT * FROM cards WHERE id = ? AND lang IS NOT NULL", id);
  if (!c) return null;
  const n = review(c, grade, Date.now());
  run(db, "UPDATE cards SET ease = ?, interval_days = ?, reps = ?, due = ? WHERE id = ?", n.ease, n.interval_days, n.reps, n.due, id);
  logPractice(db, c.lang, "cards");
  return { ...c, ...n };
}
export function langCardStats(db: DB, lang: Lang) {
  const r = get<{ total: number; due: number; known: number }>(db,
    "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN due <= ? THEN 1 ELSE 0 END), 0) AS due, COALESCE(SUM(CASE WHEN reps >= 2 THEN 1 ELSE 0 END), 0) AS known FROM cards WHERE lang = ?", Date.now(), lang);
  return r ?? { total: 0, due: 0, known: 0 };
}

/** A first handful of words, so day one isn't an empty screen. No AI needed. */
export const STARTERS: Record<Lang, { front: string; back: string; reading?: string }[]> = {
  es: [
    ["¡Hola!", "Hello!"], ["¿Qué tal?", "How's it going?"], ["Me llamo…", "My name is…"], ["Tengo … años", "I'm … years old"],
    ["Me gusta dibujar", "I like drawing"], ["No me gusta…", "I don't like…"], ["Me encanta la música", "I love music"],
    ["el fin de semana", "the weekend"], ["mi mejor amiga", "my best friend (girl)"], ["el instituto", "secondary school"],
    ["los deberes", "homework"], ["¿Qué vas a hacer?", "What are you going to do?"], ["Voy a…", "I'm going to…"],
    ["¡Qué guay!", "How cool! (Spain)"], ["a veces", "sometimes"], ["siempre", "always"], ["nunca", "never"],
    ["porque", "because"], ["pero", "but"], ["también", "also / too"], ["Gracias", "Thank you"], ["Por favor", "Please"],
    ["¿Puedes repetir?", "Can you say that again?"], ["No entiendo", "I don't understand"], ["¡Hasta luego!", "See you later!"],
  ].map(([front, back]) => ({ front, back })),
  ja: [
    ["こんにちは", "Hello", "こんにちは"], ["ありがとう", "Thank you", "ありがとう"], ["すみません", "Excuse me / sorry", "すみません"],
    ["はい", "Yes", "はい"], ["いいえ", "No", "いいえ"], ["おはよう", "Good morning (casual)", "おはよう"], ["またね", "See you!", "またね"],
    ["ねこ", "cat", "ねこ"], ["いぬ", "dog", "いぬ"], ["すし", "sushi", "すし"], ["ラーメン", "ramen", "らーめん"], ["アニメ", "anime", "あにめ"],
    ["まんが", "manga", "まんが"], ["すき", "like", "すき"], ["だいすき", "love (a thing)", "だいすき"], ["かわいい", "cute", "かわいい"],
    ["たのしい", "fun", "たのしい"], ["おいしい", "tasty", "おいしい"], ["わたし", "I / me", "わたし"], ["ともだち", "friend", "ともだち"],
    ["がっこう", "school", "がっこう"], ["えをかく", "to draw (a picture)", "えをかく"], ["日本", "Japan", "にほん"], ["日本語", "Japanese (language)", "にほんご"],
    ["わかりません", "I don't understand", "わかりません"],
  ].map(([front, back, reading]) => ({ front, back, reading })),
};

// ── Kana (hiragana and katakana) ────────────────────────────────────────────────────────────

export const KANA_RE = /^[ぁ-ゖァ-ヺー]{1,2}$/;
const LEARNED_AFTER = 3; // right three times in a row

export function kanaProgress(db: DB) {
  return all<{ kana: string; streak: number; right: number; seen: number; learned: number }>(db, "SELECT kana, streak, right, seen, learned FROM kana_progress");
}
export function markKana(db: DB, kana: string, correct: boolean) {
  if (!KANA_RE.test(kana)) throw new Error("not a kana");
  const r = get<{ streak: number; learned: number }>(db, "SELECT streak, learned FROM kana_progress WHERE kana = ?", kana);
  const streak = correct ? (r?.streak ?? 0) + 1 : 0;
  const learned = r?.learned || streak >= LEARNED_AFTER ? 1 : 0;
  run(db, `INSERT INTO kana_progress(kana, streak, right, seen, learned, updated) VALUES (?,?,?,1,?,?)
    ON CONFLICT(kana) DO UPDATE SET streak = excluded.streak, right = right + excluded.right, seen = seen + 1, learned = excluded.learned, updated = excluded.updated`,
    kana, streak, correct ? 1 : 0, learned, Date.now());
  logPractice(db, "ja", "kana");
  return { kana, streak, learned: !!learned };
}

// ── Practice log (for "days this week", and the parent's topic-level view) ──────────────────

export type PracticeKind = "cards" | "chat" | "kana";
export function logPractice(db: DB, lang: Lang, kind: PracticeKind, topic = "") {
  // A practice chat is one conversation, not one per message: a new one after half an hour apart.
  if (kind === "chat" && get(db, "SELECT 1 FROM lang_practice WHERE lang = ? AND kind = 'chat' AND ts > ?", lang, Date.now() - 30 * 60_000)) return;
  run(db, "INSERT INTO lang_practice(ts, lang, kind, topic) VALUES (?,?,?,?)", Date.now(), lang, kind, redactPersonal(topic).text.slice(0, 80));
}

const DAY = 86_400_000;
export interface LangWeek { days: number; chats: number; reviews: number; kana: number; topics: string[] }
export function practiceWeek(db: DB, lang: Lang, now = Date.now()): LangWeek {
  const rows = all<{ ts: number; kind: PracticeKind; topic: string }>(db, "SELECT ts, kind, topic FROM lang_practice WHERE lang = ? AND ts > ?", lang, now - 7 * DAY);
  return {
    days: new Set(rows.map((r) => localDate(r.ts, config.timezone))).size,
    chats: rows.filter((r) => r.kind === "chat").length,
    reviews: rows.filter((r) => r.kind === "cards").length,
    kana: rows.filter((r) => r.kind === "kana").length,
    topics: [...new Set(rows.filter((r) => r.kind === "chat" && r.topic).map((r) => r.topic))].slice(0, 8),
  };
}

// ── Today's ten minutes ─────────────────────────────────────────────────────────────────────

/** GCSE Spanish themes (AQA-style; other boards cover the same ground). */
export const GCSE_THEMES = [
  "Me, my family and friends", "Technology in everyday life", "Free-time activities", "Customs and festivals",
  "Home, town and region", "Social issues", "Global issues", "Travel and tourism", "My studies", "Life at school", "Jobs and future plans",
];
const TOPICS: Record<Lang, Record<string, string[]>> = {
  es: {
    A1: ["Saying hello and who you are", "What you like and don't like", "Your weekend", "Food you love", "Your favourite things"],
    A2: ["Plans for the weekend", "A film or series you watched", "Your ideal day", "Ordering food in a café", "Describing a character you drew"],
    B1: ["A holiday you'd love to go on", "Social media: good or bad?", "What you'd change about school", "Your dream job", "A story about a dragon"],
  },
  ja: {
    A1: ["Greetings and saying thank you", "Things you like (すき)", "Animals and food", "Counting to ten", "Introducing yourself (no real details)"],
    A2: ["Ordering ramen", "Your favourite anime", "What you did today", "Shopping for a gift", "The weather"],
    B1: ["Planning a trip to Tokyo", "A story you'd write", "Hobbies and why you love them", "School life in Japan", "Your favourite song"],
  },
};
export function topicFor(lang: Lang, p: LangProfile, dateKey: string): string {
  const list = lang === "es" && p.goal === "school" ? GCSE_THEMES : TOPICS[lang][p.level];
  const n = [...dateKey].reduce((t, c) => t + c.charCodeAt(0), 0);
  return list[n % list.length];
}

// ── What Pip is told in a practice chat ─────────────────────────────────────────────────────

const LEVEL_STYLE: Record<string, string> = {
  A1: "very short sentences, present tense, the most common words, and lots of repetition",
  A2: "short sentences, present, near future (ir a) and simple past, everyday words",
  B1: "natural sentences, a range of tenses, opinions with reasons, and the odd idiom",
};
const IMMERSION: Record<LangProfile["immersion"], string> = {
  light: "Write mostly in the target language, and add an English translation of every line as a hint.",
  half: "Write in the target language, and add a short English hint for anything new or tricky.",
  full: "Stay in the target language. Add an English hint only when they seem stuck or ask.",
};

export function languageNote(db: DB, lang: Lang | undefined, topic?: string): string {
  if (!lang) return "";
  const p = loadLangProfiles(db)[lang];
  const name = LANG_NAME[lang];
  const variety = lang === "es" ? (p.variety === "spain" ? " Use Spain's Spanish (vosotros, European vocabulary)." : " Use Latin American Spanish (ustedes, no vosotros).") : "";
  const script = lang === "ja"
    ? `Write in hiragana and katakana, with only the simplest kanji; when you use a kanji, put its reading in brackets straight after it, like 日本(にほん).${p.romaji ? " Put romaji inside the English hint." : " No romaji: they're reading kana now."}`
    : "";
  const goal = p.goal === "school"
    ? lang === "es" ? ` They're studying GCSE Spanish (${p.tier}${p.board ? `, ${p.board}` : ""}): steer towards GCSE themes and the kind of language that earns marks (opinions with reasons, three time frames).` : " They're aiming for JLPT N5: stick to N5 grammar and vocabulary."
    : p.interests ? ` They love: ${p.interests}. Use that to make it fun.` : "";
  return [
    `You're in language practice: a friendly ${name} conversation at CEFR level ${p.level} (${LEVEL_STYLE[p.level]}).${variety}${goal}`,
    topic ? `Today's topic: ${topic}. Keep the conversation on it, gently.` : "",
    IMMERSION[p.immersion],
    script,
    `Format, exactly (the app turns these into tappable notes):
- An English hint goes in double round brackets right after the line it explains: ((What are you doing this weekend?))
- If they made a mistake, fix only the ONE most useful thing, kindly, as: [[fix: what they wrote → better version | a few words why]]. Praise what was right first. Never a list of errors.
- Offer one or two useful words or phrases from the conversation to save as flashcards, as: [[save: target-language phrase | English meaning${lang === "ja" ? " | reading in hiragana" : ""}]]
- End with a question so they can reply. Keep each turn short.`,
    "It's practice, not a test: be encouraging and patient. If they switch to English to tell you something that matters (worries, feelings, safety), answer in English and look after them first; the safety rules always come first.",
    "Never ask for real personal details (their full name, school, address, photos), even for practice: make up an example instead.",
    "Homework rule: if they paste homework to translate or write, help them work it out together, step by step. Never hand over a finished translation or answer for them to submit.",
  ].filter(Boolean).join("\n");
}

// ── The parent's view (topic level only) ────────────────────────────────────────────────────

export function languageSummary(db: DB) {
  const profiles = loadLangProfiles(db);
  const learnedKana = kanaProgress(db).filter((k) => k.learned);
  return LANGS.filter((l) => profiles[l].enabled).map((lang) => ({
    lang, name: LANG_NAME[lang], level: profiles[lang].level, goal: profiles[lang].goal,
    words: langCardStats(db, lang).known, cards: langCardStats(db, lang).total, week: practiceWeek(db, lang),
    ...(lang === "ja" ? { hiragana: learnedKana.filter((k) => /[ぁ-ゖ]/.test(k.kana)).length, katakana: learnedKana.filter((k) => /[ァ-ヺ]/.test(k.kana)).length } : {}),
  }));
}
