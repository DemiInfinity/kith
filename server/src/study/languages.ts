// Languages: Spanish and Japanese to start, and any other she asks for once her grown-up says yes,
// learned the way she already uses Kith. A profile per language
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

// ── Which languages ─────────────────────────────────────────────────────────────────────────

/** A language Kith can teach. `voice` is the device-voice locale; `romanisation` names the crutch
 *  for languages with their own script (romaji, pinyin…); `rules` means hand-written safety rules exist. */
export interface LangInfo { code: string; name: string; native: string; badge: string; voice: string; romanisation?: string; rules?: boolean; gcse?: boolean }

/** About twenty languages the companion handles well. The parent can add more (see `extraLanguages`). */
export const CATALOGUE: LangInfo[] = [
  { code: "es", name: "Spanish", native: "Español", badge: "Ñ", voice: "es-ES", rules: true, gcse: true },
  { code: "ja", name: "Japanese", native: "日本語", badge: "あ", voice: "ja-JP", romanisation: "romaji", rules: true, gcse: true },
  { code: "fr", name: "French", native: "Français", badge: "Ç", voice: "fr-FR", gcse: true },
  { code: "de", name: "German", native: "Deutsch", badge: "ß", voice: "de-DE", gcse: true },
  { code: "it", name: "Italian", native: "Italiano", badge: "It", voice: "it-IT", gcse: true },
  { code: "pt", name: "Portuguese", native: "Português", badge: "Ã", voice: "pt-PT", gcse: true },
  { code: "nl", name: "Dutch", native: "Nederlands", badge: "Ij", voice: "nl-NL" },
  { code: "cy", name: "Welsh", native: "Cymraeg", badge: "Ŵ", voice: "cy-GB", gcse: true },
  { code: "ga", name: "Irish", native: "Gaeilge", badge: "Á", voice: "ga-IE", gcse: true },
  { code: "ko", name: "Korean", native: "한국어", badge: "한", voice: "ko-KR", romanisation: "romanisation" },
  { code: "zh", name: "Mandarin Chinese", native: "中文", badge: "中", voice: "zh-CN", romanisation: "pinyin", gcse: true },
  { code: "yue", name: "Cantonese", native: "粵語", badge: "粵", voice: "zh-HK", romanisation: "jyutping" },
  { code: "ar", name: "Arabic", native: "العربية", badge: "ع", voice: "ar-SA", romanisation: "transliteration", gcse: true },
  { code: "hi", name: "Hindi", native: "हिन्दी", badge: "हि", voice: "hi-IN", romanisation: "transliteration" },
  { code: "ur", name: "Urdu", native: "اردو", badge: "ا", voice: "ur-PK", romanisation: "transliteration", gcse: true },
  { code: "pl", name: "Polish", native: "Polski", badge: "Ł", voice: "pl-PL", gcse: true },
  { code: "ru", name: "Russian", native: "Русский", badge: "Я", voice: "ru-RU", romanisation: "transliteration", gcse: true },
  { code: "el", name: "Greek", native: "Ελληνικά", badge: "Ω", voice: "el-GR", romanisation: "transliteration", gcse: true },
  { code: "tr", name: "Turkish", native: "Türkçe", badge: "Ğ", voice: "tr-TR", gcse: true },
  { code: "sv", name: "Swedish", native: "Svenska", badge: "Å", voice: "sv-SE" },
];
export const CODE_RE = /^([a-z]{2,3}|x)(-[a-z0-9]{2,12})?$/;
export const LangCode = z.string().regex(CODE_RE);

/** Languages the parent added that aren't in the catalogue (custom code "x-…"). */
export function extraLanguages(db: DB): LangInfo[] {
  const r = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'languages_extra'");
  return r ? (JSON.parse(r.json) as LangInfo[]) : [];
}
export function catalogue(db: DB): LangInfo[] { return [...CATALOGUE, ...extraLanguages(db)]; }
export function langInfo(db: DB, code: string): LangInfo | undefined { return catalogue(db).find((l) => l.code === code); }
export const langName = (db: DB, code: string) => langInfo(db, code)?.name ?? code;

/** Finds a language by what someone typed: "French", "français", "fr", "mandarin". */
export function findLanguage(db: DB, query: string): LangInfo | undefined {
  const q = query.trim().toLowerCase().replace(/^(the\s+)?/, "").replace(/\s+language$/, "");
  if (!q) return undefined;
  return catalogue(db).find((l) => l.code === q || l.name.toLowerCase() === q || l.native.toLowerCase() === q
    || l.name.toLowerCase().split(" ").includes(q) || (q === "chinese" && l.code === "zh"));
}

/** The parent adds a language that isn't on the list. */
export function addExtraLanguage(db: DB, name: string): LangInfo {
  const clean = name.trim().replace(/[^\p{L}\p{M} '-]/gu, "").slice(0, 40);
  if (clean.length < 2) throw new Error("Give the language a name.");
  const found = findLanguage(db, clean);
  if (found) return found;
  const slug = clean.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "").slice(0, 12) || "lang";
  const info: LangInfo = { code: `x-${slug}`, name: clean, native: clean, badge: clean.slice(0, 1).toUpperCase(), voice: "" };
  const extra = extraLanguages(db).filter((l) => l.code !== info.code);
  run(db, "INSERT INTO settings(key, json) VALUES('languages_extra', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify([...extra, info].slice(0, 30)));
  return info;
}

export const LEVELS = ["A1", "A2", "B1"] as const;

export const LangProfile = z.object({
  // active: learning it. pending: asked for, waiting for the grown-up. declined: the grown-up said not now.
  status: z.enum(["active", "pending", "declined"]).default("active"),
  enabled: z.boolean().default(true),
  level: z.enum(LEVELS).default("A1"),
  // "school" follows the school syllabus (GCSE themes) or JLPT N5 for Japanese; "fun" follows her interests.
  goal: z.enum(["school", "fun"]).default("fun"),
  board: z.string().max(40).default(""),
  tier: z.enum(["Foundation", "Higher"]).default("Foundation"),
  // Spanish only: GCSE uses Spain's Spanish (with vosotros).
  variety: z.enum(["spain", "latam"]).default("spain"),
  // How much English the companion uses: lots, about half, or hardly any (a hint is always one tap away).
  immersion: z.enum(["light", "half", "full"]).default("half"),
  // For languages with their own script: show the romanisation (romaji, pinyin…) as a crutch.
  romaji: z.boolean().default(true),
  interests: z.string().max(200).default(""),
  requested: z.number().optional(),
  // The parent switched it off: only the parent can switch it back on.
  offByParent: z.boolean().default(false),
});
export type LangProfile = z.infer<typeof LangProfile>;
export type LangProfiles = Record<string, LangProfile>;

function saveAll(db: DB, all: LangProfiles) {
  run(db, "INSERT INTO settings(key, json) VALUES('languages', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json", JSON.stringify(all));
}
/** Every language with a profile. Before anything is saved, that's Spanish and Japanese. */
export function loadLangProfiles(db: DB): LangProfiles {
  const r = get<{ json: string }>(db, "SELECT json FROM settings WHERE key = 'languages'");
  const raw = (r ? JSON.parse(r.json) : { es: {}, ja: {} }) as Record<string, unknown>;
  const out: LangProfiles = {};
  for (const [code, v] of Object.entries(raw)) if (CODE_RE.test(code) && langInfo(db, code)) out[code] = LangProfile.parse(v ?? {});
  return out;
}
/** The child tried to undo something the parent decided. */
export class LangLocked extends Error {}

/**
 * Saves a language's settings. Status only changes through asking, approving and declining. When
 * the parent switches a language off, it stays off until the parent switches it back on: the child
 * can pause and resume her own languages, but not one her grown-up turned off.
 */
export function saveLangProfile(db: DB, lang: string, input: unknown, by: "child" | "parent" = "child"): LangProfile {
  const all = loadLangProfiles(db);
  if (!all[lang]) throw new Error("That language isn't set up.");
  const { status: _s, requested: _r, offByParent: _o, ...rest } = (input ?? {}) as Record<string, unknown>;
  const cur = all[lang];
  let offByParent = cur.offByParent;
  if (by === "parent" && typeof rest.enabled === "boolean") offByParent = !rest.enabled;
  if (by === "child" && cur.offByParent && rest.enabled === true) throw new LangLocked("Your grown-up switched this language off, so only they can switch it back on.");
  all[lang] = LangProfile.parse({ ...cur, ...rest, offByParent });
  saveAll(db, all);
  return all[lang];
}
/** Languages she's learning now (approved and switched on). */
export function activeLangs(db: DB): string[] {
  return Object.entries(loadLangProfiles(db)).filter(([, p]) => p.status === "active" && p.enabled).map(([c]) => c);
}
export const isActive = (db: DB, lang: string) => activeLangs(db).includes(lang);

export type RequestResult = { ok: true; status: "pending" | "active"; info: LangInfo } | { ok: false; reason: "unsupported" | "declined-recently"; name: string };

/** She asks for a language. It waits for the grown-up; nothing is practised until it's approved. */
export function requestLanguage(db: DB, query: string, profile: Partial<LangProfile> = {}, now = Date.now()): RequestResult {
  const info = findLanguage(db, query);
  if (!info) return { ok: false, reason: "unsupported", name: query.trim().slice(0, 40) };
  const all = loadLangProfiles(db);
  const cur = all[info.code];
  if (cur?.status === "active") return { ok: true, status: "active", info };
  if (cur?.status === "pending") return { ok: true, status: "pending", info };
  const { status: _s, requested: _r, enabled: _e, ...rest } = profile as Record<string, unknown>;
  all[info.code] = LangProfile.parse({ ...rest, status: "pending", requested: now });
  saveAll(db, all);
  return { ok: true, status: "pending", info };
}
export function decideLanguage(db: DB, code: string, approve: boolean): boolean {
  const all = loadLangProfiles(db);
  if (!all[code] || all[code].status !== "pending") return false;
  all[code] = { ...all[code], status: approve ? "active" : "declined", enabled: true };
  saveAll(db, all);
  return true;
}
/** The parent adds a language straight away (no asking needed). */
export function addLanguage(db: DB, code: string, profile: Partial<LangProfile> = {}): LangProfile {
  if (!langInfo(db, code)) throw new Error("That language isn't on the list.");
  const all = loadLangProfiles(db);
  all[code] = LangProfile.parse({ ...(all[code] ?? {}), ...profile, status: "active", enabled: true });
  saveAll(db, all);
  return all[code];
}
/** Removes it from her list. Cards and progress are kept, in case it comes back. */
export function removeLanguage(db: DB, code: string): boolean {
  const all = loadLangProfiles(db);
  if (!all[code]) return false;
  delete all[code];
  saveAll(db, all);
  return true;
}
/** She tidies away a "not this time" card. */
export function dismissDeclined(db: DB, code: string) {
  const all = loadLangProfiles(db);
  if (all[code]?.status === "declined") { delete all[code]; saveAll(db, all); }
}

// ── Flashcards (the same spaced repetition as Study, kept apart from Study's cards) ─────────

export interface LangCard { id: number; lang: string; topic: string; front: string; back: string; reading: string; ease: number; interval_days: number; reps: number; due: number }

export function addLangCards(db: DB, lang: string, topic: string, cards: { front: string; back: string; reading?: string }[]): number {
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
export function dueLangCards(db: DB, lang: string, limit = 20): LangCard[] {
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
export function langCardStats(db: DB, lang: string) {
  const r = get<{ total: number; due: number; known: number }>(db,
    "SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN due <= ? THEN 1 ELSE 0 END), 0) AS due, COALESCE(SUM(CASE WHEN reps >= 2 THEN 1 ELSE 0 END), 0) AS known FROM cards WHERE lang = ?", Date.now(), lang);
  return r ?? { total: 0, due: 0, known: 0 };
}

/** A first handful of words, so day one isn't an empty screen. No AI needed. */
export const STARTERS: Record<string, { front: string; back: string; reading?: string }[]> = {
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
export function logPractice(db: DB, lang: string, kind: PracticeKind, topic = "") {
  // A practice chat is one conversation, not one per message: a new one after half an hour apart.
  if (kind === "chat" && get(db, "SELECT 1 FROM lang_practice WHERE lang = ? AND kind = 'chat' AND ts > ?", lang, Date.now() - 30 * 60_000)) return;
  run(db, "INSERT INTO lang_practice(ts, lang, kind, topic) VALUES (?,?,?,?)", Date.now(), lang, kind, redactPersonal(topic).text.slice(0, 80));
}

const DAY = 86_400_000;
export interface LangWeek { days: number; chats: number; reviews: number; kana: number; topics: string[] }
export function practiceWeek(db: DB, lang: string, now = Date.now()): LangWeek {
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

/** GCSE language themes (AQA-style; other boards and languages cover the same ground). */
export const GCSE_THEMES = [
  "Me, my family and friends", "Technology in everyday life", "Free-time activities", "Customs and festivals",
  "Home, town and region", "Social issues", "Global issues", "Travel and tourism", "My studies", "Life at school", "Jobs and future plans",
];
/** For any other language: everyday topics by level, in English (the chat itself is in the language). */
const GENERIC_TOPICS: Record<string, string[]> = {
  A1: ["Saying hello and who you are", "What you like and don't like", "Animals and food", "Colours and clothes", "Your favourite things"],
  A2: ["Plans for the weekend", "A film or series you watched", "Ordering food in a café", "Your ideal day", "Shopping for a gift"],
  B1: ["A trip you'd love to go on", "A story you'd write", "Hobbies and why you love them", "What you'd change about school", "Your favourite song"],
};
const TOPICS: Record<string, Record<string, string[]>> = {
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
export function topicFor(lang: string, p: LangProfile, dateKey: string): string {
  const list = lang !== "ja" && p.goal === "school" ? GCSE_THEMES : (TOPICS[lang] ?? GENERIC_TOPICS)[p.level];
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

export function languageNote(db: DB, lang: string | undefined, topic?: string): string {
  if (!lang) return "";
  const p = loadLangProfiles(db)[lang];
  const info = langInfo(db, lang);
  // Only approved languages are practised; anything else stays an ordinary chat.
  if (!p || !info || p.status !== "active") return "";
  const name = info.name;
  const variety = lang === "es" ? (p.variety === "spain" ? " Use Spain's Spanish (vosotros, European vocabulary)." : " Use Latin American Spanish (ustedes, no vosotros).") : "";
  const script = lang === "ja"
    ? `Write in hiragana and katakana, with only the simplest kanji; when you use a kanji, put its reading in brackets straight after it, like 日本(にほん).${p.romaji ? " Put romaji inside the English hint." : " No romaji: they're reading kana now."}`
    : info.romanisation
      ? `Write in ${name}'s own script, simply.${p.romaji ? ` Put the ${info.romanisation} inside the English hint.` : ` No ${info.romanisation}: they're reading the script now.`}`
      : "";
  const goal = p.goal === "school"
    ? lang === "ja" ? " They're aiming for JLPT N5: stick to N5 grammar and vocabulary." : ` They're studying ${name} at school (GCSE${p.tier ? ` ${p.tier}` : ""}${p.board ? `, ${p.board}` : ""}): steer towards GCSE themes and the kind of language that earns marks (opinions with reasons, three time frames).`
    : p.interests ? ` They love: ${p.interests}. Use that to make it fun.` : "";
  return [
    `You're in language practice: a friendly ${name} conversation at CEFR level ${p.level} (${LEVEL_STYLE[p.level]}).${variety}${goal}`,
    topic ? `Today's topic: ${topic}. Keep the conversation on it, gently.` : "",
    IMMERSION[p.immersion],
    script,
    `Format, exactly (the app turns these into tappable notes):
- An English hint goes in double round brackets right after the line it explains: ((What are you doing this weekend?))
- If they made a mistake, fix only the ONE most useful thing, kindly, as: [[fix: what they wrote → better version | a few words why]]. Praise what was right first. Never a list of errors.
- Offer one or two useful words or phrases from the conversation to save as flashcards, as: [[save: target-language phrase | English meaning${lang === "ja" ? " | reading in hiragana" : info.romanisation ? ` | ${info.romanisation}` : ""}]]
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
  return Object.keys(profiles).filter((l) => profiles[l].status === "active" && profiles[l].enabled).map((lang) => ({
    lang, name: langName(db, lang), level: profiles[lang].level, goal: profiles[lang].goal,
    words: langCardStats(db, lang).known, cards: langCardStats(db, lang).total, week: practiceWeek(db, lang),
    ...(lang === "ja" ? { hiragana: learnedKana.filter((k) => /[ぁ-ゖ]/.test(k.kana)).length, katakana: learnedKana.filter((k) => /[ァ-ヺ]/.test(k.kana)).length } : {}),
  }));
}
