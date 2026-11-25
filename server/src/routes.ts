import { describe, voiceSetup } from "./voice/settings.js";
import { diskUsage } from "./disk.js";
import { heartbeatStatus } from "./companion/heartbeat.js";
import { deleteSkill, enabledSkills, EXAMPLES, listSkills, saveSkill } from "./companion/skills.js";
import { canStoreKeys, checkKey, currentKey, keyStatus, looksLikeKey, removeKey, saveKey } from "./apikey.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "./db.js";
import { all, get, run } from "./db.js";
import { config } from "./config.js";
import { childName, requireRole } from "./auth.js";
import { createThread, listThreads, MAIN_THREAD, updateThread } from "./companion/threads.js";
import { listHistory, readHistory } from "./companion/history.js";
import { MODES } from "./companion/modes.js";
import { getSubject, logHelp } from "./study/study.js";
import { CompanionProfile, OFFERED_LOOKS, loadParentSettings, loadProfile, ParentSettings, saveParentSettings, saveProfile } from "./settings.js";
import { energyNow, recentMessages, takeTurn, type Deps } from "./companion/chat.js";
import { addMemory, deleteMemory, listMemories } from "./companion/memory.js";
import { sampleLine } from "./companion/prompt.js";
import { KIND_NAMES, SANDBOX_CSP, sandboxDocument, type Studio } from "./desk/studio.js";
import { DeskError } from "./desk/deskClient.js";
import { addWorld, deleteCharacter, deleteWorld, listCharacters, listWorld, saveCharacter, Sheet } from "./desk/oc.js";
import { createReport, deliverReport, listReports, type Reporter } from "./reporting/reporter.js";
import { toolLog } from "./connections/connections.js";
import { lowPowerShare, projectMonth, spendByKind, splits } from "./budget/budget.js";
import { startOfDay, startOfMonth, startOfWeek } from "./budget/time.js";
import { activitySince, logActivity } from "./desk/activity.js";
import { companionFiles, safeguardsDoc } from "./companion/files.js";
import { checkInputRules } from "./safety/rules.js";
import { localDate } from "./budget/time.js";
import { deviceCount, pushReady, pushToChild, removeSubscription, saveSubscription } from "./checkins/push.js";
import { notifyParent } from "./checkins/parentPush.js";
import { registerParentInbox } from "./checkins/parentInbox.js";
import { parentTestChat } from "./companion/parentTest.js";
import { addSchedule, deleteSchedule, listSchedules, setActive } from "./companion/schedules.js";
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
      voices: voiceSetup(db).voices.map((v) => v.label),
      kinds: KIND_NAMES,
      looks: OFFERED_LOOKS,
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
    let browsing: { title: string; by: string | null } | null = null;
    try {
      const l = await studio.desk.live();
      if (l.takenOverBy || l.busy) browsing = { title: l.title, by: l.takenOverBy ?? null };
    } catch { /* desk asleep or unreachable */ }
    return {
      energy: childEnergy(e),
      desk: { percent: studio.deskEnergy().percent, working: working ?? null, browsing },
      profile: loadProfile(db),
    };
  });

  app.get("/api/messages", { preHandler: child }, async (req) => {
    const thread = Number((req.query as { thread?: string }).thread) || MAIN_THREAD;
    return { messages: recentMessages(db, 200, thread) };
  });

  // ── Side chats ────────────────────────────────────────────────────────────────────────
  app.get("/api/threads", { preHandler: child }, async () => ({ threads: listThreads(db) }));
  app.post("/api/threads", { preHandler: child }, async (req) => {
    const b = z.object({ title: z.string().max(60).optional(), fromMessageId: z.number().int().optional() }).parse(req.body ?? {});
    const from = b.fromMessageId ? get<{ text: string; thread_id: number }>(db, "SELECT text, thread_id FROM messages WHERE id = ?", b.fromMessageId) : undefined;
    return createThread(db, { title: b.title, fromText: from?.text, parentId: from?.thread_id });
  });
  app.patch("/api/threads/:id", { preHandler: child }, async (req, reply) => {
    const b = z.object({ title: z.string().max(60).optional(), archived: z.boolean().optional() }).parse(req.body ?? {});
    return updateThread(db, Number((req.params as { id: string }).id), b) ? { ok: true } : reply.code(400).send({ error: "The main chat can’t be archived." });
  });

  // ── Things they asked to schedule ─────────────────────────────────────────────────────
  app.get("/api/schedules", { preHandler: either }, async () => ({ schedules: listSchedules(db) }));
  app.post("/api/schedules", { preHandler: child }, async (req, reply) => {
    const r = addSchedule(db, req.body, config.timezone);
    return r.ok ? r.schedule : reply.code(422).send({ error: r.error });
  });
  app.patch("/api/schedules/:id", { preHandler: child }, async (req) => {
    setActive(db, Number((req.params as { id: string }).id), z.object({ active: z.boolean() }).parse(req.body).active);
    return { ok: true };
  });
  app.delete("/api/schedules/:id", { preHandler: child }, async (req) => {
    deleteSchedule(db, Number((req.params as { id: string }).id));
    return { ok: true };
  });

  // ── Chat history archive (the child's only) ───────────────────────────────────────────
  app.get("/api/history", { preHandler: child }, async () => ({ files: listHistory() }));
  app.get("/api/history/file", { preHandler: child }, async (req, reply) => {
    const md = readHistory(String((req.query as { f?: string }).f ?? ""));
    return md === null ? reply.code(404).send({ error: "not found" }) : { md };
  });

  const ChatBody = z.object({
    text: z.string().trim().min(1).max(4000),
    mode: z.enum(MODES).default("chat"),
    ctx: z.object({ subjectId: z.number().int().optional(), coursework: z.boolean().optional(), storyId: z.number().int().optional() }).default({}),
    thread: z.number().int().optional(),
    // A document shared from the Mac app (its text only).
    file: z.object({ name: z.string().max(200), text: z.string().min(1).max(12_000) }).optional(),
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
      const vs = voiceSetup(db);
      return { text: await transcribe(vs.sttHost, vs.sttPort, pcm, vs.language, vs.whisperModel) };
    } catch (err) {
      return reply.code(503).send({ error: (err as Error).message });
    }
  });

  const voiceFor = (label: string) => { const vv = voiceSetup(db).voices; return (vv.find((v) => v.label === label) ?? vv[0])?.voice ?? ""; };
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
      const vs = voiceSetup(db);
      const wavBuf = await synthesize(vs.ttsHost, vs.ttsPort, speakable(text).slice(0, 1500), voiceFor(voice));
      return reply.header("Content-Type", "audio/wav").header("Cache-Control", "no-store").send(wavBuf);
    } catch (err) {
      return reply.code(503).send({ error: (err as Error).message });
    }
  });

  // ── The desk's browser and today's work (child and parent both see these) ─────────────
  app.get("/api/desk/browser", { preHandler: either }, async (req) => {
    let live = null;
    try { live = await studio.desk.live(); } catch { /* desk not reachable */ }
    const s = loadParentSettings(db).browser;
    const you = req.user!.role === "parent" ? config.people.parentLabel : childName(db) || "you";
    return { enabled: s.enabled, mode: s.mode, sites: s.sites, you, live, visits: studio.browser.visits(Date.now() - 86_400_000) };
  });
  // Take over the desk browser (child or parent). Same rules: block list, read-only, logged.
  const who = (role: string) => (role === "parent" ? config.people.parentLabel : childName(db) || "you");
  const logVisit = (url: string, title: string, role: string) => {
    run(db, "INSERT INTO browse_log(ts, url, title, why, job_id, outcome) VALUES (?,?,?,?,NULL,'read')", Date.now(), url.slice(0, 500), title.slice(0, 200), `taken over by ${who(role)}`);
    logActivity(db, "🧭", `${who(role)} browsed “${title || url}”`);
  };
  app.post("/api/desk/browser/takeover", { preHandler: either }, async (req, reply) => {
    const b = loadParentSettings(db).browser;
    if (!b.enabled) return reply.code(409).send({ error: "Browsing is switched off." });
    try {
      const l = await studio.desk.takeOver(who(req.user!.role), studio.browser.deskRules(b), undefined, loadProfile(db).name);
      logVisit(l.url, l.title, req.user!.role);
      return { ...l, takenOverBy: who(req.user!.role) };
    } catch (err) {
      return reply.code(422).send({ error: (err as Error).message });
    }
  });
  app.post("/api/desk/browser/action", { preHandler: either, config: { rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (req, reply) => {
    const a = z.object({
      type: z.enum(["go", "click", "scroll", "back", "forward", "reload", "home", "newtab", "tab", "closetab", "type", "key"]),
      url: z.string().max(500).optional(), x: z.number().optional(), y: z.number().optional(), dy: z.number().optional(),
      index: z.number().int().min(0).max(20).optional(), text: z.string().max(500).optional(), key: z.string().max(20).optional(),
    }).parse(req.body);
    try {
      const l = await studio.desk.act(a);
      if (l.navigated) logVisit(l.url, l.title, req.user!.role);
      return { ...l, takenOverBy: who(req.user!.role) };
    } catch (err) {
      return reply.code(422).send({ error: (err as Error).message });
    }
  });
  // Where the driver's pointer is, so everyone watching sees it move (no screenshot, nothing logged).
  app.post("/api/desk/browser/pointer", { preHandler: either, config: { rateLimit: { max: 400, timeWindow: "1 minute" } } }, async (req, reply) => {
    const a = z.object({ x: z.number(), y: z.number() }).parse(req.body);
    try { return await studio.desk.act({ type: "move", x: a.x, y: a.y }); }
    catch (err) { return reply.code(422).send({ error: (err as Error).message }); }
  });
  // Voice: what's in use, and what the voice servers actually offer (Wyoming "describe").
  app.get("/api/parent/voice", { preHandler: parent }, async () => {
    const vs = voiceSetup(db);
    const [stt, tts] = await Promise.all([describe(vs.sttHost, vs.sttPort), describe(vs.ttsHost, vs.ttsPort)]);
    return { setup: { ...vs, envWhisperModel: process.env.KITH_WHISPER_MODEL ?? "tiny-int8" }, stt: { ...stt, installed: stt.installed.slice(0, 40) }, tts: { ok: tts.ok, error: tts.error, installed: tts.installed.filter((n) => /^en_/.test(n)).slice(0, 80) } };
  });
  // Disk: Kith's data and the desk's files, against the parent's budget.
  app.get("/api/parent/disk", { preHandler: parent }, async () => {
    const u = await diskUsage(db, studio.desk, true);
    studio.disk = u;
    return u;
  });
  // The heartbeat (always on): when it last beat and what it decided.
  app.get("/api/heartbeat", { preHandler: either }, async () => heartbeatStatus(db));
  // Skills: the parent writes them; the child sees the ones that are on (and their /commands).
  app.get("/api/skills", { preHandler: either }, async () => ({
    skills: enabledSkills(db).map((k) => ({ id: k.id, name: k.name, description: k.description, command: k.command })),
  }));
  app.get("/api/parent/skills", { preHandler: parent }, async () => ({ skills: listSkills(db), examples: EXAMPLES }));
  app.post("/api/parent/skills", { preHandler: parent }, async (req, reply) => {
    const r = saveSkill(db, req.body);
    return r.ok ? r.skill : reply.code(400).send({ error: r.error });
  });
  app.put("/api/parent/skills/:id", { preHandler: parent }, async (req, reply) => {
    const r = saveSkill(db, req.body, Number((req.params as { id: string }).id));
    return r.ok ? r.skill : reply.code(400).send({ error: r.error });
  });
  app.delete("/api/parent/skills/:id", { preHandler: parent }, async (req) => {
    deleteSkill(db, Number((req.params as { id: string }).id));
    return { ok: true };
  });
  // The connectors the parent switched on, for the child to see (names and what Pip can do: no
  // addresses, tokens or settings).
  app.get("/api/connectors", { preHandler: either }, async () => {
    const conns = loadParentSettings(db).connections.filter((c) => c.enabled);
    return { connectors: conns.map((c) => ({ id: c.id, kind: c.kind, name: c.name, level: c.level, tools: ["kin", "mcp"].includes(c.kind) ? c.allowedTools : [] })) };
  });
  // The Anthropic API key, set by the parent. Never sent back (only its last four characters).
  app.get("/api/parent/apikey", { preHandler: parent }, async () => keyStatus(db));
  app.put("/api/parent/apikey", { preHandler: parent, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const key = String((req.body as { key?: unknown })?.key ?? "").trim();
    if (!canStoreKeys()) return reply.code(409).send({ error: "Set KITH_SECRET_KEY on the server first (64 hex characters: openssl rand -hex 32), so the key can be stored encrypted." });
    if (!looksLikeKey(key)) return reply.code(400).send({ error: "That doesn’t look like an Anthropic API key (they start with sk-ant-)." });
    const problem = await checkKey(key);
    if (problem) return reply.code(422).send({ error: problem });
    saveKey(db, key);
    d.llm.setKey?.(key);
    return keyStatus(db);
  });
  app.delete("/api/parent/apikey", { preHandler: parent }, async () => {
    removeKey(db);
    d.llm.setKey?.(currentKey(db).key);
    return keyStatus(db);
  });
  // The desk screen went to sleep in the app: let the desk close its browser if nobody's using it.
  app.post("/api/desk/browser/sleep", { preHandler: either }, async () => {
    try { return await studio.desk.sleepBrowser(); } catch { return { slept: false }; }
  });
  // Forget what sites stored in the desk's browser (cookies, site data, history). Parent only.
  app.post("/api/parent/browser/clear", { preHandler: parent }, async (_req, reply) => {
    try { await studio.desk.clearBrowser(); } catch (err) { return reply.code(422).send({ error: (err as Error).message }); }
    logActivity(db, "🧹", `${config.people.parentLabel} cleared the desk browser's saved data`);
    return { ok: true };
  });
  app.post("/api/desk/browser/release", { preHandler: either }, async (req) => {
    await studio.desk.release().catch(() => undefined);
    logActivity(db, "🤝", `${who(req.user!.role)} gave the browser back to ${loadProfile(db).name}`);
    return { ok: true };
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

  // soul.md and identity.md are the child's to write. Safeguards sit above them either way, but
  // obviously unsuitable text (romance, sexual, personal details) isn't kept.
  async function okText(reply: import("fastify").FastifyReply, text: string) {
    if (!text.trim()) return true;
    const rules = checkInputRules(text);
    const v = await d.safety.checkInput(text, []);
    const bad = [...rules.categories, ...v.categories].filter((c) => ["sexual", "romance", "personal_info"].includes(c));
    if (bad.length || v.level !== "none") {
      reply.code(422).send({ error: bad.includes("personal_info") ? "Leave out personal details like your address or school." : "That bit can’t go in. Pip stays a friendly AI sidekick: no romance or grown-up stuff." });
      return false;
    }
    return true;
  }
  app.put("/api/pip/soul", { preHandler: child }, async (req, reply) => {
    const { text } = z.object({ text: z.string().max(3000) }).parse(req.body);
    if (!(await okText(reply, text))) return;
    saveProfile(db, { ...loadProfile(db), soul: text });
    return companionFiles(db, childName(db));
  });
  app.put("/api/pip/identity", { preHandler: child }, async (req, reply) => {
    const { notes } = z.object({ notes: z.string().max(2000) }).parse(req.body);
    if (!(await okText(reply, notes))) return;
    saveProfile(db, { ...loadProfile(db), identityNotes: notes });
    return companionFiles(db, childName(db));
  });
  app.post("/api/memories", { preHandler: child }, async (req, reply) => {
    const b = z.object({ text: z.string().trim().min(1).max(140), icon: z.string().max(8).default("💭") }).parse(req.body);
    if (!(await okText(reply, b.text))) return;
    const r = addMemory(db, { text: b.text, icon: b.icon });
    return r.ok ? r : reply.code(422).send({ error: r.reason });
  });
  app.get("/api/parent/safeguards", { preHandler: parent }, async () => safeguardsDoc(db, childName(db)));
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
    // soul and identity notes have their own checked routes.
    const { soul: _s, identityNotes: _i, ...changes } = (req.body ?? {}) as Record<string, unknown>;
    const next = CompanionProfile.parse({ ...loadProfile(db), ...changes });
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

  // ── Grown-up? ──────────────────────────────────────────────────────────────────
  app.post("/api/help/message-parent", { preHandler: child, config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
    const { text } = z.object({ text: z.string().max(500).default("") }).parse(req.body ?? {});
    const who = childName(db) || "Your child";
    const parentText = text.trim() ? `${who} pressed "Grown-up?" and wrote: ${text.trim()}` : `${who} pressed "Grown-up?" and would like you.`;
    const report = createReport(db, { level: "now", category: "asked_for_help", childNotice: "You asked for a grown-up.", parentText });
    const ok = await deliverReport(db, d.reporters, report, { companionName: loadProfile(db).name, childName: childName(db) });
    return { ok };
  });

  // ── Push (each device belongs to the child or the parent who turned it on) ─────────────
  const Sub = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) });
  app.post("/api/push/subscribe", { preHandler: either }, async (req) => {
    saveSubscription(db, Sub.parse(req.body), req.user!.role === "parent" ? "parent" : "child");
    return { ok: true };
  });
  registerParentInbox(app, db);
  // A short private test chat for the parent (not saved; no tools; never sees the child's chats).
  app.post("/api/parent/test-chat", { preHandler: parent, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = z.object({
      text: z.string().trim().min(1).max(1000),
      history: z.array(z.object({ role: z.enum(["parent", "companion"]), text: z.string().max(2000) })).max(12).default([]),
    }).parse(req.body);
    if (!d.llm.available) return reply.code(409).send({ error: `${loadProfile(db).name} can't think yet: add the Anthropic API key in Settings › Claude.` });
    try {
      return await parentTestChat({ db, llm: d.llm, safety: d.safety, childName: childName(db) }, b.text, b.history);
    } catch (err) {
      const status = (err as { status?: number }).status;
      return reply.code(502).send({ error: status === 401 ? "Anthropic didn't accept the API key. Check it in Settings › Claude." : `Couldn't reach Claude: ${(err as Error).message.slice(0, 160)}` });
    }
  });
  app.post("/api/parent/push/test", { preHandler: parent, config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async () => {
    const sent = await notifyParent(db, { kind: "test" });
    return { sent, devices: deviceCount(db, "parent") };
  });
  app.post("/api/push/test", { preHandler: child, config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async () => {
    const sent = await pushToChild(db, { title: loadProfile(db).name, body: "This is what my notifications look like 👋", url: "/" }, "test");
    return { sent };
  });
  app.post("/api/push/unsubscribe", { preHandler: either }, async (req) => {
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
        childPushDevices: deviceCount(db, "child"),
        parentPushDevices: deviceCount(db, "parent"),
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
