import path from "node:path";
import fs from "node:fs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import crypto from "node:crypto";
import { loadParentSettings } from "./settings.js";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { AnthropicLLM } from "./llm.js";
import { Safety } from "./safety/check.js";
import { makeReporters } from "./reporting/reporter.js";
import { Studio } from "./desk/studio.js";
import { registerAuth } from "./auth.js";
import { registerRoutes } from "./routes.js";
import { childName } from "./auth.js";
import { startScheduler } from "./scheduler.js";
import { DeskClient } from "./desk/deskClient.js";
import { GoogleBackend, Storage } from "./storage/storage.js";
import { registerGoogle } from "./routes-google.js";
import { registerStudy } from "./routes-study.js";

// The Google Picker (choosing a doc to hand to Kith) loads from Google; only allowed when it's set up.
const PICKER = config.google.pickerApiKey && config.google.appId;
const APP_CSP = [
  "default-src 'self'",
  PICKER ? "script-src 'self' https://apis.google.com" : "script-src 'self'",
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

async function main() {
  if (!config.desk.token) throw new Error("KITH_DESK_TOKEN must be set (the shared secret between Kith and the desk).");
  if (config.devLogin) console.warn("⚠️  KITH_DEV_LOGIN is on: anyone who can reach this server can sign in. Local testing only.");
  if (!config.oidc.issuer && !config.devLogin) console.warn("Sign-in isn't configured (KITH_OIDC_ISSUER); nobody can sign in yet.");
  if (!config.anthropic.apiKey) console.warn("No ANTHROPIC_API_KEY: the companion will say it isn't switched on yet. Everything else works.");

  const db = openDb(path.join(config.dataDir, "kith.sqlite"));
  const llm = new AnthropicLLM(db, config.anthropic.apiKey);
  const safety = new Safety(llm);
  const reporters = makeReporters();
  const storage = new Storage(db, [new GoogleBackend(db)]);
  const studio = new Studio(db, llm, safety, new DeskClient(), storage);
  studio.resume();

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: true, bodyLimit: 2_000_000 });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 16000 * 2 * 120 }, (_req, body, done) => done(null, body));

  app.addHook("onSend", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
    if (!reply.getHeader("Content-Security-Policy")) reply.header("Content-Security-Policy", APP_CSP);
  });

  app.setErrorHandler((err: Error, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "That doesn't look right.", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? "Something went wrong." : err.message });
  });

  app.get("/api/public/health", async () => ({ ok: true }));
  // The egress proxy asks for the desk browser's safe list here (shared token; not a user API).
  app.get("/internal/egress", async (req, reply) => {
    const got = Buffer.from(req.headers.authorization ?? "");
    const want = Buffer.from(`Bearer ${config.desk.token}`);
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return reply.code(401).send({ error: "unauthorised" });
    const b = loadParentSettings(db).browser;
    return { enabled: b.enabled, hosts: [...b.sites, ...b.assetHosts] };
  });
  app.get("/api/public/signin", async () => ({ oidc: Boolean(config.oidc.issuer), label: config.oidc.label, dev: config.devLogin }));

  registerAuth(app, db);
  registerRoutes(app, { db, llm, safety, reporters, studio });
  registerGoogle(app, db, storage, studio);
  registerStudy(app, { db, llm, safety, storage });

  const clientDir = path.resolve(config.clientDir);
  if (fs.existsSync(clientDir)) {
    await app.register(fastifyStatic, {
      root: clientDir, wildcard: false, index: false,
      // Built assets have hashed names; everything else (sw.js, manifest, index) is re-checked.
      setHeaders: (res, p) => res.header("Cache-Control", p.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache"),
    });
    const indexHtml = fs.readFileSync(path.join(clientDir, "index.html"));
    app.get("/*", (req, reply) => {
      const p = path.join(clientDir, path.normalize(req.url.split("?")[0]).replace(/^(\.\.[/\\])+/, ""));
      if (p.startsWith(clientDir) && fs.existsSync(p) && fs.statSync(p).isFile()) return reply.sendFile(path.relative(clientDir, p));
      if (req.url.startsWith("/api/") || req.url.startsWith("/auth/")) return reply.code(404).send({ error: "not found" });
      return reply.type("text/html").header("Cache-Control", "no-cache").send(indexHtml);
    });
  } else {
    app.log.warn(`No built client at ${clientDir}; API only.`);
  }

  startScheduler({ db, llm, safety, reporters, childName: childName(db) });
  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
