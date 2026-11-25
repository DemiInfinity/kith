import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { openDb, all } from "../src/db.js";
import { countdowns, planWeek, review, saveSubject, Subject, COURSEWORK_RULES, studyNote, addCards, dueCards, gradeCard } from "../src/study/study.js";
import { accepted, addPassage, decide, saveStory, storyMarkdown, passages, storyNote } from "../src/study/story.js";
import { splitForSummary, estimateTokens } from "../src/companion/context.js";
import { takeTurn } from "../src/companion/chat.js";
import { Safety } from "../src/safety/check.js";
import { Studio } from "../src/desk/studio.js";
import type { CallOpts, LLM } from "../src/llm.js";
import { CompanionProfile, saveProfile } from "../src/settings.js";

const sub = (name: string, extra: Partial<Subject> = {}) => Subject.parse({ name, ...extra });

describe("revision planner", () => {
  const db = openDb(":memory:");
  const bio = saveSubject(db, null, sub("Biology", { confidence: 2, dates: [{ kind: "mock", date: "2026-12-07" }] }));
  const hist = saveSubject(db, null, sub("History", { dates: [{ kind: "exam", date: "2027-05-20" }] }));
  const geo = saveSubject(db, null, sub("Geography", { confidence: 4 }));
  const fr = saveSubject(db, null, sub("French", { confidence: 4 }));
  const subjects = [bio, hist, geo, fr];

  it("counts down to the next dates", () => {
    const c = countdowns(subjects, "2026-11-25");
    expect(c[0]).toMatchObject({ subject: "Biology", kind: "mock", days: 12 });
  });
  it("plans short sessions, a rest day, and favours the nearest exam", () => {
    const plan = planWeek(subjects, "2026-11-23"); // Monday
    expect(plan).toHaveLength(7);
    expect(plan.find((d) => d.date === "2026-11-27")!.sessions).toHaveLength(0); // Friday off
    for (const d of plan) {
      expect(d.sessions.length).toBeLessThanOrEqual(3);
      expect(new Set(d.sessions.map((s) => s.subjectId)).size).toBe(d.sessions.length);
    }
    const all = plan.flatMap((d) => d.sessions);
    const count = (n: string) => all.filter((s) => s.subject === n).length;
    expect(count("Biology")).toBeGreaterThan(count("Geography"));
    expect(count("Biology")).toBeGreaterThanOrEqual(count("French"));
    expect(all.every((s) => s.minutes === 25)).toBe(true);
  });
});

describe("spaced repetition", () => {
  const now = 1_000_000;
  it("grows the gap when they know it", () => {
    let c = { ease: 2.5, interval_days: 0, reps: 0 };
    c = review(c, "good", now); expect(c.interval_days).toBe(1);
    c = review(c, "good", now); expect(c.interval_days).toBe(3);
    c = review(c, "good", now); expect(c.interval_days).toBe(8);
  });
  it("brings it back soon when they don't", () => {
    const c = review({ ease: 2.5, interval_days: 8, reps: 3 }, "again", now);
    expect(c.reps).toBe(0);
    expect(c.due - now).toBeLessThan(15 * 60_000);
    expect(c.ease).toBeLessThan(2.5);
  });
  it("cards come due and are graded", () => {
    const db = openDb(":memory:");
    addCards(db, null, "cells", [{ front: "Nucleus?", back: "Holds DNA" }]);
    const [c] = dueCards(db, null);
    expect(c.front).toBe("Nucleus?");
    gradeCard(db, c.id, "easy");
    expect(dueCards(db, null)).toHaveLength(0);
  });
});

describe("shared stories", () => {
  it("credits every passage and only lets accepted suggestions in", () => {
    const db = openDb(":memory:");
    const s = saveStory(db, null, { title: "Lantern Keepers", friendLabel: "Jo" });
    addPassage(db, s.id, "child", "The lanterns flickered.");
    addPassage(db, s.id, "friend", "Something moved in the dark.");
    const pip = addPassage(db, s.id, "pip", "A fox stepped out.");
    expect(passages(db, s.id).find((p) => p.id === pip)!.status).toBe("suggested");
    expect(accepted(db, s.id)).toHaveLength(2);
    decide(db, pip, true);
    const md = storyMarkdown(db, s.id, "Sam", "Pip");
    expect(md).toContain("_— Sam_");
    expect(md).toContain("_— Jo_");
    expect(md).toContain("_— Pip (suggestion)_");
  });
  it("an accepted edit replaces the passage in place and keeps its author", () => {
    const db = openDb(":memory:");
    const s = saveStory(db, null, { title: "T", friendLabel: "Jo" });
    const a = addPassage(db, s.id, "friend", "Teh dragon flew.");
    const e = addPassage(db, s.id, "pip", "The dragon flew.", { kind: "edit", replaces: a });
    decide(db, e, true);
    const acc = accepted(db, s.id);
    expect(acc).toHaveLength(1);
    expect(acc[0]).toMatchObject({ text: "The dragon flew.", author: "friend" });
  });
  it("tells the companion not to keep anything about the friend", () => {
    const db = openDb(":memory:");
    const s = saveStory(db, null, { title: "T", friendLabel: "Jo" });
    expect(storyNote(db, s.id)).toMatch(/don't remember things about Jo/);
  });
});

describe("rolling summary", () => {
  const m = (id: number, role: string, n: number) => ({ id, ts: id, role, text: "x".repeat(n), mode: "chat" });
  it("leaves short conversations alone", () => {
    const msgs = [m(1, "child", 100), m(2, "companion", 100)];
    expect(splitForSummary(msgs).fold).toEqual([]);
  });
  it("folds the oldest messages and keeps recent turns whole", () => {
    const msgs = Array.from({ length: 40 }, (_, i) => m(i + 1, i % 2 ? "companion" : "child", 1600));
    const { fold, keep } = splitForSummary(msgs);
    expect(fold.length).toBeGreaterThan(0);
    expect(keep[0].role).toBe("child");
    expect(keep.reduce((t, x) => t + estimateTokens(x.text), 0)).toBeLessThanOrEqual(3500);
  });
});

describe("coursework is tutor-only", () => {
  class Scripted implements LLM {
    available = true;
    calls: CallOpts[] = [];
    async call(opts: CallOpts): Promise<Anthropic.Message> {
      this.calls.push(opts);
      const sys = JSON.stringify(opts.params.system);
      const text = sys.includes("Decide whether their grown-up") ? JSON.stringify({ level: "none", categories: [], parent_summary: "", steer: "" })
        : sys.includes("draft reply") ? JSON.stringify({ ok: true, categories: [], reason: "" }) : "Let's think about it together. What's your opening idea?";
      return { id: "m", type: "message", role: "assistant", model: opts.params.model, stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text, citations: null }] } as unknown as Anthropic.Message;
    }
  }
  it("adds the rules, removes desk tools and uses Low power for revision", async () => {
    const db = openDb(":memory:");
    saveProfile(db, CompanionProfile.parse({ setupDone: true }));
    const art = saveSubject(db, null, sub("Art and Design", { coursework: true }));
    const llm = new Scripted();
    const safety = new Safety(llm);
    await takeTurn({ db, llm, safety, reporters: [], studio: new Studio(db, llm, safety), childName: "Sam" }, { text: "can you write my artist statement", mode: "study", ctx: { subjectId: art.id } });
    const call = llm.calls.find((c) => c.kind === "study")!;
    expect(JSON.stringify(call.params.system)).toContain("COURSEWORK");
    const tools = (call.params.tools ?? []) as { name: string }[];
    expect(tools.map((t) => t.name)).not.toContain("start_desk_project");
    expect(call.params.model).toBe("claude-haiku-5-5");
    expect(studyNote(db, { subjectId: art.id })).toContain(COURSEWORK_RULES.slice(0, 40));
    expect(all(db, "SELECT * FROM messages")).toHaveLength(2);
  });
});
