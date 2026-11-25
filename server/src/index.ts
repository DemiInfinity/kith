import { manifestFor } from "./manifest.js";
import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import crypto from "node:crypto";
import { loadParentSettings } from "./settings.js";
import { config } from "./config.js";
import { openDb, get } from "./db.js";
import { AnthropicLLM } from "./llm.js";
import { Safety } from "./safety/check.js";
import { makeReporters } from "./reporting/reporter.js";
import { Studio } from "./desk/studio.js";
import { currentKey } from "./apikey.js";
import { sessionFor, registerAuth, rateLimitKey } from "./auth.js";
import { reqSerializer } from "./logging.js";
import { registerRobotsHeader, registerWeb, sendErrorPage, type Web } from "./web.js";
import { registerRoutes } from "./routes.js";
import { childName } from "./auth.js";
import { schedulerHealthy, startScheduler } from "./scheduler.js";
import { DeskClient } from "./desk/deskClient.js";
import { GoogleBackend, Storage } from "./storage/storage.js";
import { registerGoogle } from "./routes-google.js";
import { registerStudy } from "./routes-study.js";
import { registerNative } from "./native.js";

// The Google Picker (choosing a doc to hand to Kith) loads from Google; only allowed when it's set up.
// (With the shared Kith Connect helper, the Picker key comes from the helper.)
const PICKER = (config.google.pickerApiKey && config.google.appId) || (config.google.connectUrl && !(config.google.clientId && config.google.clientSecret));
/** The app's Content-Security-Policy; a public page with an inline script adds that script's hash. */
const appCsp = (scriptHashes: string[] = []) => [
  "default-src 'self'",
  ["script-src 'self'", ...(PICKER ? ["https://apis.google.com"] : []), ...scriptHashes].join(" "),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  PICKER ? "connect-src 'self' https://*.googleapis.com" : "connect-src 'self'",
  PICKER ? "frame-src 'self' https://docs.google.com https://drive.google.com https://accounts.google.com" : "frame-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");
const APP_CSP = appCsp();

/** How long a stop (docker compose down, an upgrade) waits for requests in flight. */
const SHUTDOWN_GRACE_MS = 8_000;

async function main() {
  if (!config.desk.token) throw new Error("KITH_DESK_TOKEN must be set (the shared secret between Kith and the desk).");
  if (config.devLogin) console.warn("⚠️  KITH_DEV_LOGIN is on: anyone who can reach this server can sign in. Local testing only.");
  if (!config.oidc.issuer && !config.devLogin) console.warn("Sign-in isn't configured (KITH_OIDC_ISSUER); nobody can sign in yet.");
  const db = openDb(path.join(config.dataDir, "kith.sqlite"));
  const key = currentKey(db);
  if (!key.key) console.warn("No Anthropic API key yet (set it in the parent view, or ANTHROPIC_API_KEY): the companion will say it isn't switched on yet. Everything else works.");
  const llm = new AnthropicLLM(db, key.key);
  const safety = new Safety(llm);
  const reporters = makeReporters(config.reporting.reporters, db);
  const storage = new Storage(db, [new GoogleBackend(db)]);
  const studio = new Studio(db, llm, safety, new DeskClient(), storage);
  studio.resume();

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info", serializers: { req: reqSerializer as never } },
    // Trust X-Forwarded-For from this many proxies in front (what a number does at runtime; the
    // types only take a function).
    trustProxy: (_addr: string, hop: number) => hop < config.trustProxy,
    bodyLimit: 2_000_000,
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute", keyGenerator: rateLimitKey(db) });
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 16000 * 2 * 120 }, (_req, body, done) => done(null, body));

  app.addHook("onSend", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin"); // only the site address, never a page path (Google checks it for the Picker key)
    reply.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
    if (!reply.getHeader("Content-Security-Policy")) reply.header("Content-Security-Policy", APP_CSP);
  });

  // Set once the built client is registered (below); until then errors are JSON only.
  let web: Web | null = null;
  registerRobotsHeader(app, { publicSite: config.publicSite });

  app.setErrorHandler((err: Error, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "That doesn't look right.", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    // A browser asking for a page gets a friendly page; API calls stay JSON.
    if (status >= 500 && sendErrorPage(web, req, reply, status)) return reply;
    return reply.code(status).send({ error: status >= 500 ? "Something went wrong." : err.message });
  });

  // The container's health check: the database answers and the scheduler has ticked recently.
  app.get("/api/public/health", async (_req, reply) => {
    let dbOk = false;
    try { dbOk = get<{ ok: number }>(db, "SELECT 1 AS ok")?.ok === 1; } catch { /* not ok */ }
    const ok = dbOk && schedulerHealthy();
    return reply.code(ok ? 200 : 503).send({ ok });
  });
  // The egress proxy asks for the desk browser's rules here (shared token; not a user API).
  app.get("/internal/egress", async (req, reply) => {
    const got = Buffer.from(req.headers.authorization ?? "");
    const want = Buffer.from(`Bearer ${config.desk.token}`);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return reply.code(401).send({ error: "unauthorised" });
    const b = loadParentSettings(db).browser;
    const r = studio.browser.deskRules(b);
    return { enabled: b.enabled, mode: b.mode, hosts: [...b.sites, ...b.assetHosts], blocked: r.blocked, words: r.words, listVersion: studio.browser.lists.version };
  });
  // The big public block list, as plain text (one domain a line), fetched by the proxy when it changes.
  app.get("/internal/egress/list", async (req, reply) => {
    const got = Buffer.from(req.headers.authorization ?? "");
    const want = Buffer.from(`Bearer ${config.desk.token}`);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return reply.code(401).send({ error: "unauthorised" });
    const b = loadParentSettings(db).browser;
    studio.browser.rules(b);
    const own = new Set(b.sites.map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "")));
    reply.header("content-type", "text/plain; charset=utf-8");
    return [...studio.browser.lists.domains()].filter((d) => !own.has(d)).join("\n");
  });
  app.get("/api/public/signin", async () => ({ oidc: Boolean(config.oidc.issuer), label: config.oidc.label, dev: config.devLogin }));

  registerAuth(app, db);
  // The manifest depends on who's signed in ("Kith Parent" for the parent), so it's served here.
  app.get("/manifest.webmanifest", async (req, reply) => {
    const user = sessionFor(db, req.cookies.kith_sid);
    reply.header("Content-Type", "application/manifest+json; charset=utf-8").header("Cache-Control", "no-store").header("Vary", "Cookie");
    return manifestFor(user?.role ?? null);
  });
  registerRoutes(app, { db, llm, safety, reporters, studio });
  registerGoogle(app, db, storage, studio);
  registerStudy(app, { db, llm, safety, storage });
  registerNative(app, db);

  web = await registerWeb(app, path.resolve(config.clientDir), (req) => Boolean(sessionFor(db, req.cookies?.kith_sid)), {
    publicSite: config.publicSite, publicUrl: config.publicUrl, csp: appCsp,
  });
  if (!web) app.log.warn(`No built client at ${path.resolve(config.clientDir)}; API only.`);


  const scheduler = startScheduler({ db, llm, safety, reporters, childName: childName(db), studio });
  await app.listen({ port: config.port, host: config.host });

  // Stopping (SIGTERM from Docker): no new ticks, let requests in flight finish (up to 8 seconds),
  // then close the database cleanly. Desk jobs that were mid-way resume on the next start.
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info(`${signal}: stopping`);
    const force = setTimeout(() => { app.log.warn("Stopping took too long; exiting."); process.exit(1); }, SHUTDOWN_GRACE_MS + 2_000);
    force.unref();
    await Promise.race([
      Promise.allSettled([scheduler.stop(), app.close()]),
      new Promise((r) => setTimeout(r, SHUTDOWN_GRACE_MS).unref()),
    ]);
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  };
  process.once("SIGTERM", () => void stop("SIGTERM"));
  process.once("SIGINT", () => void stop("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
