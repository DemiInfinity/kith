import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APP_ROUTES, INDEX, isAppRoute, NOINDEX, registerRobotsHeader, registerWeb, sendErrorPage, type Web } from "../src/web.js";

// A small built client: the pages the server serves, each saying what it is.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kith-web-"));
const files: Record<string, string> = {
  "index.html": "APP", "welcome.html": "WELCOME", "parents.html": "PARENTS", "terms.html": "TERMS", "privacy.html": "PRIVACY", "setup.html": "SETUP",
  "errors/403.html": "E403", "errors/404.html": "E404", "errors/500.html": "E500", "errors/503.html": "E503", "errors/kith-down.html": "DOWN",
  "assets/app-123.js": "js", "welcome/og.png": "png", "robots.txt": "robots", "llms.txt": "llms", "sw.js": "sw",
};
for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }

const app = Fastify();
let web: Web | null = null;
const HTML = { accept: "text/html,application/xhtml+xml" };
beforeAll(async () => {
  registerRobotsHeader(app);
  app.setErrorHandler((err: Error, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500 && sendErrorPage(web, req, reply, status)) return reply;
    return reply.code(status).send({ error: status >= 500 ? "Something went wrong." : err.message });
  });
  app.get("/api/boom", async () => { throw new Error("boom"); });
  app.get("/api/me", async () => ({ ok: true }));
  app.get("/broken", async () => { throw new Error("boom"); });
  web = await registerWeb(app, dir, (req) => req.headers.cookie === "kith_sid=yes");
  await app.ready();
});
afterAll(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers });

describe("pages and the app", () => {
  it("/ is the welcome page for a visitor and the app for someone signed in", async () => {
    const visitor = await get("/", HTML);
    expect(visitor.body).toBe("WELCOME");
    expect(visitor.headers["x-robots-tag"]).toBe(INDEX);
    const member = await get("/", { ...HTML, cookie: "kith_sid=yes" });
    expect(member.body).toBe("APP");
    expect(member.headers["x-robots-tag"]).toBe(NOINDEX);
  });
  it("the public pages are indexable", async () => {
    for (const [p, body] of [["/parents", "PARENTS"], ["/terms", "TERMS"], ["/privacy", "PRIVACY"], ["/setup", "SETUP"]]) {
      const r = await get(p, HTML);
      expect(r.statusCode).toBe(200);
      expect(r.body).toBe(body);
      expect(r.headers["x-robots-tag"]).toBe(INDEX);
    }
  });
  it("every client route gets the app, never indexed", async () => {
    for (const p of [...APP_ROUTES.filter((x) => x !== "/"), "/pip/scheduled", "/signin?app=child", "/talk/"]) {
      const r = await get(p, HTML);
      expect(r.statusCode, p).toBe(200);
      expect(r.body, p).toBe("APP");
      expect(r.headers["x-robots-tag"], p).toBe(NOINDEX);
    }
  });
  it("an unknown page is the 404 page for a browser, and a plain 404 otherwise", async () => {
    const r = await get("/no-such-page", HTML);
    expect(r.statusCode).toBe(404);
    expect(r.body).toBe("E404");
    expect(r.headers["x-robots-tag"]).toBe(NOINDEX);
    const asset = await get("/assets/missing.js", { accept: "*/*" });
    expect(asset.statusCode).toBe(404);
    expect(asset.body).not.toBe("APP");
  });
  it("API and sign-in addresses stay JSON, even from a browser", async () => {
    const r = await get("/api/nothing", HTML);
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "not found" });
    expect(r.headers["x-robots-tag"]).toBe(NOINDEX);
    const a = await get("/auth/nothing", HTML);
    expect(a.json()).toEqual({ error: "not found" });
    const ok = await get("/api/me");
    expect(ok.headers["x-robots-tag"]).toBe(NOINDEX);
  });
  it("a crash is the 500 page for a page request, and JSON for the API", async () => {
    const page = await get("/broken", HTML);
    expect(page.statusCode).toBe(500);
    expect(page.body).toBe("E500");
    expect(page.headers["x-robots-tag"]).toBe(NOINDEX);
    const api = await get("/api/boom", HTML);
    expect(api.statusCode).toBe(500);
    expect(api.json()).toEqual({ error: "Something went wrong." });
    const fetchy = await get("/broken", { accept: "application/json" });
    expect(fetchy.json()).toEqual({ error: "Something went wrong." });
  });
  it("public assets carry no robots header; other files are noindex", async () => {
    for (const p of ["/assets/app-123.js", "/welcome/og.png", "/robots.txt", "/llms.txt"]) {
      const r = await get(p);
      expect(r.statusCode, p).toBe(200);
      expect(r.headers["x-robots-tag"], p).toBeUndefined();
    }
    for (const p of ["/sw.js", "/errors/kith-down.html", "/welcome.html"]) {
      const r = await get(p);
      expect(r.statusCode, p).toBe(200);
      expect(r.headers["x-robots-tag"], p).toBe(NOINDEX);
    }
  });
  it("can't be talked out of the client folder", async () => {
    const r = await get("/..%2f..%2fetc%2fpasswd", HTML);
    expect(r.statusCode).toBe(404);
  });
});

describe("the app's routes", () => {
  it("cover every screen the client router knows", () => {
    // Every path App.tsx matches or navigates to must be in APP_ROUTES, or the server would 404 it.
    const src = fs.readFileSync(path.resolve(import.meta.dirname, "../../client/src/App.tsx"), "utf8");
    const seen = new Set([...src.matchAll(/path === "(\/[a-z/-]*)"/g), ...src.matchAll(/go\("(\/[a-z/-]*)"\)/g)].map((m) => m[1]));
    expect(seen.size).toBeGreaterThan(10);
    for (const p of seen) expect(isAppRoute(p), p).toBe(true);
    // The parent view lives at /parent (where sign-in sends a grown-up).
    expect(isAppRoute("/parent")).toBe(true);
    expect(isAppRoute("/parents")).toBe(false);
  });
});
