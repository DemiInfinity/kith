import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "./db.js";
import { all, get, run } from "./db.js";
import { config } from "./config.js";
import { childName, requireRole } from "./auth.js";
import { MODES } from "./companion/modes.js";
import { getSubject, logHelp } from "./study/study.js";
import { CompanionProfile, loadParentSettings, loadProfile, ParentSettings, saveParentSettings, saveProfile } from "./settings.js";
import { energyNow, recentMessages, takeTurn, type Deps } from "./companion/chat.js";
import { deleteMemory, listMemories } from "./companion/memory.js";
import { sampleLine } from "./companion/prompt.js";
import { KIND_NAMES, SANDBOX_CSP, sandboxDocument, type Studio } from "./desk/studio.js";
import { DeskError } from "./desk/deskClient.js";
import { addWorld, deleteCharacter, deleteWorld, listCharacters, listWorld, saveCharacter, Sheet } from "./desk/oc.js";
import { createReport, deliverReport, listReports, type Reporter } from "./reporting/reporter.js";
import { toolLog } from "./connections/connections.js";
import { lowPowerShare, projectMonth, spendByKind, splits } from "./budget/budget.js";
import { startOfDay, startOfMonth, startOfWeek } from "./budget/time.js";
import { activitySince } from "./desk/activity.js";
import { companionFiles } from "./companion/files.js";
import { localDate } from "./budget/time.js";
import { pushReady, removeSubscription, saveSubscription } from "./checkins/push.js";
import { speakable, synthesize, transcribe } from "./voice/wyoming.js";
import type { Energy } from "./budget/budget.js";
import type { LLM } from "./llm.js";
import type { SafetyChecker } from "./safety/check.js";

export interface AppDeps { db: DB; llm: LLM; safety: SafetyChecker; reporters: Reporter[]; studio: Studio }

/** What the child sees of the budget: energy, never money. */
export function childEnergy(e: Energy) {
  return { mode: e.mode, percent: e.percent, fullBackAt: e.fullBackAt, weekResetsAt: e.weekResetsAt, limitedBy: e.limitedBy };
}

const child = requireRole("child");
const parent = requireRole("parent");
const either = requireRole("child", "parent");

export function registerRoutes(app: FastifyInstance, d: AppDeps) {
  const { db, studio } = d;
  const turnDeps = (): Deps => ({ ...d, childName: childName(db) });

  app.get("/api/me", { preHandler: either }, async (req) => {
    const s = loadParentSettings(db);
    return {
      role: req.user!.role,
      name: req.user!.role === "child" ? childName(db) || req.user!.name : req.user!.name,
      parentLabel: config.people.parentLabel,
      profile: loadProfile(db),
      helplines: s.helplines,
      quietHours: s.quietHours,
      voices: config.voice.voices.map((v) => v.label),
      kinds: KIND_NAMES,
      push: { ready: pushReady(), publicKey: config.push.publicKey },
      apiReady: d.llm.available,
      drawingUploads: false,
    };
  });

  // ── Chat and voice ─────────────────────────────────────────────────────────────────────
  app.get("/api/state", { preHandler: either }, async () => {
    const e = energyNow(db);
    const jobs = studio.jobs(5);
    const working = jobs.find((j) => j.status === "working" || j.status === "queued");
    return {
      energy: childEnergy(e),
      desk: { percent: studio.deskEnergy().percent, working: working ?? null },
      profile: loadProfile(db),
    };
  });

  app.get("/api/messages", { preHandler: child }, async () => ({ messages: recentMessages(db, 200) }));

  const ChatBody = z.object({
    text: z.string().trim().min(1).max(4000),
    mode: z.enum(MODES).default("chat"),
    ctx: z.object({ subjectId: z.number().int().optional(), coursework: z.boolean().optional(), storyId: z.number().int().optional() }).default({}),
  });
  app.post("/api/chat", { preHandler: child, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const body = ChatBody.parse(req.body);
    const turn = await takeTurn(turnDeps(), body);
    // Coursework help is logged so they can show their teacher exactly what help they had.
    const subject = getSubject(db, body.ctx.subjectId);
    if ((body.mode === "study" || body.mode === "art") && (body.ctx.coursework || subject?.subject.coursework)) {
      logHelp(db, subject?.subject.name ?? (body.mode === "art" ? "Art" : "Coursework"), turn.child.text, "Tutor help only: explanations, questions and feedback (no work produced).");
    }
    return { ...turn, energy: childEnergy(turn.energy) };
  });

  app.post("/api/voice/stt", {
    preHandler: child,
    bodyLimit: 16000 * 2 * 120, // two minutes of audio
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const pcm = req.body as Buffer;
    if (!Buffer.isBuffer(pcm) || pcm.length < 3200) return reply.code(400).send({ error: "I didn't catch anything." });
    try {
      return { text: await transcribe(config.voice.sttHost, config.voice.sttPort, pcm, config.voice.language) };
    } catch (err) {
      return reply.code(503).send({ error: (err as Error).message });
    }
  });

  const voiceFor = (label: string) => (config.voice.voices.find((v) => v.label === label) ?? config.voice.voices[0])?.voice ?? "";
  app.post("/api/voice/tts", { preHandler: child, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { messageId, preview } = z.object({ messageId: z.number().int().optional(), preview: z.string().max(40).optional() }).parse(req.body);
    let text: string;
    let voice = loadProfile(db).voice;
    if (preview !== undefined) {
      voice = preview;
      text = sampleLine(loadProfile(db));
    } else {
      // Only the companion's own messages can be spoken.
      const m = messageId ? get<{ text: string }>(db, "SELECT text FROM messages WHERE id = ? AND role = 'companion'", messageId) : undefined;
      if (!m) return reply.code(404).send({ error: "not found" });
      text = m.text;
    }
    try {
      const wavBuf = await synthesize(config.voice.ttsHost, config.voice.ttsPort, speakable(text).slice(0, 1500), voiceFor(voice));
      return reply.header("Content-Type", "audio/wav").header("Cache-Control", "no-store").send(wavBuf);
    } catch (err) {
      return reply.code(503).send({ error: (err as Error).message });
    }
  });

  // ── The desk's browser and today's work (child and parent both see these) ─────────────
  app.get("/api/desk/browser", { preHandler: either }, async () => {
    let live = null;
    try { live = await studio.desk.live(); } catch { /* desk not reachable */ }
    const s = loadParentSettings(db).browser;
    return { enabled: s.enabled, sites: s.sites, live, visits: studio.browser.visits(Date.now() - 86_400_000) };
  });
  app.get("/api/desk/today", { preHandler: either }, async () => {
    const dayStart = startOfDay(Date.now(), config.timezone);
    const byModel = all<{ model: string; usd: number }>(db, "SELECT model, SUM(usd) AS usd FROM spend WHERE bucket = 'desk' AND ts >= ? GROUP BY model", dayStart);
    const desk = studio.deskEnergy();
    return {
      activity: activitySince(db, dayStart),
      budget: {
        slice: desk.usd.dailySlice, allowanceLeft: desk.usd.allowanceLeft, percent: desk.percent, canWork: desk.canWork,
        full: byModel.filter((r) => r.model === config.anthropic.fullModel).reduce((t, r) => t + r.usd, 0),
        low: byModel.filter((r) => r.model !== config.anthropic.fullModel).reduce((t, r) => t + r.usd, 0),
      },
      power: childEnergy(energyNow(db)),
      google: Boolean(studio.storage?.google?.ready()),
    };
  });

  // ── The companion's profile: its files and what's scheduled ───────────────────────────
  app.get("/api/pip/files", { preHandler: either }, async () => companionFiles(db, childName(db)));
  app.get("/api/pip/schedule", { preHandler: either }, async () => {
    const s = loadParentSettings(db);
    const p = loadProfile(db);
    const today = localDate(Date.now(), config.timezone);
    return {
      jobs: studio.jobs(20),
      checkins: {
        toggles: p.checkins, quietHours: s.quietHours, maxPerDay: s.maxCheckinsPerDay,
        upcoming: listMemories(db).filter((m) => m.about_date && m.about_date >= today && !m.asked).map((m) => ({ date: m.about_date, text: m.text, icon: m.icon })),
        recent: all(db, "SELECT ts, kind, text FROM checkins ORDER BY ts DESC LIMIT 10"),
      },
      routines: [
        { icon: "📔", what: "Write in its journal", when: "Evenings after 8pm, on days you chatted" },
        { icon: "🗞️", what: "Weekly summary (you and " + config.people.parentLabel + " both see it)", when: "Sunday evenings" },
        { icon: "🧹", what: "Delete chats older than " + s.retentionDays + " days", when: "Every few minutes" },
        { icon: "🔁", what: "Retry any report that didn’t get through", when: "Every few minutes" },
      ],
    };
  });

  // ── Identity, personality, memory ──────────────────────────────────────────────────────
  app.put("/api/profile", { preHandler: child }, async (req) => {
    const next = CompanionProfile.parse({ ...loadProfile(db), ...(req.body as object) });
    return saveProfile(db, next);
  });
  app.get("/api/profile/sample", { preHandler: child }, async () => ({ text: sampleLine(loadProfile(db)) }));

  app.get("/api/memories", { preHandler: child }, async () => ({ memories: listMemories(db) }));
  app.delete("/api/memories/:id", { preHandler: child }, async (req) => ({ ok: deleteMemory(db, Number((req.params as { id: string }).id)) }));

  // ── The desk and the studio ────────────────────────────────────────────────────────────
  app.get("/api/desk", { preHandler: either }, async () => {
    let items: unknown[] = [];
    let status = { activity: "", progress: 0, updatedAt: 0 };
    let reachable = true;
    try {
      [items, status] = await Promise.all([studio.desk.list(), studio.desk.status()]);
    } catch {
      reachable = false;
    }
    return {
      reachable,
      items,
      status,
      jobs: studio.jobs(10),
      journal: all(db, "SELECT day, text FROM journal ORDER BY day DESC LIMIT 14"),
      links: studio.storage?.links() ?? [],
      energy: { percent: studio.deskEnergy().percent, canWork: studio.deskEnergy().canWork },
    };
  });

  const deskErr = (reply: import("fastify").FastifyReply, err: unknown) =>
    reply.code(err instanceof DeskError && /not found/i.test(err.message) ? 404 : 502).send({ error: (err as Error).message });

  app.get("/api/desk/items/:id", { preHandler: either }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const v = Number((req.query as { v?: string }).v) || undefined;
    try {
      return await studio.desk.read(id, v);
    } catch (err) {
      return deskErr(reply, err);
    }
  });

  // The locked sandbox: an opaque origin with no network, storage or access to the app.
  app.get("/api/desk/items/:id/frame", { preHandler: either }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const item = await studio.desk.read(id, Number((req.query as { v?: string }).v) || undefined);
      const doc = sandboxDocument(item.content, item.meta.format);
      if (!doc) return reply.code(415).send({ error: "Not an interactive item." });
      return reply
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Content-Security-Policy", SANDBOX_CSP)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .send(doc);
    } catch (err) {
      return deskErr(reply, err);
    }
  });

  app.put("/api/desk/items/:id/favourite", { preHandler: child }, async (req, reply) => {
    try {
      return await studio.desk.favourite((req.params as { id: string }).id, Boolean((req.body as { favourite?: boolean }).favourite));
    } catch (err) {
      return deskErr(reply, err);
    }
  });
  app.delete("/api/desk/items/:id", { preHandler: child }, async (req, reply) => {
    try {
      return await studio.desk.remove((req.params as { id: string }).id);
    } catch (err) {
      return deskErr(reply, err);
    }
  });

  const MakeBody = z.object({
    kind: z.enum(KIND_NAMES as [string, ...string[]]),
    title: z.string().trim().min(1).max(80),
    brief: z.string().trim().min(1).max(2000),
    chapters: z.number().int().min(1).max(3).optional(),
    characterIds: z.array(z.number().int()).max(6).optional(),
  });
  app.post("/api/desk/make", { preHandler: child, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = MakeBody.parse(req.body);
    const check = await d.safety.checkInput(`${b.title}. ${b.brief}`, []);
    if (["sexual", "romance"].some((c) => check.categories.includes(c as never)) || check.level !== "none") {
      return reply.code(422).send({ error: "That's not something I can make. Want to try a different idea?" });
    }
    const job = studio.enqueue({ kind: b.kind as never, title: b.title, brief: b.brief, chapters: b.chapters, characterIds: b.characterIds });
    return job.ok ? job.job : reply.code(409).send({ error: job.error });
  });
  app.post("/api/desk/items/:id/change", { preHandler: child, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { change } = z.object({ change: z.string().trim().min(1).max(1000) }).parse(req.body);
    const check = await d.safety.checkInput(change, []);
    if (check.level !== "none" || check.categories.some((c) => ["sexual", "romance"].includes(c))) {
      return reply.code(422).send({ error: "That's not a change I can make." });
    }
    const job = studio.enqueue({ kind: "edit", title: "A change", brief: change, fileId: (req.params as { id: string }).id });
    return job.ok ? job.job : reply.code(409).send({ error: job.error });
  });

  // ── OC workshop ───────────────────────────────────────────────────────────────────────
  app.get("/api/oc", { preHandler: either }, async () => ({ characters: listCharacters(db), world: listWorld(db) }));
  app.post("/api/oc/characters", { preHandler: child }, async (req, reply) => {
    const r = saveCharacter(db, { fields: Sheet.partial().parse(req.body) });
    return r.ok ? r.character : reply.code(422).send({ error: `Not saved: ${r.problems.join("; ")}` });
  });
  app.put("/api/oc/characters/:id", { preHandler: child }, async (req, reply) => {
    const r = saveCharacter(db, { id: Number((req.params as { id: string }).id), fields: Sheet.partial().parse(req.body) });
    return r.ok ? r.character : reply.code(422).send({ error: `Not saved: ${r.problems.join("; ")}` });
  });
  app.delete("/api/oc/characters/:id", { preHandler: child }, async (req) => ({ ok: deleteCharacter(db, Number((req.params as { id: string }).id)) }));
  app.post("/api/oc/world", { preHandler: child }, async (req, reply) => {
    const r = addWorld(db, req.body as never);
    return r.ok ? r : reply.code(422).send({ error: `Not saved: ${r.problems.join("; ")}` });
  });
  app.delete("/api/oc/world/:id", { preHandler: child }, async (req) => ({ ok: deleteWorld(db, Number((req.params as { id: string }).id)) }));

  // Hook for uploading the child's own drawings. Deliberately OFF: it stays disabled until a
  // child-safety image detector (e.g. Thorn Safer or IWF hash matching) is wired in here and
  // checks every upload before it's stored or sent anywhere. See docs/safety.md.
  app.post("/api/uploads/drawing", { preHandler: child }, async (_req, reply) =>
    reply.code(403).send({ error: "Uploading drawings isn't switched on yet. It needs a child-safety check first." }),
  );

  // ── Need a grown-up? ──────────────────────────────────────────────────────────────────
  app.post("/api/help/message-parent", { preHandler: child, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
    const { text } = z.object({ text: z.string().max(500).default("") }).parse(req.body ?? {});
    const who = childName(db) || "Your child";
    const parentText = text.trim() ? `${who} pressed "Need a grown-up?" and wrote: ${text.trim()}` : `${who} pressed "Need a grown-up?" and would like you.`;
    const report = createReport(db, { level: "now", category: "asked_for_help", childNotice: "You asked for a grown-up.", parentText });
    const ok = await deliverReport(db, d.reporters, report, { companionName: loadProfile(db).name, childName: childName(db) });
    return { ok };
  });

  // ── Push (the child's devices only) ───────────────────────────────────────────────────
  const Sub = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) });
  app.post("/api/push/subscribe", { preHandler: child }, async (req) => {
    saveSubscription(db, Sub.parse(req.body));
    return { ok: true };
  });
  app.post("/api/push/unsubscribe", { preHandler: child }, async (req) => {
    removeSubscription(db, z.object({ endpoint: z.string() }).parse(req.body).endpoint);
    return { ok: true };
  });

  // ── What the grown-up sees (the child sees exactly this, minus money) ──────────────────
  app.get("/api/transparency", { preHandler: either }, async () => ({
    reports: listReports(db, 50).map((r) => ({ id: r.id, ts: r.ts, level: r.level, childNotice: r.child_notice, parentText: r.parent_text, status: r.status })),
    summaries: all(db, "SELECT week_start, text FROM summaries ORDER BY week_start DESC LIMIT 12"),
    toolLog: toolLog(db, 100),
    retentionDays: loadParentSettings(db).retentionDays,
  }));

  // ── Parent view ───────────────────────────────────────────────────────────────────────
  app.get("/api/parent/overview", { preHandler: parent }, async () => {
    const s = loadParentSettings(db);
    const e = energyNow(db);
    const now = Date.now();
    return {
      energy: e,
      desk: studio.deskEnergy(),
      budgets: s.budgets,
      split: splits(s.budgets),
      projection: projectMonth(e.usd.month, now, config.timezone),
      lowPower: {
        week: lowPowerShare(db, startOfWeek(now, config.timezone, s.budgets.weekResetDay), config.anthropic.lowModel),
        month: lowPowerShare(db, startOfMonth(now, config.timezone), config.anthropic.lowModel),
      },
      spend: {
        week: spendByKind(db, startOfWeek(now, config.timezone, s.budgets.weekResetDay)),
        month: spendByKind(db, startOfMonth(now, config.timezone)),
      },
      settings: s,
      status: {
        apiReady: d.llm.available,
        reporters: config.reporting.reporters,
        push: pushReady(),
        childPushDevices: get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM push_subs")?.n ?? 0,
        models: { full: config.anthropic.fullModel, low: config.anthropic.lowModel, safety: config.anthropic.safetyModel },
      },
      childName: childName(db),
      companion: loadProfile(db),
    };
  });

  app.put("/api/parent/settings", { preHandler: parent }, async (req) => {
    const current = loadParentSettings(db);
    const next = ParentSettings.parse({ ...current, ...(req.body as object) });
    return saveParentSettings(db, next);
  });

  app.post("/api/parent/test-report", { preHandler: parent, config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } }, async () => {
    const report = createReport(db, { level: "fyi", category: "test", childNotice: "This was a test from the parent view.", parentText: "Test report from Kith: reports are reaching you." });
    const ok = await deliverReport(db, d.reporters, report, { companionName: loadProfile(db).name, childName: childName(db) });
    run(db, "DELETE FROM reports WHERE id = ?", report.id);
    return { ok };
  });
}
