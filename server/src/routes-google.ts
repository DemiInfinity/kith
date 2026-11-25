import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "./db.js";
import { get, run } from "./db.js";
import { config } from "./config.js";
import { requireRole, sessionFor } from "./auth.js";
import { loadParentSettings } from "./settings.js";
import { authUrl, CALENDAR_SCOPE, connectConfig, viaConnect, exchangeCode, googleConfigured, loadGoogle, markdownToHtml, MIME, rememberFile, revoke, saveGoogle, scopesFor, seal, TASKS_SCOPE, unseal } from "./storage/google.js";
import { apply, decline, gLog, googleFeatures, listFiles, pendingList, setCoursework } from "./storage/googleWork.js";
import type { Storage } from "./storage/storage.js";
import type { Studio } from "./desk/studio.js";
import { getCharacter } from "./desk/oc.js";
import { toolLogger } from "./storage/storage.js";

const child = requireRole("child");
const either = requireRole("child", "parent");

export function registerGoogle(app: FastifyInstance, db: DB, storage: Storage, studio: Studio) {
  const g = storage.google;

  app.get("/api/google", { preHandler: either }, async () => {
    const s = loadGoogle(db);
    const conn = loadParentSettings(db).connections.find((c) => c.kind === "google-drive");
    return {
      configured: googleConfigured(),
      connected: !!s,
      email: s?.email ?? "",
      enabled: !!conn?.enabled,
      sharedWith: s?.sharedWith ?? "",
      picker: viaConnect() || (googleConfigured() && !!config.google.pickerApiKey && !!config.google.appId),
      expected: config.google.expectedEmail,
      // What the parent switched on, and whether the sign-in already covers it (else: connect again).
      features: (({ edit, calendar, tasks }) => ({ edit, calendar, tasks }))(googleFeatures(db)),
      reconnect: !!s && ((googleFeatures(db).calendar && !(s.scopes ?? []).includes(CALENDAR_SCOPE)) || (googleFeatures(db).tasks && !(s.scopes ?? []).includes(TASKS_SCOPE))),
    };
  });

  // The parent's setup guide: the exact addresses and scopes this Kith needs, and what's set so far.
  // Every family makes their own Google client (no shared secrets); this makes that a checklist.
  app.get("/api/parent/google/setup", { preHandler: requireRole("parent") }, async () => {
    const f = loadParentSettings(db).connections.find((c) => c.kind === "google-drive")?.features;
    const origin = config.publicUrl;
    return {
      origin, redirectUri: `${origin}/auth/google/callback`, https: origin.startsWith("https://"),
      apis: ["Google Drive API", "Google Docs API", "Google Sheets API", "Google Slides API", "Google Picker API", ...(f?.calendar ? ["Google Calendar API"] : []), ...(f?.tasks ? ["Google Tasks API"] : [])],
      scopes: scopesFor(f).map((s) => (s === "email" ? "https://www.googleapis.com/auth/userinfo.email" : s)),
      sensitive: [...(f?.calendar ? [CALENDAR_SCOPE] : []), ...(f?.tasks ? [TASKS_SCOPE] : [])],
      // Using the shared Kith Connect helper: nothing for this family to set up in Google.
      connect: viaConnect() ? config.google.connectUrl : "",
      status: {
        client: googleConfigured(), secretKey: !!process.env.KITH_SECRET_KEY, picker: !!config.google.pickerApiKey && !!config.google.appId,
        account: config.google.expectedEmail, connected: !!loadGoogle(db),
      },
    };
  });

  // The child connects their own Google account (once). PKCE + state; the code comes back to the server.
  app.post("/api/google/connect", { preHandler: child }, async (_req, reply) => {
    if (!googleConfigured()) return reply.code(503).send({ error: "Google isn't set up on this Kith yet (see docs/google.md)." });
    if (!process.env.KITH_SECRET_KEY) return reply.code(503).send({ error: "KITH_SECRET_KEY isn't set, so Kith can't store Google sign-in safely." });
    const state = crypto.randomBytes(24).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    run(db, "INSERT INTO oidc_state(state, verifier, nonce, created) VALUES (?,?, 'google', ?)", state, verifier, Date.now());
    // Calendar and Tasks are only asked for if the parent has switched them on.
    const f = loadParentSettings(db).connections.find((c) => c.kind === "google-drive")?.features;
    return { url: authUrl(state, challenge, scopesFor(f)) };
  });

  app.get("/auth/google/callback", async (req, reply) => {
    const user = sessionFor(db, req.cookies.kith_sid);
    if (!user || user.role !== "child") return reply.redirect("/?signin=expired");
    const q = req.query as { state?: string; code?: string; error?: string };
    if (q.error || !q.code || !q.state) return reply.redirect("/google?result=cancelled");
    const row = get<{ verifier: string; nonce: string; created: number }>(db, "SELECT verifier, nonce, created FROM oidc_state WHERE state = ?", q.state);
    run(db, "DELETE FROM oidc_state WHERE state = ?", q.state);
    if (!row || row.nonce !== "google" || Date.now() - row.created > 15 * 60_000) return reply.redirect("/google?result=expired");
    try {
      const t = await exchangeCode(q.code, row.verifier, fetch, scopesFor(loadParentSettings(db).connections.find((c) => c.kind === "google-drive")?.features));
      const old = loadGoogle(db);
      saveGoogle(db, { email: t.email, refresh: seal(t.refresh), connectedAt: Date.now(), folders: old?.email === t.email ? old.folders : {}, sharedWith: old?.email === t.email ? old.sharedWith : "", scopes: t.scopes });
      toolLogger(db, "Google Drive")("connect", t.email, `connected (${t.scopes.filter((x) => x.startsWith("https://")).map((x) => x.split("/").pop()).join(", ")})`, true);
      return reply.redirect("/google?result=connected");
    } catch (err) {
      req.log.warn({ err }, "google connect failed");
      return reply.redirect(`/google?result=failed&why=${encodeURIComponent((err as Error).message.slice(0, 120))}`);
    }
  });

  // Either can disconnect. Files already in their Drive stay theirs.
  app.post("/api/google/disconnect", { preHandler: either }, async (req) => {
    const s = loadGoogle(db);
    if (s) {
      try { await revoke(unseal(s.refresh)); } catch { /* already gone */ }
      saveGoogle(db, null);
      toolLogger(db, "Google Drive")("disconnect", s.email, `disconnected by the ${req.user!.role}`, true);
    }
    return { ok: true };
  });

  // Save something already on the desk into their Drive (a new file; never replaces anything).
  app.post("/api/desk/items/:id/google", { preHandler: child, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!g?.ready()) return reply.code(409).send({ error: "Google Drive isn't connected and switched on." });
    const item = await studio.desk.read((req.params as { id: string }).id);
    const links = await storage.mirror(item.meta.id, { kind: item.meta.kind, title: item.meta.title, format: item.meta.format, content: item.content, version: item.meta.version, characterIds: item.meta.characterIds });
    return links.length ? links[0] : reply.code(502).send({ error: "Saving to Google didn't work. The desk still has it." });
  });

  app.post("/api/oc/characters/:id/google", { preHandler: child }, async (req, reply) => {
    if (!g?.ready()) return reply.code(409).send({ error: "Google Drive isn't connected and switched on." });
    const c = getCharacter(db, Number((req.params as { id: string }).id));
    if (!c) return reply.code(404).send({ error: "not found" });
    const s = c.sheet;
    const md = [`# ${s.icon} ${s.name}`, s.look && `## Look\n\n${s.look}`, s.personality && `## Personality\n\n${s.personality}`, s.powers && `## Powers\n\n${s.powers}`,
      s.backstory && `## Backstory\n\n${s.backstory}`, s.likes && `## Likes\n\n${s.likes}`, s.dislikes && `## Dislikes\n\n${s.dislikes}`,
      s.palette.length && `## Palette\n\n${s.palette.join("  ")}`, s.themeSong && `## Theme song\n\n${s.themeSong}`,
      s.relationships.length && `## Relationships\n\n${s.relationships.map((r) => `- ${r.kind} of ${r.with}${r.note ? `: ${r.note}` : ""}`).join("\n")}`]
      .filter(Boolean).join("\n\n");
    const r = await g.drive.upload({ name: `${s.name} (character sheet)`, folder: "OCs", body: markdownToHtml(md), bodyType: "text/html", convertTo: MIME.doc });
    return r;
  });

  // A short-lived drive.file token for the Google Picker, so the child can hand Kith one document.
  app.get("/api/google/picker", { preHandler: child }, async (_req, reply) => {
    if (!g?.ready()) return reply.code(409).send({ error: "Google isn't connected." });
    const cfg = viaConnect() ? await connectConfig().then((c) => ({ apiKey: c.pickerApiKey, appId: c.appId })).catch(() => ({ apiKey: "", appId: "" }))
      : { apiKey: config.google.pickerApiKey, appId: config.google.appId };
    if (!cfg.apiKey || !cfg.appId) return reply.code(409).send({ error: "The Google Picker isn't set up." });
    return { token: await g.drive.pickerToken(), ...cfg };
  });

  app.post("/api/google/read-picked", { preHandler: child }, async (req, reply) => {
    if (!g?.ready()) return reply.code(409).send({ error: "Google Drive isn't connected." });
    const { fileId, name } = z.object({ fileId: z.string(), name: z.string().max(200).optional() }).parse(req.body);
    const text = await g.drive.readPickedDoc(fileId);
    rememberFile(db, fileId, name ?? "Picked document", MIME.doc, "picked");
    return { text };
  });

  // ── Files she hands Kith, and proposals waiting for her yes ─────────────────────────────
  const PICKABLE = [MIME.doc, MIME.sheet, MIME.slides];
  app.post("/api/google/picked", { preHandler: child }, async (req, reply) => {
    if (!g?.ready()) return reply.code(409).send({ error: "Google isn't connected." });
    const b = z.object({ fileId: z.string().regex(/^[a-zA-Z0-9_-]{10,100}$/), name: z.string().max(200), mimeType: z.string(), coursework: z.boolean().default(false) }).parse(req.body);
    if (!PICKABLE.includes(b.mimeType)) return reply.code(400).send({ error: "Pick a Google Doc, Sheet or Slides file." });
    // drive.file: Google itself only lets Kith open a file she really picked, so a made-up id gets nowhere.
    rememberFile(db, b.fileId, b.name, b.mimeType, "picked");
    if (b.coursework) setCoursework(db, b.fileId, true);
    gLog(db, "picked_file", "look", b.name, b.coursework ? "handed to Kith (coursework: read only)" : "handed to Kith");
    return { ok: true };
  });
  app.get("/api/google/files", { preHandler: either }, async () => ({ files: listFiles(db) }));
  // Marking something as coursework is one-way for the child (the coursework rule wins); only the parent can undo it.
  app.post("/api/google/files/:id/coursework", { preHandler: either }, async (req, reply) => {
    const { coursework } = z.object({ coursework: z.boolean() }).parse(req.body);
    if (!coursework && req.user!.role !== "parent") return reply.code(403).send({ error: "Only your grown-up can take the coursework mark off." });
    setCoursework(db, (req.params as { id: string }).id, coursework);
    return { ok: true };
  });
  app.get("/api/google/pending", { preHandler: child }, async () => ({ pending: pendingList(db) }));
  app.post("/api/google/actions/:id/apply", { preHandler: child, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!g?.ready()) return reply.code(409).send({ error: "Google isn't connected and switched on." });
    const r = await apply(db, g.drive, Number((req.params as { id: string }).id));
    return r.ok ? r : reply.code(409).send({ error: r.message });
  });
  app.post("/api/google/actions/:id/decline", { preHandler: child }, async (req) => ({ ok: decline(db, Number((req.params as { id: string }).id)) }));
}
