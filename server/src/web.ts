// Serving the built client: the app, the public pages (real HTML for search engines), the error
// pages, and which of them crawlers may index. Kept apart from index.ts so it can be tested.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** For everything that isn't a public page or a public asset: no indexing, and no AI use. */
export const NOINDEX = "noindex, nofollow, noarchive, noai, noimageai";
export const INDEX = "index, follow";

/**
 * How this Kith shows itself to the web. `publicSite` (KITH_PUBLIC_SITE) is off by default: a
 * family's own Kith is the app and nothing else, so "/" is its sign-in and nothing may be indexed.
 * `publicUrl` (KITH_PUBLIC_URL) is the address the public pages' canonical, og:url, JSON-LD and
 * sitemap point at, filled in when they're served.
 */
export interface WebOptions { publicSite: boolean; publicUrl: string }

/** The address the public pages are written with in client/; replaced by KITH_PUBLIC_URL when served. */
export const SOURCE_ORIGIN = "https://ai.hearthstream.xyz";

/** Points a built page (or robots.txt, sitemap.xml, llms.txt) at this Kith's own address. */
export function withOrigin(body: string, publicUrl: string): string {
  return body.split(SOURCE_ORIGIN).join(publicUrl.replace(/\/+$/, ""));
}

/** robots.txt when the public site is off: nothing here is for crawlers. */
export const PRIVATE_ROBOTS = "User-agent: *\nDisallow: /\n";

/** Files Kith fills in when it serves them, rather than sending them straight from the folder. */
const TEMPLATED_FILES = ["robots.txt", "sitemap.xml", "llms.txt"];

/** The CSP hashes of a page's inline scripts (JSON-LD isn't run, so it needs none). */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? "";
    if (/\ssrc=/i.test(attrs) || /type=["']?application\/ld\+json/i.test(attrs) || !m[2].trim()) continue;
    out.push(`'sha256-${crypto.createHash("sha256").update(m[2]).digest("base64")}'`);
  }
  return out;
}

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
 * the desk and everything else say noindex (and no AI use). Public assets are left alone. Without
 * the public site (KITH_PUBLIC_SITE off), every response says noindex.
 */
export function registerRobotsHeader(app: FastifyInstance, opts: Pick<WebOptions, "publicSite"> = { publicSite: true }) {
  app.addHook("onSend", async (req, reply) => {
    if (!opts.publicSite) { reply.header("X-Robots-Tag", NOINDEX); return; }
    if (reply.getHeader("X-Robots-Tag")) return;
    if (isPublicAsset(req.url.split("?")[0])) return;
    reply.header("X-Robots-Tag", NOINDEX);
  });
}

/**
 * Registers the built client. `signedIn` says whether the request has a session ("/" differs).
 * `csp` gives the Content-Security-Policy for a public page with inline scripts (their hashes added).
 */
export async function registerWeb(
  app: FastifyInstance, clientDir: string, signedIn: (req: FastifyRequest) => boolean,
  opts: WebOptions & { csp?: (scriptHashes: string[]) => string } = { publicSite: true, publicUrl: SOURCE_ORIGIN },
): Promise<Web | null> {
  if (!fs.existsSync(clientDir)) return null;
  await app.register(fastifyStatic, {
    root: clientDir, wildcard: false, index: false, globIgnore: TEMPLATED_FILES,
    // Built assets have hashed names; everything else (sw.js, manifest, index) is re-checked.
    setHeaders: (res, p) => res.header("Cache-Control", p.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache"),
  });
  const read = (rel: string) => { const f = path.join(clientDir, rel); return fs.existsSync(f) ? fs.readFileSync(f) : null; };
  // A public page, pointed at this Kith's own address. Without the public site it says noindex too.
  type Page = { html: Buffer; csp: string | null };
  const page = (rel: string): Page | null => {
    const b = read(rel);
    if (!b) return null;
    let html = withOrigin(b.toString("utf8"), opts.publicUrl);
    if (!opts.publicSite) html = html.replace(/<meta name="robots" content="[^"]*"/g, `<meta name="robots" content="${NOINDEX}"`);
    const hashes = inlineScriptHashes(html);
    return { html: Buffer.from(html), csp: hashes.length && opts.csp ? opts.csp(hashes) : null };
  };
  const indexHtml = read("index.html") ?? Buffer.from("<!doctype html><title>Kith</title>");
  const welcome = page("welcome.html");
  const errors: Record<ErrorKind, Buffer | null> = { 403: read("errors/403.html"), 404: read("errors/404.html"), 500: read("errors/500.html"), 503: read("errors/503.html") };
  const web: Web = { errorPage: (status) => errors[errorKind(status)] };

  const sendApp = (reply: FastifyReply) => reply.type("text/html").header("Cache-Control", "no-cache").header("Vary", "Cookie").header("X-Robots-Tag", NOINDEX).send(indexHtml);
  const sendPublic = (reply: FastifyReply, p: Page) => {
    if (p.csp) reply.header("Content-Security-Policy", p.csp);
    return reply.type("text/html").header("Cache-Control", "no-cache").header("Vary", "Cookie").header("X-Robots-Tag", opts.publicSite ? INDEX : NOINDEX).send(p.html);
  };

  // "/" is the welcome page for a visitor (only with the public site on). Anyone signed in, an
  // installed app (?app=) and a sign-in result (?signin=, from older links) get the app.
  app.get("/", (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const appish = q.signin !== undefined || q.app !== undefined;
    return opts.publicSite && welcome && !appish && !signedIn(req) ? sendPublic(reply, welcome) : sendApp(reply);
  });
  for (const name of PUBLIC_PAGES) {
    const p = page(`${name}.html`);
    if (p) app.get(`/${name}`, (_req, reply) => sendPublic(reply, p));
  }

  // robots.txt, sitemap.xml and llms.txt, pointed at this Kith's address. Without the public site,
  // robots.txt turns everyone away and there's no sitemap or llms.txt.
  const text = (rel: string) => { const b = read(rel); return b ? withOrigin(b.toString("utf8"), opts.publicUrl) : null; };
  const robots = opts.publicSite ? text("robots.txt") ?? PRIVATE_ROBOTS : PRIVATE_ROBOTS;
  app.get("/robots.txt", (_req, reply) => reply.type("text/plain; charset=utf-8").header("Cache-Control", "no-cache").send(robots));
  for (const [rel, type] of [["sitemap.xml", "application/xml; charset=utf-8"], ["llms.txt", "text/plain; charset=utf-8"]] as const) {
    const body = opts.publicSite ? text(rel) : null;
    if (body) app.get(`/${rel}`, (_req, reply) => reply.type(type).header("Cache-Control", "no-cache").send(body));
  }

  app.get("/*", (req, reply) => {
    const pathname = req.url.split("?")[0];
    let decoded = pathname;
    try { decoded = decodeURIComponent(pathname); } catch { /* a malformed address: use it as it is */ }
    const p = path.join(clientDir, path.normalize(decoded).replace(/^(\.\.[/\\])+/, ""));
    const rel = path.relative(clientDir, p);
    if (!TEMPLATED_FILES.includes(rel) && p.startsWith(clientDir + path.sep) && fs.existsSync(p) && fs.statSync(p).isFile()) return reply.sendFile(rel);
    if (isApi(req.url)) return reply.code(404).send({ error: "not found" });
    if (isAppRoute(pathname)) return sendApp(reply);
    // Anything else a browser asks for is a page that doesn't exist; other requests get a plain 404.
    if (sendErrorPage(web, req, reply, 404)) return reply;
    return reply.code(404).type("text/plain").send("Not found");
  });
  return web;
}
