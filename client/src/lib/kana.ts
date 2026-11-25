// Hiragana and katakana, in the order they're usually learned (rows of the gojūon), plus a small
// kana-to-romaji converter for card readings. Everything here runs on the device: no AI.

export interface KanaRow { name: string; kana: string[]; romaji: string[] }

const ROWS: [string, string, string][] = [
  ["vowels", "あいうえお", "a i u e o"],
  ["k", "かきくけこ", "ka ki ku ke ko"],
  ["s", "さしすせそ", "sa shi su se so"],
  ["t", "たちつてと", "ta chi tsu te to"],
  ["n", "なにぬねの", "na ni nu ne no"],
  ["h", "はひふへほ", "ha hi fu he ho"],
  ["m", "まみむめも", "ma mi mu me mo"],
  ["y", "やゆよ", "ya yu yo"],
  ["r", "らりるれろ", "ra ri ru re ro"],
  ["w", "わをん", "wa wo n"],
];

/** Hiragana to katakana is a fixed offset in Unicode. */
export const toKatakana = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

export function rows(script: "hiragana" | "katakana"): KanaRow[] {
  return ROWS.map(([name, k, r]) => ({ name, kana: [...(script === "katakana" ? toKatakana(k) : k)], romaji: r.split(" ") }));
}

const BASE: Record<string, string> = {};
for (const [, k, r] of ROWS) [...k].forEach((c, i) => { BASE[c] = r.split(" ")[i]; });
Object.assign(BASE, {
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go", ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do", ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po", ゃ: "ya", ゅ: "yu", ょ: "yo", ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
});

/** ねこ → neko, らーめん → rāmen-ish (ramen), がっこう → gakkou. Katakana works too. */
export function toRomaji(input: string): string {
  // The は in greetings is said "wa": こんにちは → konnichiwa, こんばんは → konbanwa.
  if (/^(こんにち|こんばん)は$/.test(input)) return toRomaji(input.slice(0, -1)) + "wa";
  const s = input.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i], next = s[i + 1];
    if (c === "っ" && next) { const r = BASE[next] ?? ""; out += r.startsWith("ch") ? "t" : r[0] ?? ""; continue; }
    if (c === "ー") { out += out.slice(-1); continue; }
    if (next && "ゃゅょ".includes(next) && BASE[c]) {
      const r = BASE[c], y = BASE[next];
      out += /^(shi|chi|ji)$/.test(r) ? r.slice(0, -1) + y.slice(1) : r.slice(0, -1) + y;
      i++;
      continue;
    }
    out += BASE[c] ?? c;
  }
  return out;
}

/** Says a word with the device's own voice (built into iPhone, iPad and Mac; private and free).
 *  `voice` is a locale like "es-ES" or "fr-FR"; returns false if the device has no voice for it. */
export function say(text: string, voice: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth || !voice) return false;
    const base = voice.split("-")[0];
    const voices = synth.getVoices();
    const v = voices.find((x) => x.lang.replace("_", "-") === voice) ?? voices.find((x) => x.lang.startsWith(base));
    if (voices.length && !v) return false;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\(\(.*?\)\)|\[\[.*?\]\]/g, ""));
    u.lang = voice;
    if (v) u.voice = v;
    u.rate = 0.9;
    synth.speak(u);
    return true;
  } catch { return false; }
}

/** Device-voice locale for a language, for the two built in. */
export const voiceFor = (lang: string, variety: "spain" | "latam" = "spain") => lang === "ja" ? "ja-JP" : lang === "es" ? (variety === "latam" ? "es-MX" : "es-ES") : "";

// ── Practice-chat markup: ((hint)), [[fix: a → b | why]], [[save: phrase | meaning | reading]] ──

export type Piece =
  | { t: "text"; text: string }
  | { t: "hint"; text: string }
  | { t: "fix"; wrote: string; better: string; why: string }
  | { t: "save"; front: string; back: string; reading: string };

export function parseLesson(text: string): Piece[] {
  const out: Piece[] = [];
  const re = /\(\((.+?)\)\)|\[\[\s*(fix|save)\s*:\s*(.+?)\]\]/gs;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ t: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "hint", text: m[1].trim() });
    else if (m[2] === "fix") {
      const [pair, why = ""] = m[3].split("|").map((x) => x.trim());
      const [wrote, better = ""] = pair.split(/\s*(?:→|->)\s*/);
      out.push({ t: "fix", wrote: wrote.trim(), better: better.trim(), why });
    } else {
      const [front, back = "", reading = ""] = m[3].split("|").map((x) => x.trim());
      if (front && back) out.push({ t: "save", front, back, reading });
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ t: "text", text: text.slice(last) });
  return out;
}

export const hasKana = (s: string) => /[ぁ-ヿ]/.test(s);
