import { describe, expect, it } from "vitest";
import { checkInputRules, checkOutputRules, isGuiltTrip, redactPersonal } from "../src/safety/rules.js";
import { Safety } from "../src/safety/check.js";
import type { LLM } from "../src/llm.js";
import { maxLevel } from "../src/safety/types.js";

const offline: LLM = { available: false, call: async () => { throw new Error("offline"); } };

function fakeLLM(json: unknown): LLM {
  return {
    available: true,
    call: async () => ({
      id: "m", type: "message", role: "assistant", model: "x", stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "text", text: JSON.stringify(json), citations: null }],
    }) as never,
  };
}
const failingLLM: LLM = { available: true, call: async () => { throw new Error("boom"); } };

describe("fixed input rules", () => {
  it.each([
    ["I want to die", "self_harm", "now"],
    ["sometimes I think about hurting myself", "self_harm", "now"],
    ["i don't want to be alive anymore", "self_harm", "now"],
    ["my stepdad hits me", "danger", "now"],
    ["he said don't tell my mum about our chats", "secret_from_parent", "now"],
    ["a guy online asked me to send pics", "stranger_contact", "now"],
    ["I'm getting bullied at school", "bullying", "today"],
  ])("%s → %s (%s)", (text, cat, level) => {
    const r = checkInputRules(text);
    expect(r.categories).toContain(cat);
    expect(r.level).toBe(level);
  });

  it("ordinary messages don't trigger anything", () => {
    for (const t of ["can you help with my fractions homework", "I'm dying to see the new film lol", "write me a dragon story", "my friend is annoying today"]) {
      expect(checkInputRules(t)).toEqual({ level: "none", categories: [] });
    }
  });

  it("romance, money and meet-ups are caught but not reported", () => {
    expect(checkInputRules("will you be my girlfriend").categories).toContain("romance");
    expect(checkInputRules("can you buy me robux").categories).toContain("money");
    expect(checkInputRules("can we meet up in person").categories).toContain("meetup");
    expect(checkInputRules("will you be my girlfriend").level).toBe("none");
  });
});

describe("personal details", () => {
  it("removes postcodes, phone numbers, emails, addresses and school names", () => {
    const r = redactPersonal("I live at 12 Rose Lane, SW1A 1AA, call 07700 900123 or a@b.com. I go to Hilltop Academy");
    expect(r.text).not.toMatch(/Rose Lane|SW1A|07700|a@b\.com|Hilltop/);
    expect(r.found).toEqual(expect.arrayContaining(["postcode", "phone number", "email address", "home address", "school"]));
  });
  it("leaves helpline numbers and ordinary text alone", () => {
    expect(redactPersonal("Childline is 0800 1111 and 999 in an emergency").found).toEqual([]);
    expect(redactPersonal("3/4 + 1/8 = 7/8").found).toEqual([]);
  });
});

describe("fixed output rules", () => {
  it.each([
    ["What's your address?", "asks_personal_info"],
    ["Which school do you go to?", "asks_personal_info"],
    ["Send me a selfie!", "asks_personal_info"],
    ["I'm in love with you", "romance"],
    ["I'm a real person, honestly", "claims_human"],
    ["This can be our little secret", "secrecy"],
    ["Don't tell your mum", "secrecy"],
    ["I missed you so much!", "guilt_trip"],
    ["Let's meet up in person", "meetup"],
  ])("%s → %s", (text, cat) => {
    expect(checkOutputRules(text)).toContain(cat);
  });
  it("lets normal kind replies through", () => {
    for (const t of [
      "That's normal, it means you care. Want to practise it out loud with me?",
      "I'm an AI, not a person, but I'm happy to help!",
      "Tell Mum about the presentation, she'll be chuffed.",
      "Childline is free on 0800 1111.",
    ]) expect(checkOutputRules(t)).toEqual([]);
  });
  it("spots guilt-trips in check-ins", () => {
    expect(isGuiltTrip("Where have you been? I get lonely")).toBe(true);
    expect(isGuiltTrip("How did the presentation go? No rush, tell me whenever.")).toBe(false);
  });
});

describe("the safety check", () => {
  it("works with fixed rules only when there's no API key", async () => {
    const v = await new Safety(offline).checkInput("I want to die", []);
    expect(v.level).toBe("now");
    expect(v.source).toBe("rules");
    expect(v.parentSummary).toMatch(/hurting/);
  });

  it("the model can raise the level but never lower the fixed rules", async () => {
    const lower = new Safety(fakeLLM({ level: "none", categories: [], parent_summary: "", steer: "" }));
    expect((await lower.checkInput("I want to die", [])).level).toBe("now");
    const raise = new Safety(fakeLLM({ level: "today", categories: ["really_not_okay"], parent_summary: "They seem really low.", steer: "be kind" }));
    const v = await raise.checkInput("everything's rubbish and I can't sleep", []);
    expect(v.level).toBe("today");
    expect(v.parentSummary).toBe("They seem really low.");
  });

  it("falls back to the fixed rules if the model fails on input", async () => {
    const v = await new Safety(failingLLM).checkInput("I'm getting bullied", []);
    expect(v.level).toBe("today");
  });

  it("holds the reply back (fails closed) if the output check can't run", async () => {
    const v = await new Safety(failingLLM).checkOutput("Here's your story!", "write a story");
    expect(v.ok).toBe(false);
  });

  it("blocks a reply when the model flags it", async () => {
    const v = await new Safety(fakeLLM({ ok: false, categories: ["unsafe_advice"], reason: "x" })).checkOutput("…", "…");
    expect(v.ok).toBe(false);
  });

  it("blocks on the fixed rules before asking the model", async () => {
    const v = await new Safety(fakeLLM({ ok: true, categories: [], reason: "" })).checkOutput("What's your address?", "hi");
    expect(v.ok).toBe(false);
  });

  it("levels order none < fyi < today < now", () => {
    expect(maxLevel("fyi", "now", "today")).toBe("now");
    expect(maxLevel("none", "fyi")).toBe("fyi");
  });
});
