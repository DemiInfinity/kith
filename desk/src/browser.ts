// Pip's browser: a real Chromium (Playwright) with tabs and its own saved storage (cookies, site
// data), kept in the desk's volume so sites remember their settings. The parent can clear it.
// - All traffic goes through the egress proxy, which applies the family's block list (with the big
//   public list on top). The same rules are checked here for every request.
// - JavaScript is on, so sites work properly. Pip itself only reads: it never types, never sends
//   forms, and stops at robot checks (CAPTCHAs, "are you human?") without trying to get past them.
// - People can take over: they click, scroll, type and use tabs. Signing in isn't allowed: password
//   fields can't be typed into and anything sent with a password in it is blocked.
// - No downloads, no uploads, no notifications, camera, microphone or location.
// - What Pip reads is returned as data for the Kith server to check; nothing on a page can tell
//   the desk to do anything.

import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page, Request, Route } from "playwright-core";
import { looksLikeRobotCheck, pageAllowed, resourceAllowed, type BrowseRules } from "./rules.js";
import { homePage } from "./home.js";
import { clearBrowserCaches } from "./disk.js";

export interface Visit { url: string; title: string; text: string; why: string; jobId: number | null; ts: number }
/** A standard 16:9 desktop. */
export const VIEW = { width: 1280, height: 720 };
const MAX_TABS = 8;
const IDLE_MINUTES = Math.max(1, Number(process.env.DESK_BROWSER_IDLE_MINUTES ?? 2));
const PROFILE = path.join(process.env.DESK_DIR ?? "./desk-data", "browser");

export interface TabInfo { title: string; url: string }
export interface Live {
  busy: boolean; url: string; title: string; why: string; jobId: number | null; ts: number; frame: string;
  cursor: { x: number; y: number }; robotCheck?: boolean; signIn?: boolean; tabs: TabInfo[]; active: number;
}

let live: Live = { busy: false, url: "", title: "", why: "", jobId: null, ts: 0, frame: "", cursor: { x: VIEW.width / 2, y: VIEW.height / 2 }, tabs: [], active: 0 };
export const liveView = () => live;

type PW = typeof import("playwright-core");
let pw: Promise<PW> | null = null;
const load = () => (pw ??= import("playwright-core"));

// ── One browser, kept between visits ────────────────────────────────────────────────────────

let ctx: BrowserContext | null = null;
let starting: Promise<BrowserContext> | null = null;
let rules: BrowseRules = { mode: "blocklist", sites: [], assetHosts: [] };
let driver: string | null = null; // who has taken over, if anyone
let companion = "Pip";

/** Shows the homepage in a tab. */
async function goHome(p: Page) {
  await p.setContent(homePage({ name: companion, sites: rules.sites, mode: rules.mode }), { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await p.focus("input[name=q]").catch(() => undefined); // ready to type a search
}
let tabs: Page[] = [];
let active = 0;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

/** Anything sent with a password in it (a sign-in) is blocked. */
export function looksLikeSignIn(body: string | null): boolean {
  return !!body && /(^|[&"{,\s])"?(pass(word|wd)?|pwd|passcode|pin)"?\s*[=:]/i.test(body);
}

function onRequest(route: Route, r: Request) {
  const method = r.method();
  if (!resourceAllowed(r.url(), r.resourceType(), method, rules)) return route.abort("blockedbyclient");
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    // Pip never sends anything. People who take over can use search boxes and site buttons, but not sign in.
    if (!driver) return route.abort("blockedbyclient");
    if (looksLikeSignIn(r.postData())) return route.abort("blockedbyclient");
  }
  return route.continue();
}

async function context(): Promise<BrowserContext> {
  if (ctx) return ctx;
  if (starting) return starting;
  starting = (async () => {
    const { chromium } = await load();
    fs.mkdirSync(PROFILE, { recursive: true });
    const c = await chromium.launchPersistentContext(PROFILE, {
      headless: true,
      proxy: { server: process.env.DESK_EGRESS_PROXY ?? "http://egress:3128" },
      args: ["--disable-extensions", "--disable-sync", "--no-first-run", "--disable-background-networking", "--deny-permission-prompts"],
      javaScriptEnabled: true, acceptDownloads: false, serviceWorkers: "block", viewport: VIEW, locale: "en-GB",
      permissions: [],
    });
    await c.route("**/*", onRequest);
    // SafeSearch strict on Bing, for every search, even if a page drops the setting from the link.
    await c.addCookies([{ name: "SRCHHPGUSR", value: "ADLT=STRICT", domain: ".bing.com", path: "/", secure: true }]).catch(() => undefined);
    c.on("page", (p) => adopt(p));
    for (const p of c.pages()) await p.close().catch(() => undefined);
    tabs = [];
    ctx = c;
    c.on("close", () => { ctx = null; tabs = []; });
    return c;
  })();
  try { return await starting; } finally { starting = null; }
}

/** New tabs (including ones a page opens) join the strip and become the active tab. */
function adopt(p: Page) {
  if (tabs.includes(p)) return;
  p.on("filechooser", () => undefined); // never pick or upload files
  p.on("dialog", (d) => void d.dismiss().catch(() => undefined));
  p.on("close", () => {
    const i = tabs.indexOf(p);
    if (i >= 0) { tabs.splice(i, 1); if (active >= tabs.length) active = Math.max(0, tabs.length - 1); }
  });
  tabs.push(p);
  // Too many tabs: the oldest go. They're taken off the strip straight away (their close events
  // arrive later, and find nothing left to remove).
  for (const old of capTabs(tabs)) void old.close().catch(() => undefined);
  active = tabs.length - 1;
}

/** Takes the oldest tabs off `list` (in place) so at most `max` stay, and returns the ones removed. */
export function capTabs<T>(list: T[], max = MAX_TABS): T[] {
  return list.length > max ? list.splice(0, list.length - max) : [];
}

async function newTab(): Promise<Page> {
  const c = await context();
  const p = await c.newPage();
  adopt(p);
  return p;
}

function keepAlive() {
  if (closeTimer) clearTimeout(closeTimer);
  // Chromium only runs while it's needed: it shuts after 2 quiet minutes (storage stays on disk, so
  // nothing is lost) and starts again the next time a desk job or a person uses it.
  closeTimer = setTimeout(() => void shutdown(), IDLE_MINUTES * 60_000);
  if (driver) idleRelease();
}
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
function idleRelease() {
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => void release(), 3 * 60_000);
}

async function shutdown() {
  const c = ctx;
  ctx = null; tabs = []; driver = null;
  live = { ...live, busy: false, tabs: [], active: 0 };
  await c?.close().catch(() => undefined);
  // Free the disk: Chromium's caches go (cookies and site data stay).
  try { clearBrowserCaches(PROFILE); } catch { /* fine */ }
}

async function robotCheck(page: Page, status = 200) {
  const title = await page.title().catch(() => "");
  const text = (await page.evaluate("document.body ? document.body.innerText : ''").catch(() => "")) as string;
  return looksLikeRobotCheck(title, text, page.frames().map((f) => f.url()), status);
}
async function asksForPassword(page: Page) {
  return (await page.locator("input[type=password]:visible").count().catch(() => 0)) > 0;
}

async function snap(why: string, extra: Partial<Live> = {}) {
  const page = tabs[active];
  const infos = await Promise.all(tabs.map(async (t) => ({ title: (await t.title().catch(() => "")).slice(0, 80) || "New tab", url: t.url() === "about:blank" ? "" : t.url() })));
  if (!page) {
    live = { ...live, busy: false, url: "", title: "", why, ts: Date.now(), frame: "", tabs: infos, active: 0, ...extra };
    return live;
  }
  const shot = await page.screenshot({ type: "jpeg", quality: 55 }).catch(() => null);
  live = {
    ...live, busy: false, url: page.url() === "about:blank" ? "" : page.url(), title: (await page.title().catch(() => "")).slice(0, 200), why, ts: Date.now(),
    frame: shot ? `data:image/jpeg;base64,${shot.toString("base64")}` : live.frame,
    robotCheck: await robotCheck(page), signIn: await asksForPassword(page), tabs: infos, active, ...extra,
  };
  return live;
}

const blockedMsg = () => (rules.mode === "blocklist" ? "That site is blocked." : "That page isn't on the family's safe list.");

// ── Take over: the child or parent drive the browser themselves ─────────────────────────────
// By default the companion uses its browser on its own and people watch. "Take over" lets a person
// drive (same rules, plus typing, minus sign-ins); the companion waits until it's handed back (or
// 3 minutes idle).

export const takenOver = () => driver;

// While someone drives, the live picture refreshes every second, so pages that finish loading (or
// change on their own) show up for everyone watching without waiting for the next click.
let busyActing = 0;
let refresher: ReturnType<typeof setInterval> | null = null;
function startRefresher() {
  if (refresher) return;
  refresher = setInterval(() => {
    if (!driver || !ctx) { if (refresher) clearInterval(refresher); refresher = null; return; }
    if (busyActing) return;
    void snap(`taken over by ${driver}`).catch(() => undefined);
  }, 1000);
}

export async function takeOver(who: string, r: BrowseRules, startUrl?: string, name?: string) {
  rules = r;
  if (name) companion = name.slice(0, 24);
  await context();
  driver = who;
  keepAlive();
  if (!tabs.length) {
    const p = await newTab();
    if (startUrl && pageAllowed(startUrl, rules)) await p.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
    else await goHome(p);
  } else if (startUrl && pageAllowed(startUrl, rules)) {
    await tabs[active].goto(startUrl, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
  }
  startRefresher();
  return snap(`taken over by ${who}`);
}

export type Action =
  | { type: "go"; url?: string } | { type: "click" | "move"; x?: number; y?: number } | { type: "scroll"; dy?: number }
  | { type: "back" | "forward" | "reload" | "newtab" | "home" } | { type: "tab" | "closetab"; index?: number }
  | { type: "type"; text?: string } | { type: "key"; key?: string };

const KEYS = new Set(["Enter", "Backspace", "Delete", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Space"]);

/** One step while taken over. Navigation to blocked sites is refused here (and by the proxy). */
export async function act(a: Parameters<typeof doAct>[0]) {
  busyActing++;
  try { return await doAct(a); } finally { busyActing--; }
}

async function doAct(a: Action & { x?: number; y?: number; url?: string; dy?: number; index?: number; text?: string; key?: string }) {
  if (!driver) throw new Error("Nobody has taken over the browser.");
  keepAlive();
  const who = driver;
  const clamp = (v: number | undefined, max: number) => Math.max(0, Math.min(max - 1, v ?? 0));
  if (a.type === "move") {
    // Just the pointer, so everyone watching sees it move. No screenshot.
    const x = clamp(a.x, VIEW.width), y = clamp(a.y, VIEW.height);
    live = { ...live, cursor: { x, y }, ts: Date.now() };
    void tabs[active]?.mouse.move(x, y).catch(() => undefined);
    return { ...live, navigated: false };
  }
  if (a.type === "newtab") { await goHome(await newTab()); return { ...(await snap(`taken over by ${who}`)), navigated: false }; }
  if (a.type === "tab") { if (a.index !== undefined && tabs[a.index]) { active = a.index; await tabs[active].bringToFront().catch(() => undefined); } return { ...(await snap(`taken over by ${who}`)), navigated: false }; }
  if (a.type === "closetab") { const t = tabs[a.index ?? active]; if (t) await t.close().catch(() => undefined); return { ...(await snap(`taken over by ${who}`)), navigated: false }; }

  const page = tabs[active] ?? (await newTab());
  const before = page.url();
  if (a.type === "go") {
    if (!a.url || !pageAllowed(a.url, rules)) throw new Error(blockedMsg());
    await page.goto(a.url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
  } else if (a.type === "click") {
    const x = clamp(a.x, VIEW.width), y = clamp(a.y, VIEW.height);
    live = { ...live, cursor: { x, y } };
    await page.mouse.move(x, y, { steps: 6 });
    await page.mouse.click(x, y);
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(300);
  } else if (a.type === "scroll") {
    await page.mouse.wheel(0, Math.max(-2000, Math.min(2000, a.dy ?? 500)));
    await page.waitForTimeout(250);
  } else if (a.type === "back") {
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => undefined);
  } else if (a.type === "forward") {
    await page.goForward({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => undefined);
  } else if (a.type === "home") {
    await goHome(page);
  } else if (a.type === "reload" && (page.url() === "about:blank" || !page.url())) {
    await goHome(page);
  } else if (a.type === "reload") {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
  } else if (a.type === "type" || a.type === "key") {
    const isPassword = await page.evaluate("(() => { const e = document.activeElement; return !!e && e.tagName === 'INPUT' && e.type === 'password'; })()").catch(() => false);
    if (isPassword) throw new Error("Signing in isn't allowed on the desk's browser.");
    if (a.type === "type") await page.keyboard.type(String(a.text ?? "").slice(0, 500), { delay: 15 });
    else if (a.key && KEYS.has(a.key)) {
      await page.keyboard.press(a.key === "Space" ? " " : a.key);
      if (a.key === "Enter") await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
    }
    await page.waitForTimeout(200);
  }
  if (page.url() !== "about:blank" && !pageAllowed(page.url(), rules)) {
    await page.goto(before && before !== "about:blank" ? before : "about:blank", { waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => undefined);
  }
  const l = await snap(`taken over by ${who}`);
  return { ...l, navigated: l.url !== before && !!l.url };
}

export async function release() {
  driver = null;
  if (releaseTimer) clearTimeout(releaseTimer);
  live = { ...live, why: "", busy: false };
}

/** The screen went to sleep: close the browser now if nobody's using it (it starts again on demand). */
export async function sleep(): Promise<boolean> {
  if (driver || live.busy || busyActing || !ctx) return false;
  await shutdown();
  return true;
}

/** Forget everything sites stored (cookies, site data, history) and close every tab. */
export async function clearStorage() {
  await shutdown();
  fs.rmSync(PROFILE, { recursive: true, force: true });
  live = { ...live, frame: "", url: "", title: "", tabs: [], active: 0 };
}

// ── Pip's own reading ───────────────────────────────────────────────────────────────────────

let queue: Promise<unknown> = Promise.resolve();

/** One visit at a time, so the live view always shows the one thing Pip is doing. */
export function browse(url: string, why: string, jobId: number | null, r: BrowseRules): Promise<Visit> {
  if (driver) return Promise.reject(new Error(`The browser is being used by ${driver} right now.`));
  const run = queue.then(() => visit(url, why, jobId, r));
  queue = run.catch(() => undefined);
  return run;
}

async function visit(url: string, why: string, jobId: number | null, r: BrowseRules): Promise<Visit> {
  rules = r;
  if (!pageAllowed(url, rules)) throw new Error(blockedMsg());
  keepAlive();
  // Pip reads in its own tab, which stays open so people can see what it read.
  const page = await newTab();
  live = { ...live, busy: true, url, title: "", why, jobId, ts: Date.now() };
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => undefined);
    const finalUrl = page.url();
    if (!pageAllowed(finalUrl, rules)) throw new Error("That page sent the browser somewhere blocked.");
    if (await robotCheck(page, res?.status() ?? 200)) {
      await snap(why, { jobId, robotCheck: true });
      throw new Error("Robot check: this site wants to know if I'm human, so I stopped here.");
    }
    if (res && !res.ok()) throw new Error(`The page answered ${res.status()}.`);
    const title = (await page.title()).slice(0, 200);
    const text = (await page.evaluate("document.body ? document.body.innerText : ''") as string).replace(/\n{3,}/g, "\n\n").slice(0, 20_000);
    // "Reading": the pointer drifts over the text and the page scrolls a little, so people watching
    // live can see what it's doing. Pip never clicks or types on a page.
    const trail = [{ x: 380, y: 220 }, { x: 640, y: 330 }, { x: 520, y: 470 }];
    for (let i = 0; i < trail.length; i++) {
      await page.mouse.move(trail[i].x, trail[i].y, { steps: 8 });
      if (i > 0) await page.mouse.wheel(0, 420);
      await page.waitForTimeout(350);
      live = { ...live, cursor: trail[i] };
      await snap(why, { busy: i < trail.length - 1, jobId, robotCheck: false });
    }
    return { url: finalUrl, title, text, why, jobId, ts: Date.now() };
  } catch (err) {
    live = { ...live, busy: false };
    throw err;
  }
}
