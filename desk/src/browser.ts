// Pip's browser: headless Chromium (Playwright) that can only read safe-listed pages.
// - All traffic goes through the egress proxy, which enforces the safe list again.
// - Read-only: JavaScript off, downloads off, uploads off, nothing but GET requests.
// - No logins or cookies kept: every visit uses a brand-new, empty browser context.
// - What it reads is returned as data for the Kith server to check; nothing on a page can tell the
//   desk to do anything.

import { pageAllowed, resourceAllowed, type BrowseRules } from "./rules.js";

export interface Visit { url: string; title: string; text: string; why: string; jobId: number | null; ts: number }
/** A standard 16:9 desktop. */
export const VIEW = { width: 1280, height: 720 };

export interface Live { busy: boolean; url: string; title: string; why: string; jobId: number | null; ts: number; frame: string; cursor: { x: number; y: number } }

let live: Live = { busy: false, url: "", title: "", why: "", jobId: null, ts: 0, frame: "", cursor: { x: VIEW.width / 2, y: VIEW.height / 2 } };
export const liveView = () => live;

type PW = typeof import("playwright-core");
let pw: Promise<PW> | null = null;
const load = () => (pw ??= import("playwright-core"));

let queue: Promise<unknown> = Promise.resolve();

// ── Take over: the child or parent drive the browser themselves ─────────────────────────────
// By default the companion uses its browser on its own and people watch. "Take over" opens one
// interactive page (same rules: safe list only, read-only, JavaScript off, no cookies kept) and
// the companion's own browsing waits until it's handed back (or 3 minutes idle).

type Session = { browser: import("playwright-core").Browser; page: import("playwright-core").Page; who: string; rules: BrowseRules; idle: ReturnType<typeof setTimeout> };
let session: Session | null = null;
export const takenOver = () => (session ? session.who : null);

async function snap(page: import("playwright-core").Page, why: string) {
  const shot = await page.screenshot({ type: "jpeg", quality: 55 });
  live = { busy: false, url: page.url(), title: (await page.title()).slice(0, 200), why, jobId: null, ts: Date.now(), frame: `data:image/jpeg;base64,${shot.toString("base64")}`, cursor: live.cursor };
  return live;
}

function bump() {
  if (!session) return;
  clearTimeout(session.idle);
  session.idle = setTimeout(() => void release(), 3 * 60_000);
}

export async function takeOver(who: string, rules: BrowseRules, startUrl?: string) {
  await release();
  const { chromium } = await load();
  const browser = await chromium.launch({ headless: true, proxy: { server: process.env.DESK_EGRESS_PROXY ?? "http://egress:3128" } });
  const context = await browser.newContext({ javaScriptEnabled: false, acceptDownloads: false, serviceWorkers: "block", viewport: VIEW, locale: "en-GB" });
  await context.route("**/*", (route) => {
    const r = route.request();
    return resourceAllowed(r.url(), r.resourceType(), r.method(), rules) ? route.continue() : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("filechooser", () => undefined);
  session = { browser, page, who, rules, idle: setTimeout(() => undefined, 0) };
  bump();
  const url = startUrl && pageAllowed(startUrl, rules) ? startUrl : live.url && pageAllowed(live.url, rules) ? live.url : `https://${rules.sites[0]?.replace(/^https?:\/\//, "") ?? "en.wikipedia.org"}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
  return snap(page, `taken over by ${who}`);
}

/** One step while taken over. Navigation off the safe list is blocked by the rules (and the proxy). */
export async function act(a: { type: "go" | "click" | "scroll" | "back"; url?: string; x?: number; y?: number; dy?: number }) {
  if (!session) throw new Error("Nobody has taken over the browser.");
  bump();
  const { page, rules, who } = session;
  const before = page.url();
  if (a.type === "go") {
    if (!a.url || !pageAllowed(a.url, rules)) throw new Error("That page isn't on the family's safe list.");
    await page.goto(a.url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
  } else if (a.type === "click") {
    const x = Math.max(0, Math.min(VIEW.width - 1, a.x ?? 0)), y = Math.max(0, Math.min(VIEW.height - 1, a.y ?? 0));
    live = { ...live, cursor: { x, y } };
    await page.mouse.move(x, y, { steps: 6 });
    await page.mouse.click(x, y);
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
  } else if (a.type === "scroll") {
    await page.mouse.wheel(0, Math.max(-2000, Math.min(2000, a.dy ?? 500)));
    await page.waitForTimeout(250);
  } else if (a.type === "back") {
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => undefined);
  }
  if (!pageAllowed(page.url(), rules) && page.url() !== "about:blank") {
    await page.goto(before, { waitUntil: "domcontentloaded", timeout: 8000 }).catch(() => undefined);
  }
  const l = await snap(page, `taken over by ${who}`);
  return { ...l, navigated: l.url !== before };
}

export async function release() {
  if (!session) return;
  const s = session;
  session = null;
  clearTimeout(s.idle);
  await s.browser.close().catch(() => undefined);
}

/** One visit at a time, so "Watch live" always shows the one thing Pip is doing. */
export function browse(url: string, why: string, jobId: number | null, rules: BrowseRules): Promise<Visit> {
  if (session) return Promise.reject(new Error(`The browser is being used by ${session.who} right now.`));
  const run = queue.then(() => visit(url, why, jobId, rules));
  queue = run.catch(() => undefined);
  return run;
}

async function visit(url: string, why: string, jobId: number | null, rules: BrowseRules): Promise<Visit> {
  if (!pageAllowed(url, rules)) throw new Error("That page isn't on the family's safe list.");
  const { chromium } = await load();
  const browser = await chromium.launch({
    headless: true,
    proxy: { server: process.env.DESK_EGRESS_PROXY ?? "http://egress:3128" },
    args: ["--disable-extensions", "--disable-sync", "--no-first-run", "--disable-background-networking"],
  });
  try {
    const context = await browser.newContext({
      javaScriptEnabled: false, acceptDownloads: false, serviceWorkers: "block", viewport: VIEW,
      userAgent: "Mozilla/5.0 (compatible; KithDesk/0.1; read-only)", locale: "en-GB",
    });
    await context.route("**/*", (route) => {
      const r = route.request();
      return resourceAllowed(r.url(), r.resourceType(), r.method(), rules) ? route.continue() : route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.on("filechooser", () => undefined); // never pick or upload files
    live = { ...live, busy: true, url, title: "", why, jobId, ts: Date.now() };
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const finalUrl = page.url();
    if (!pageAllowed(finalUrl, rules)) throw new Error("That page sent the browser off the safe list.");
    if (res && !res.ok()) throw new Error(`The page answered ${res.status()}.`);
    const title = (await page.title()).slice(0, 200);
    const text = (await page.evaluate("document.body ? document.body.innerText : ''") as string).replace(/\n{3,}/g, "\n\n").slice(0, 20_000);
    // "Reading": the pointer drifts over the text and the page scrolls a little, so people watching
    // live can see what it's doing. (JavaScript is off, so moving the mouse can't trigger anything.)
    const path = [{ x: 380, y: 220 }, { x: 640, y: 330 }, { x: 520, y: 470 }];
    for (let i = 0; i < path.length; i++) {
      await page.mouse.move(path[i].x, path[i].y, { steps: 8 });
      if (i > 0) await page.mouse.wheel(0, 420);
      await page.waitForTimeout(350);
      const s = await page.screenshot({ type: "jpeg", quality: 55 });
      live = { busy: i < path.length - 1, url: finalUrl, title, why, jobId, ts: Date.now(), frame: `data:image/jpeg;base64,${s.toString("base64")}`, cursor: path[i] };
    }
    await context.close();
    return { url: finalUrl, title, text, why, jobId, ts: Date.now() };
  } catch (err) {
    live = { ...live, busy: false };
    throw err;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
