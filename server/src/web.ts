// Serving the built client: the app, the public pages (real HTML for search engines), the error
// pages, and which of them crawlers may index. Kept apart from index.ts so it can be tested.

import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** For everything that isn't a public page or a public asset: no indexing, and no AI use. */
export const NOINDEX = "noindex, nofollow, noarchive, noai, noimageai";
export const INDEX = "index, follow";

/** The app's own client routes (client/src/App.tsx and the parent view), which always get the app. */
export const APP_ROUTES = [
  "/", "/signin", "/parent", "/talk", "/study", "/languages", "/create", "/stories", "/art", "/oc",
  "/settings", "/you", "/me", "/memory", "/shared", "/google", "/notifications", "/connectors", "/help",
  "/desk", "/lab", "/pip",
];
export function isAppRoute(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return APP_ROUTES.includes(p) || p.startsWith("/pip/");
}

/** Public pages at clean paths ("/" is the welcome page only for someone who isn't signed in). */
export const PUBLIC_PAGES = ["parents", "terms", "privacy", "setup"] as const;

/** Files anyone (and any crawler) may fetch: what the public pages are built from. */
const PUBLIC_FILES = new Set(["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/maskable-512.png", "/robots.txt", "/sitemap.xml", "/llms.txt"]);
export function isPublicAsset(pathname: string): boolean {
  return pathname.startsWith("/assets/") || pathname.startsWith("/welcome/") || PUBLIC_FILES.has(pathname);
}

/** A browser asking for a page (not fetch() asking for JSON). */
export function wantsHtml(req: FastifyRequest): boolean {
  const accept = String(req.headers.accept ?? "");
  return accept.includes("text/html");
}
const isApi = (url: string) => url.startsWith("/api/") || url.startsWith("/auth/") || url.startsWith("/internal/");

export type ErrorKind = 403 | 404 | 500 | 503;
export interface Web { errorPage: (status: number) => Buffer | null }

/** The error page for a status: 403, 404, 502/503/504 (the nap page) or 500 for anything else. */
export function errorKind(status: number): ErrorKind {
  if (status === 403 || status === 404) return status;
  if (status === 502 || status === 503 || status === 504) return 503;
  return 500;
}

/** Serves an error page for a browser's page request. Returns false for API calls and fetches, which stay JSON. */
export function sendErrorPage(web: Web | null, req: FastifyRequest, reply: FastifyReply, status: number): boolean {
  if (!web || isApi(req.url) || !wantsHtml(req)) return false;
  const html = web.errorPage(status);
  if (!html) return false;
  void reply.code(status).type("text/html").header("Cache-Control", "no-store").header("X-Robots-Tag", NOINDEX).send(html);
  return true;
}

/**
 * Every response says whether it may be indexed: public pages say index, the app, sign-in, the API,
 * the desk and everything else say noindex (and no AI use). Public assets are left alone.
 */
export function registerRobotsHeader(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply) => {
    if (reply.getHeader("X-Robots-Tag")) return;
    if (isPublicAsset(req.url.split("?")[0])) return;
    reply.header("X-Robots-Tag", NOINDEX);
  });
}

/** Registers the built client. `signedIn` says whether the request has a session ("/" differs). */
export async function registerWeb(app: FastifyInstance, clientDir: string, signedIn: (req: FastifyRequest) => boolean): Promise<Web | null> {
  if (!fs.existsSync(clientDir)) return null;
  await app.register(fastifyStatic, {
    root: clientDir, wildcard: false, index: false,
    // Built assets have hashed names; everything else (sw.js, manifest, index) is re-checked.
    setHeaders: (res, p) => res.header("Cache-Control", p.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache"),
  });
  const read = (rel: string) => { const f = path.join(clientDir, rel); return fs.existsSync(f) ? fs.readFileSync(f) : null; };
  const indexHtml = read("index.html") ?? Buffer.from("<!doctype html><title>Kith</title>");
  const welcomeHtml = read("welcome.html");
  const errors: Record<ErrorKind, Buffer | null> = { 403: read("errors/403.html"), 404: read("errors/404.html"), 500: read("errors/500.html"), 503: read("errors/503.html") };
  const web: Web = { errorPage: (status) => errors[errorKind(status)] };

  const sendApp = (reply: FastifyReply) => reply.type("text/html").header("Cache-Control", "no-cache").header("Vary", "Cookie").header("X-Robots-Tag", NOINDEX).send(indexHtml);
  const sendPublic = (reply: FastifyReply, html: Buffer) => reply.type("text/html").header("Cache-Control", "no-cache").header("Vary", "Cookie").header("X-Robots-Tag", INDEX).send(html);

  // "/" is the welcome page for anyone who isn't signed in, and the app for anyone who is.
  app.get("/", (req, reply) => (!signedIn(req) && welcomeHtml ? sendPublic(reply, welcomeHtml) : sendApp(reply)));
  for (const name of PUBLIC_PAGES) {
    const html = read(`${name}.html`);
    if (html) app.get(`/${name}`, (_req, reply) => sendPublic(reply, html));
  }
  app.get("/*", (req, reply) => {
    const pathname = req.url.split("?")[0];
    let decoded = pathname;
    try { decoded = decodeURIComponent(pathname); } catch { /* a malformed address: use it as it is */ }
    const p = path.join(clientDir, path.normalize(decoded).replace(/^(\.\.[/\\])+/, ""));
    if (p.startsWith(clientDir + path.sep) && fs.existsSync(p) && fs.statSync(p).isFile()) return reply.sendFile(path.relative(clientDir, p));
    if (isApi(req.url)) return reply.code(404).send({ error: "not found" });
    if (isAppRoute(pathname)) return sendApp(reply);
    // Anything else a browser asks for is a page that doesn't exist; other requests get a plain 404.
    if (sendErrorPage(web, req, reply, 404)) return reply;
    return reply.code(404).type("text/plain").send("Not found");
  });
  return web;
}
