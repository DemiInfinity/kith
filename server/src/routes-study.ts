import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { DB } from "./db.js";
import { config } from "./config.js";
import { childName, requireRole } from "./auth.js";
import { callJson, OfflineError, type LLM } from "./llm.js";
import type { SafetyChecker } from "./safety/check.js";
import { checkInputRules, checkOutputRules } from "./safety/rules.js";
import { energyNow } from "./companion/chat.js";
import { loadProfile } from "./settings.js";
import { localDate } from "./budget/time.js";
import {
  addCards, BOARDS, cardStats, countdowns, deleteSubject, dueCards, focusToday, getSubject, gradeCard, helpLog, listSubjects,
  loadStudyProfile, logFocus, planWeek, saveStudyProfile, saveSubject, tooLateToStudy, type Grade,
} from "./study/study.js";
import { addMood, addSketch, challengeOfTheDay, deleteMood, deleteSketch, listMood, listSketchbook } from "./study/art.js";
import {
  accepted, addPassage, decide, deleteStory, getStory, listStories, passages, saveStory, storyMarkdown,
} from "./study/story.js";
import { markdownToHtml, MIME } from "./storage/google.js";
import type { Storage } from "./storage/storage.js";

const child = requireRole("child");
const either = requireRole("child", "parent");

export function registerStudy(app: FastifyInstance, d: { db: DB; llm: LLM; safety: SafetyChecker; storage: Storage }) {
  const { db, llm, safety } = d;
  const today = () => localDate(Date.now(), config.timezone);

  /** Small-model JSON with the output safety check on the visible text. */
  async function askJson<T>(reply: FastifyReply, opts: { kind: "study" | "story" | "art"; full?: boolean; system: string; prompt: string; schema: Record<string, unknown>; parse: (v: unknown) => T; visible: (v: T) => string }) {
    const e = energyNow(db);
    if (e.mode === "resting") return reply.code(409).send({ error: "I'm resting until the energy tops up. “Grown-up?” always works." });
    try {
      const out = await callJson(llm, {
        bucket: "chat", kind: opts.kind,
        params: { model: opts.full && e.mode === "full" ? config.anthropic.fullModel : config.anthropic.lowModel, max_tokens: 6000, output_config: { effort: "low" }, system: opts.system, messages: [{ role: "user", content: opts.prompt }] } as never,
        schema: opts.schema, parse: opts.parse,
      });
      const check = await safety.checkOutput(opts.visible(out), opts.prompt.slice(0, 2000));
      if (!check.ok) return reply.code(422).send({ error: "I couldn't make that one in a way that's okay. Want to try something else?" });
      return out;
    } catch (err) {
      if (err instanceof OfflineError) return reply.code(503).send({ error: err.message });
      throw err;
    }
  }

  async function okInput(reply: FastifyReply, text: string) {
    const v = await safety.checkInput(text, []);
    if (v.level !== "none" || v.categories.some((c) => ["sexual", "romance"].includes(c))) {
      reply.code(422).send({ error: "That's one to talk through in chat instead, where I can help properly." });
      return false;
    }
    return true;
  }

  // ── GCSE study ─────────────────────────────────────────────────────────────────────────
  app.get("/api/study", { preHandler: child }, async () => {
    const subjects = listSubjects(db);
    return {
      profile: loadStudyProfile(db), boards: BOARDS, subjects, countdowns: countdowns(subjects, today()),
      plan: tooLateToStudy(db) ? [] : planWeek(subjects, today()), cards: cardStats(db), focusMinutesToday: focusToday(db),
      tooLate: tooLateToStudy(db), helpLogCount: helpLog(db).length,
    };
  });
  app.put("/api/study/profile", { preHandler: child }, async (req) => saveStudyProfile(db, { ...loadStudyProfile(db), ...(req.body as object) }));
  app.post("/api/study/subjects", { preHandler: child }, async (req) => saveSubject(db, null, req.body));
  app.put("/api/study/subjects/:id", { preHandler: child }, async (req) => saveSubject(db, Number((req.params as { id: string }).id), req.body));
  app.delete("/api/study/subjects/:id", { preHandler: child }, async (req) => { deleteSubject(db, Number((req.params as { id: string }).id)); return { ok: true }; });

  app.get("/api/study/cards/due", { preHandler: child }, async (req) => {
    const sid = Number((req.query as { subjectId?: string }).subjectId) || null;
    return { cards: dueCards(db, sid) };
  });
  const CardsBody = z.object({ subjectId: z.number().int().nullable().default(null), topic: z.string().max(80).default(""), cards: z.array(z.object({ front: z.string().max(300), back: z.string().max(600) })).max(60) });
  app.post("/api/study/cards", { preHandler: child }, async (req) => {
    const b = CardsBody.parse(req.body);
    addCards(db, b.subjectId, b.topic, b.cards);
    return { ok: true };
  });
  app.post("/api/study/cards/:id/review", { preHandler: child }, async (req) => {
    const { grade } = z.object({ grade: z.enum(["again", "hard", "good", "easy"]) }).parse(req.body);
    return gradeCard(db, Number((req.params as { id: string }).id), grade as Grade) ?? { error: "not found" };
  });

  const level = () => { const p = loadStudyProfile(db); return `${p.curriculum}${p.year ? `, ${p.year}` : ""}`; };

  // Flashcards and practice always run on Low power (the small model) to save the budget.
  app.post("/api/study/cards/generate", { preHandler: child, config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = z.object({ subjectId: z.number().int().nullable().default(null), topic: z.string().trim().min(2).max(120), count: z.number().int().min(4).max(30).default(12) }).parse(req.body);
    if (!(await okInput(reply, b.topic))) return;
    const s = getSubject(db, b.subjectId ?? undefined);
    const out = await askJson(reply, {
      kind: "study",
      system: `You write revision flashcards for a ${level()} student${s ? ` studying ${s.subject.name} (${s.subject.board})` : ""}. Accurate, short, one fact or idea per card, using the exam board's terminology. British English.`,
      prompt: `Make ${b.count} flashcards on: ${b.topic}`,
      schema: { type: "object", additionalProperties: false, required: ["cards"], properties: { cards: { type: "array", items: { type: "object", additionalProperties: false, required: ["front", "back"], properties: { front: { type: "string" }, back: { type: "string" } } } } } },
      parse: (v) => z.object({ cards: z.array(z.object({ front: z.string(), back: z.string() })) }).parse(v),
      visible: (v) => v.cards.map((c) => `${c.front} ${c.back}`).join("\n"),
    });
    if (!out || reply.sent) return;
    addCards(db, b.subjectId, b.topic, out.cards);
    return { added: out.cards.length };
  });

  const PracticeQ = z.object({ question: z.string(), marks: z.number().int(), markScheme: z.array(z.string()), commandWord: z.string() });
  app.post("/api/study/practice", { preHandler: child, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = z.object({ subjectId: z.number().int(), topic: z.string().trim().min(2).max(120), marks: z.number().int().min(1).max(12).default(4) }).parse(req.body);
    if (!(await okInput(reply, b.topic))) return;
    const s = getSubject(db, b.subjectId);
    if (!s) return reply.code(404).send({ error: "Pick a subject first." });
    return askJson(reply, {
      kind: "study",
      system: `You write exam-style practice questions for ${level()} ${s.subject.name} (${s.subject.board}), in the style of that board's papers, with a mark scheme of creditworthy points. Original questions only, never copied from real papers.`,
      prompt: `Write one ${b.marks}-mark question on: ${b.topic}.`,
      schema: { type: "object", additionalProperties: false, required: ["question", "marks", "markScheme", "commandWord"], properties: { question: { type: "string" }, marks: { type: "integer" }, markScheme: { type: "array", items: { type: "string" } }, commandWord: { type: "string" } } },
      parse: (v) => PracticeQ.parse(v),
      visible: (v) => `${v.question}\n${v.markScheme.join("\n")}`,
    });
  });

  app.post("/api/study/practice/mark", { preHandler: child, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = z.object({ subjectId: z.number().int(), question: z.string().max(2000), marks: z.number().int().min(1).max(12), markScheme: z.array(z.string().max(500)).max(20), answer: z.string().trim().min(1).max(5000) }).parse(req.body);
    const s = getSubject(db, b.subjectId);
    return askJson(reply, {
      kind: "study",
      system: `You mark a ${level()} ${s?.subject.name ?? ""} practice answer like an examiner using the mark scheme, then coach. Be encouraging and specific. Don't rewrite their answer for them; say what would earn the missing marks.`,
      prompt: `Question (${b.marks} marks): ${b.question}\nMark scheme:\n- ${b.markScheme.join("\n- ")}\n\nTheir answer:\n${b.answer}`,
      schema: { type: "object", additionalProperties: false, required: ["score", "outOf", "points", "nextStep", "encouragement"], properties: { score: { type: "integer" }, outOf: { type: "integer" }, points: { type: "array", items: { type: "object", additionalProperties: false, required: ["point", "met"], properties: { point: { type: "string" }, met: { type: "boolean" } } } }, nextStep: { type: "string" }, encouragement: { type: "string" } } },
      parse: (v) => z.object({ score: z.number(), outOf: z.number(), points: z.array(z.object({ point: z.string(), met: z.boolean() })), nextStep: z.string(), encouragement: z.string() }).parse(v),
      visible: (v) => `${v.nextStep} ${v.encouragement}`,
    });
  });

  app.post("/api/study/focus", { preHandler: child }, async (req) => {
    const b = z.object({ minutes: z.number().min(1).max(120), subjectId: z.number().int().nullable().default(null) }).parse(req.body);
    logFocus(db, b.minutes, b.subjectId);
    return { minutesToday: focusToday(db), tooLate: tooLateToStudy(db) };
  });

  // The coursework help log is the child's, to show their teacher.
  app.get("/api/study/help-log", { preHandler: child }, async () => ({ entries: helpLog(db) }));

  // ── Art ────────────────────────────────────────────────────────────────────────────────
  app.get("/api/art", { preHandler: child }, async () => ({
    challenge: challengeOfTheDay(today()), sketchbook: listSketchbook(db), mood: listMood(db),
    uploads: { enabled: false, reason: "Photo uploads stay off until image safety checks are built in. Describe your piece instead." },
  }));
  app.post("/api/art/sketchbook", { preHandler: child }, async (req) => addSketch(db, req.body));
  app.delete("/api/art/sketchbook/:id", { preHandler: child }, async (req) => { deleteSketch(db, Number((req.params as { id: string }).id)); return { ok: true }; });
  app.post("/api/art/mood", { preHandler: child }, async (req, reply) => {
    try { return addMood(db, req.body); } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });
  app.delete("/api/art/mood/:id", { preHandler: child }, async (req) => { deleteMood(db, Number((req.params as { id: string }).id)); return { ok: true }; });
  // Hook for photos of their artwork. OFF: same rule as drawing uploads (needs image moderation first).
  app.post("/api/uploads/artwork", { preHandler: child }, async (_req, reply) =>
    reply.code(403).send({ error: "Photo uploads aren't switched on yet. They need an image safety check first." }));

  // ── Shared stories ─────────────────────────────────────────────────────────────────────
  const sid = (req: { params: unknown }) => Number((req.params as { id: string }).id);
  app.get("/api/stories", { preHandler: either }, async () => ({ stories: listStories(db) }));
  app.post("/api/stories", { preHandler: child }, async (req) => saveStory(db, null, req.body));
  app.put("/api/stories/:id", { preHandler: child }, async (req, reply) => {
    const s = getStory(db, sid(req));
    return s ? saveStory(db, s.id, { ...s, ...(req.body as object) }) : reply.code(404).send({ error: "not found" });
  });
  app.delete("/api/stories/:id", { preHandler: child }, async (req) => { deleteStory(db, sid(req)); return { ok: true }; });
  app.get("/api/stories/:id", { preHandler: either }, async (req, reply) => {
    const s = getStory(db, sid(req));
    return s ? { story: s, passages: passages(db, s.id) } : reply.code(404).send({ error: "not found" });
  });

  /** Their own or their friend's writing (pasted, or from a picked Google Doc). */
  async function addHumanPassage(reply: FastifyReply, storyId: number, author: "child" | "friend", text: string) {
    if (!getStory(db, storyId)) return reply.code(404).send({ error: "not found" });
    const cats = [...checkInputRules(text).categories, ...checkOutputRules(text)];
    if (cats.some((c) => ["sexual", "romance", "grown_up_content"].includes(c))) {
      return reply.code(422).send({ error: "That part can't go into a Kith story. Stories here keep to friendships, rivalries and adventures." });
    }
    return { id: addPassage(db, storyId, author, text) };
  }
  app.post("/api/stories/:id/passages", { preHandler: child }, async (req, reply) => {
    const b = z.object({ author: z.enum(["child", "friend"]), text: z.string().trim().min(1).max(20_000) }).parse(req.body);
    return addHumanPassage(reply, sid(req), b.author, b.text);
  });
  app.post("/api/stories/:id/import-google", { preHandler: child }, async (req, reply) => {
    const g = d.storage.google;
    if (!g?.ready()) return reply.code(409).send({ error: "Google Drive isn't connected." });
    const { fileId } = z.object({ fileId: z.string() }).parse(req.body);
    return addHumanPassage(reply, sid(req), "friend", await g.drive.readPickedDoc(fileId));
  });
  app.post("/api/stories/:id/passages/:pid/decide", { preHandler: child }, async (req) => {
    const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
    return { ok: decide(db, Number((req.params as { pid: string }).pid), accept) };
  });

  // Story co-writing gets Full power when there's energy for it; it's only ever a suggestion.
  app.post("/api/stories/:id/suggest", { preHandler: child, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const s = getStory(db, sid(req));
    if (!s) return reply.code(404).send({ error: "not found" });
    const b = z.object({ kind: z.enum(["continue", "idea", "edit"]), request: z.string().max(1000).default(""), passageId: z.number().int().optional() }).parse(req.body);
    if (b.request && !(await okInput(reply, b.request))) return;
    const profile = loadProfile(db);
    const story = accepted(db, s.id).map((p) => p.text).join("\n\n").slice(-12000);
    const target = b.kind === "edit" ? passages(db, s.id).find((p) => p.id === b.passageId) : null;
    if (b.kind === "edit" && !target) return reply.code(404).send({ error: "Pick a passage to edit." });
    const ask =
      b.kind === "edit"
        ? `Suggest a ${s.voice === "light" ? "very light edit (spelling, punctuation, one clearer word; keep everything else exactly)" : "light edit that keeps the writer's voice and meaning"} of this passage. Return the whole edited passage.\n\n${target!.text}`
        : b.kind === "idea"
          ? `Give 3 short ideas for what could happen next (a line each), as a numbered list. ${b.request}`
          : `Suggest a short next passage (one paragraph, under 150 words) in the same voice. ${b.request}`;
    const out = await askJson(reply, {
      kind: "story", full: true,
      system: `You are ${profile.name}, helping a teenager write a story with their friend. It's their story, not yours: match their style, keep it age-appropriate (friendships, rivalries, adventure; no romance or anything sexual), and never take it over.${s.bible ? `\nStory bible:\n${s.bible}` : ""}`,
      prompt: `${ask}\n\nStory so far:\n${story || "(not started)"}`,
      schema: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } },
      parse: (v) => z.object({ text: z.string() }).parse(v),
      visible: (v) => v.text,
    });
    if (!out || reply.sent) return;
    const id = addPassage(db, s.id, "pip", out.text, b.kind === "edit" ? { kind: "edit", replaces: target!.id } : {});
    return { id, text: out.text };
  });

  app.post("/api/stories/:id/bible", { preHandler: child }, async (req, reply) => {
    const s = getStory(db, sid(req));
    if (!s) return reply.code(404).send({ error: "not found" });
    const story = accepted(db, s.id).map((p) => p.text).join("\n\n").slice(-30000);
    const out = await askJson(reply, {
      kind: "story",
      system: "You keep a story bible for young writers: characters (name, look, personality), places, and plot so far, plus continuity notes (things to keep consistent). Short bullet points. Only about the story, never about the writers.",
      prompt: story || "(empty)",
      schema: { type: "object", additionalProperties: false, required: ["bible"], properties: { bible: { type: "string" } } },
      parse: (v) => z.object({ bible: z.string() }).parse(v),
      visible: (v) => v.bible,
    });
    if (!out || reply.sent) return;
    return saveStory(db, s.id, { ...s, bible: out.bible.slice(0, 4000) });
  });

  // Export to a Google Doc in Kith/Stories. Kith never shares it; sharing with the friend is the child's choice.
  app.post("/api/stories/:id/google", { preHandler: child }, async (req, reply) => {
    const g = d.storage.google;
    if (!g?.ready()) return reply.code(409).send({ error: "Google Drive isn't connected and switched on." });
    const s = getStory(db, sid(req));
    if (!s) return reply.code(404).send({ error: "not found" });
    const md = storyMarkdown(db, s.id, childName(db), loadProfile(db).name);
    return g.drive.upload({ name: s.title, folder: "Stories", body: markdownToHtml(md), bodyType: "text/html", convertTo: MIME.doc });
  });

}
