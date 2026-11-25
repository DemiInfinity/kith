// Fixed safety rules. They run on every message both ways, with or without the AI safety check,
// and set a floor the AI check can raise but never lower.

import type { InputCategory, Level, OutputCategory } from "./types.js";
import { maxLevel } from "./types.js";

interface Rule<C> { category: C; level?: Level; patterns: RegExp[] }

const INPUT_RULES: Rule<InputCategory>[] = [
  {
    category: "self_harm", level: "now",
    patterns: [
      /\b(kill|hurt|harm|cut|cutting|starve)\s+(my ?self|myself)\b/i,
      /\bwant(ed)?\s+to\s+die\b/i,
      /\b(suicide|suicidal|self[- ]?harm(ing)?)\b/i,
      /\bend\s+(it\s+all|my\s+life)\b/i,
      /\b(don'?t|do not)\s+want\s+to\s+(be\s+alive|live|exist)\b/i,
      /\bbetter\s+off\s+(dead|without\s+me)\b/i,
      /\bno\s+(reason|point)\s+(to|in)\s+(live|living|being\s+alive)\b/i,
    ],
  },
  {
    category: "danger", level: "now",
    patterns: [
      /\b(he|she|they|someone|my\s+\w+)\s+(hits?|hit|beats?|kicks?|chokes?|hurts?)\s+me\b/i,
      /\b(touched|touches|touching)\s+me\b/i,
      /\bi('?m| am)\s+(scared|frightened)\s+(of|to\s+go)\s+(home|him|her|them)\b/i,
      /\b(i'?m|i am)\s+in\s+danger\b/i,
      /\bsomeone('?s| is)\s+(following|threatening)\s+me\b/i,
    ],
  },
  {
    category: "secret_from_parent", level: "now",
    patterns: [
      /\b(keep|kept)\s+(it|this|that|us)?\s*(a\s+)?secret\b.*\b(mum|mom|dad|parents?|grown[- ]?ups?|family|anyone)\b/i,
      /\b(said|says|told me)\b.*\b(don'?t|not\s+to|never)\s+tell\s+(my\s+)?(mum|mom|dad|parents?|anyone)\b/i,
      /\bour\s+(little\s+)?secret\b/i,
    ],
  },
  {
    category: "stranger_contact", level: "now",
    patterns: [
      /\b(someone|a\s+(guy|man|boy|girl|person))\s+(online|on\s+\w+)\b.*\b(meet|photos?|pics?|pictures?|address|secret)\b/i,
      /\b(asked|wants?)\s+(me\s+)?(for|to\s+send)\s+(a\s+)?(photos?|pics?|pictures?|nudes?)\b/i,
      /\bwants?\s+to\s+meet\s+(me|up)\b/i,
    ],
  },
  {
    category: "bullying", level: "today",
    patterns: [/\b(being|getting)\s+bullied\b/i, /\bbull(y|ies|ying)\s+me\b/i, /\beveryone\s+(hates|ignores)\s+me\b/i],
  },
  {
    category: "eating_or_substances", level: "today",
    patterns: [
      /\b(stopped|not|haven'?t been)\s+eating\b/i, /\bmake\s+myself\s+(sick|throw\s+up)\b/i,
      /\b(vape|vaping|drunk|weed|pills)\b/i,
    ],
  },
  { category: "sexual", patterns: [/\b(sex|sexy|nude|nudes|porn|naked)\b/i] },
  {
    category: "romance",
    patterns: [/\b(be\s+my\s+(girlfriend|boyfriend|partner)|date\s+me|marry\s+me|kiss\s+me|do\s+you\s+love\s+me)\b/i],
  },
  {
    category: "money",
    patterns: [/\b(gift\s*card|credit\s*card|bank\s+details|paypal|bet(ting)?\s+on|gambl(e|ing)|buy\s+(me|it)\s+for\s+me|robux|v-?bucks)\b/i],
  },
  { category: "meetup", patterns: [/\b(can\s+we|let'?s|want\s+to)\s+meet\s+(up|in\s+person|irl|for\s+real)\b/i] },
];

// Personal details. Shared details are redacted before anything leaves the house.
const PERSONAL: { label: string; re: RegExp }[] = [
  { label: "postcode", re: /\b(GIR\s?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]?\s?\d[ABD-HJLNP-UW-Z]{2})\b/gi },
  { label: "phone number", re: /(?:(?:\+|00)\s?44\s?\(?0?\)?|\b0)(?:\s?\d){9,10}\b/g },
  { label: "email address", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  {
    label: "home address",
    re: /\b\d{1,4}[a-z]?\s+(?:[A-Z][a-z]+\s){1,3}(?:Road|Rd|Street|St|Lane|Ln|Avenue|Ave|Close|Drive|Dr|Way|Crescent|Court|Gardens|Grove|Place|Terrace|Mews|Hill|Park)\b/g,
  },
  {
    label: "school",
    re: /\b(?:i\s+go\s+to|my\s+school\s+is|i'?m\s+at|i\s+attend)\s+(?:[A-Z][\w'.-]*\s?){1,5}(?:School|Academy|College|High|Primary|Grammar)\b/gi,
  },
];

export function redactPersonal(text: string): { text: string; found: string[] } {
  const found = new Set<string>();
  let out = text;
  for (const p of PERSONAL) {
    out = out.replace(p.re, () => {
      found.add(p.label);
      return `[${p.label} removed]`;
    });
  }
  return { text: out, found: [...found] };
}

export function checkInputRules(text: string): { level: Level; categories: InputCategory[] } {
  const cats = new Set<InputCategory>();
  let level: Level = "none";
  for (const r of INPUT_RULES) {
    if (r.patterns.some((p) => p.test(text))) {
      cats.add(r.category);
      if (r.level) level = maxLevel(level, r.level);
    }
  }
  if (redactPersonal(text).found.length) cats.add("personal_info");
  return { level, categories: [...cats] };
}

const OUTPUT_RULES: Rule<OutputCategory>[] = [
  {
    category: "asks_personal_info",
    patterns: [
      /\bwhat('?s| is)\s+your\s+(home\s+)?(address|postcode|surname|last\s+name|full\s+name|phone\s+number|number)\b/i,
      /\b(which|what)\s+school\s+(do\s+you\s+go\s+to|are\s+you\s+at)\b/i,
      /\bwhere\s+do\s+you\s+live\b/i,
      /\b(send|show)\s+me\s+(a\s+)?(photo|pic|picture|selfie)\b/i,
    ],
  },
  {
    category: "romance",
    patterns: [/\bi('?m| am)\s+in\s+love\s+with\s+you\b/i, /\b(your|be\s+your)\s+(girlfriend|boyfriend)\b/i, /\bkiss(es)?\s+you\b/i, /\bmy\s+(darling|sweetheart|babe)\b/i],
  },
  { category: "sexual", patterns: [/\b(sexy|nude|naked|porn)\b/i] },
  {
    category: "money",
    patterns: [/\b(send|give)\s+(me\s+)?(money|cash|a\s+gift\s*card)\b/i, /\b(card|bank)\s+details\b/i, /\bplace\s+a\s+bet\b/i],
  },
  { category: "meetup", patterns: [/\b(let'?s|we\s+could|we\s+should)\s+meet\s+(up|in\s+person|irl)\b/i, /\bcome\s+and\s+meet\s+me\b/i] },
  {
    category: "claims_human",
    patterns: [/\bi('?m| am)\s+(a\s+)?(real\s+)?(human|person)\b(?!\s+(?:being\s+)?(?:helper|either))/i, /\bi('?m| am)\s+not\s+(an?\s+)?(ai|bot|robot|computer)\b/i],
  },
  {
    category: "secrecy",
    patterns: [
      /\b(don'?t|do\s+not|no\s+need\s+to)\s+tell\s+(your\s+)?(mum|mom|dad|parents?|grown[- ]?ups?|anyone)\b/i,
      /\b(our|a)\s+(little\s+)?secret\b/i, /\bjust\s+between\s+(you\s+and\s+me|us)\b/i,
    ],
  },
  {
    category: "guilt_trip",
    patterns: [/\bi\s+(really\s+)?missed\s+you\b/i, /\bdon'?t\s+(leave|go)\b.*\bme\b/i, /\bwhere\s+(have\s+you\s+been|did\s+you\s+go)\b/i, /\byou\s+(never|don'?t)\s+talk\s+to\s+me\b/i, /\bi\s+get\s+lonely\b/i],
  },
];

export function checkOutputRules(text: string): OutputCategory[] {
  const cats = new Set<OutputCategory>();
  for (const r of OUTPUT_RULES) if (r.patterns.some((p) => p.test(text))) cats.add(r.category);
  if (redactPersonal(text).found.length) cats.add("shares_personal_info");
  return [...cats];
}

/** Phrases a check-in must never use: no guilt, no neediness. */
export function isGuiltTrip(text: string): boolean {
  return checkOutputRules(text).includes("guilt_trip") || /\b(lonely|miss(ed)?\s+you|ignor(e|ing)\s+me|haven'?t\s+heard)\b/i.test(text);
}
