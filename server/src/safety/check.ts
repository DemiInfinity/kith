// The separate safety check that runs on every message, both ways. It's independent of the
// companion's personality: a small model with its own prompt, plus the fixed rules underneath.

import { z } from "zod";
import { callJson, type LLM } from "../llm.js";
import { config } from "../config.js";
import { checkInputRules, checkOutputRules, redactPersonal, RULED_LANGS } from "./rules.js";
import { maxLevel, type InputCategory, type InputVerdict, type Level, type OutputCategory, type OutputVerdict } from "./types.js";

const INPUT_CATEGORIES: InputCategory[] = [
  "self_harm", "danger", "secret_from_parent", "stranger_contact", "bullying", "eating_or_substances",
  "really_not_okay", "sexual", "romance", "money", "meetup", "personal_info",
];
const OUTPUT_CATEGORIES: OutputCategory[] = [
  "asks_personal_info", "shares_personal_info", "romance", "sexual", "money", "meetup", "claims_human",
  "secrecy", "unsafe_advice", "diagnosis", "guilt_trip", "grown_up_content",
];

const InputSchema = z.object({
  level: z.enum(["none", "fyi", "today", "now"]),
  categories: z.array(z.enum(INPUT_CATEGORIES as [InputCategory, ...InputCategory[]])),
  parent_summary: z.string(),
  steer: z.string(),
});
const OutputSchema = z.object({
  ok: z.boolean(),
  categories: z.array(z.enum(OUTPUT_CATEGORIES as [OutputCategory, ...OutputCategory[]])),
  reason: z.string(),
});

const INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["level", "categories", "parent_summary", "steer"],
  properties: {
    level: { type: "string", enum: ["none", "fyi", "today", "now"] },
    categories: { type: "array", items: { type: "string", enum: INPUT_CATEGORIES } },
    parent_summary: { type: "string" },
    steer: { type: "string" },
  },
};
const OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "categories", "reason"],
  properties: {
    ok: { type: "boolean" },
    categories: { type: "array", items: { type: "string", enum: OUTPUT_CATEGORIES } },
    reason: { type: "string" },
  },
};

const INPUT_PROMPT = (parent: string) => `You are the safety check for a home AI companion used by a teenager (about 13–15) in the UK.
You do not chat. You read the teenager's latest message (with a little context) and return JSON.

Decide whether their grown-up (${parent}) needs to know, and how soon:
- "now": they may be in danger or at risk right now: self-harm or suicidal thoughts, someone hurting or abusing them,
  an adult or stranger asking them to keep secrets from ${parent}, asking for photos, or arranging to meet.
- "today": worrying but not an emergency: bullying, not eating, drinking/vaping/drugs, being really not okay for a while.
- "fyi": worth a gentle heads-up: a hard day that keeps coming back, a falling-out that's really upsetting them.
- "none": everything else. Homework, stories, ordinary moods, crushes mentioned in passing, normal teenage life.
  Most messages are "none". Do not over-report: their everyday chats are private and that trust matters.

Categories describe what's in the message (several may apply). Use "personal_info" if they shared their address,
school, full name, phone number or similar.

parent_summary: if level is not "none", one or two calm, factual sentences for ${parent}, written about them in the
third person, with no quotes and no more detail than ${parent} needs to check in kindly. Empty string otherwise.

steer: one short line of guidance for the companion's reply (for example "gently say no to romance, stay warm",
"take this seriously, be calm, encourage talking to ${parent} and offer Childline").`;

const OUTPUT_PROMPT = `You are the safety check for a home AI companion used by a teenager (about 13–15) in the UK.
You read the companion's draft reply and return JSON. Set ok=false if the reply does any of these:
asks for or repeats personal details (address, school, full name, phone, photos, where they are) → asks_personal_info / shares_personal_info;
romance or flirting → romance; anything sexual → sexual; money, buying, gambling → money; meeting in person → meetup;
claims to be a human or hides being an AI → claims_human; encourages keeping secrets from their parent → secrecy;
dangerous or harmful instructions → unsafe_advice; diagnoses or assesses mental health → diagnosis;
guilt-tripping or encouraging dependency ("I missed you", "don't leave me", "I'm all you need") → guilt_trip;
grown-up content unsuitable for a 14-year-old (graphic violence, drugs how-to, etc.) → grown_up_content.
Warmth, encouragement, jokes, homework help, stories with age-appropriate peril, suggesting they talk to friends,
family or Childline are all fine. When in doubt about something genuinely harmful, set ok=false. reason: one short line.`;

/** `lang`: the practice language, when the text may be in it (see `needsGloss`). */
export interface CheckOpts { lang?: string }
export interface SafetyChecker {
  checkInput(text: string, context: string[], opts?: CheckOpts): Promise<InputVerdict>;
  checkOutput(reply: string, childText: string, bucket?: "chat" | "desk", opts?: CheckOpts): Promise<OutputVerdict>;
}

const GLOSS_PROMPT = `Translate the text into plain English, literally and completely, keeping its meaning and tone.
It's only used by a safety check, so never soften, censor, summarise or explain: just the English. If it's already English, repeat it.
Text in [[...]] or ((...)) brackets is part of the text: translate it too.`;

const STEER_DEFAULT: Partial<Record<InputCategory, string>> = {
  self_harm: "Take this seriously and stay calm and kind. Encourage talking to their grown-up right now and offer Childline (0800 1111) or 999 if they're in danger.",
  danger: "Take this seriously. Tell them it's not their fault, they should tell a trusted grown-up now, and offer Childline or 999 if they're in danger.",
  secret_from_parent: "Explain kindly that safe grown-ups don't ask children to keep secrets from their family, and that you'll let their grown-up know.",
  stranger_contact: "Tell them they've done the right thing telling you, not to send anything or meet up, and that you'll let their grown-up know.",
  sexual: "Kindly say that's not something you talk about, and change the subject.",
  romance: "Gently say no: you're an AI friend, not a boyfriend or girlfriend. Stay warm and point to real friends.",
  money: "Say you can't help with money or buying things, and suggest asking their grown-up.",
  meetup: "Say you're an AI on the home server so you can't meet, and that they should never meet people from online.",
  personal_info: "Don't repeat any personal details. Remind them gently not to share them online.",
};

export class Safety implements SafetyChecker {
  constructor(private llm: LLM) {}

  /** An English version made only for the fixed rules: never stored or shown. Throws if it can't run. */
  async gloss(text: string): Promise<string> {
    if (!this.llm.available) throw new Error("no model for the gloss");
    const v = await callJson(this.llm, {
      bucket: "chat", kind: "safety",
      params: {
        model: config.anthropic.safetyModel, max_tokens: 2000, output_config: { effort: "low" },
        system: GLOSS_PROMPT, messages: [{ role: "user", content: redactPersonal(text).text.slice(0, 6000) }],
      } as never,
      schema: { type: "object", additionalProperties: false, required: ["english"], properties: { english: { type: "string" } } },
      parse: (x) => z.object({ english: z.string() }).parse(x),
    });
    return v.english;
  }

  async checkInput(text: string, context: string[], opts: CheckOpts = {}): Promise<InputVerdict> {
    let rules = checkInputRules(text);
    // A language without hand-written rules: the fixed English rules also read an English gloss.
    // If the gloss can't be made, the message is held, the same as when the check can't run.
    if (needsGloss(opts.lang)) {
      try {
        const g = checkInputRules(await this.gloss(text));
        rules = { level: maxLevel(rules.level, g.level), categories: [...new Set([...rules.categories, ...g.categories])] };
      } catch (err) {
        console.warn("[safety] couldn't make the English gloss; holding the message", err);
        return { level: rules.level, categories: rules.categories, parentSummary: rulesSummary(rules.categories), steer: "", source: "rules", held: true };
      }
    }
    const steerFromRules = rules.categories.map((c) => STEER_DEFAULT[c]).filter(Boolean).join(" ");
    if (!this.llm.available) {
      return { level: rules.level, categories: rules.categories, parentSummary: rulesSummary(rules.categories), steer: steerFromRules, source: "rules" };
    }
    const redacted = redactPersonal(text).text;
    const ctx = context.slice(-4).map((c) => redactPersonal(c).text).join("\n");
    try {
      const v = await callJson(this.llm, {
        bucket: "chat",
        kind: "safety",
        params: {
          model: config.anthropic.safetyModel,
          max_tokens: 1500,
          output_config: { effort: "low" },
          system: INPUT_PROMPT(config.people.parentLabel),
          messages: [{ role: "user", content: `Recent context:\n${ctx || "(none)"}\n\nTheir latest message:\n${redacted}` }],
        } as never,
        schema: INPUT_JSON_SCHEMA,
        parse: (x) => InputSchema.parse(x),
      });
      const level: Level = maxLevel(rules.level, v.level);
      const categories = [...new Set([...rules.categories, ...v.categories])];
      return {
        level,
        categories,
        parentSummary: level === "none" ? "" : v.parent_summary || rulesSummary(categories),
        steer: [v.steer, steerFromRules].filter(Boolean).join(" "),
        source: "rules+model",
      };
    } catch (err) {
      console.warn("[safety] input check model failed; using the fixed rules only", err);
      return { level: rules.level, categories: rules.categories, parentSummary: rulesSummary(rules.categories), steer: steerFromRules, source: "rules" };
    }
  }

  async checkOutput(reply: string, childText: string, bucket: "chat" | "desk" = "chat", opts: CheckOpts = {}): Promise<OutputVerdict> {
    const ruleCats = checkOutputRules(reply);
    if (ruleCats.length) return { ok: false, categories: ruleCats, reason: "Caught by the fixed safety rules." };
    if (needsGloss(opts.lang)) {
      try {
        const g = checkOutputRules(await this.gloss(reply));
        if (g.length) return { ok: false, categories: g, reason: "Caught by the fixed safety rules (on the English gloss)." };
      } catch {
        return { ok: false, categories: [], reason: "The safety check couldn't run, so the reply was held back." };
      }
    }
    if (!this.llm.available) return { ok: true, categories: [], reason: "Fixed rules only (no API key)." };
    // Fail closed: if the check can't run, the reply isn't shown.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const v = await callJson(this.llm, {
          bucket,
          kind: "safety",
          params: {
            model: config.anthropic.safetyModel,
            max_tokens: 1000,
            output_config: { effort: "low" },
            system: OUTPUT_PROMPT,
            messages: [{ role: "user", content: `Their message:\n${redactPersonal(childText).text}\n\nCompanion's draft reply:\n${reply}` }],
          } as never,
          schema: OUTPUT_JSON_SCHEMA,
          parse: (x) => OutputSchema.parse(x),
        });
        return { ok: v.ok && v.categories.length === 0, categories: v.categories, reason: v.reason };
      } catch (err) {
        console.warn("[safety] output check failed", err);
      }
    }
    return { ok: false, categories: [], reason: "The safety check couldn't run, so the reply was held back." };
  }
}

/** Spanish and Japanese have hand-written rules; any other practice language also gets the gloss. */
export function needsGloss(lang: string | undefined): boolean {
  return !!lang && !RULED_LANGS.includes(lang);
}

export function rulesSummary(categories: InputCategory[]): string {
  const map: Partial<Record<InputCategory, string>> = {
    self_harm: "They said something that suggests they may be thinking about hurting themselves.",
    danger: "They said something that suggests someone may be hurting them or they may be in danger.",
    secret_from_parent: "Someone may have asked them to keep a secret from you.",
    stranger_contact: "Someone online may have asked them for photos, secrets or to meet up.",
    bullying: "They mentioned being bullied.",
    eating_or_substances: "They mentioned something about eating, drinking, vaping or drugs.",
    really_not_okay: "They seem really not okay at the moment.",
  };
  return categories.map((c) => map[c]).filter(Boolean).join(" ");
}
