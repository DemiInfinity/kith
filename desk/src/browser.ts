// Pip's browser: headless Chromium (Playwright) that can only read safe-listed pages.
// - All traffic goes through the egress proxy, which enforces the safe list again.
// - Read-only: JavaScript off, downloads off, uploads off, nothing but GET requests.
// - No logins or cookies kept: every visit uses a brand-new, empty browser context.
// - What it reads is returned as data for the Kith server to check; nothing on a page can tell the
//   desk to do anything.

import { pageAllowed, resourceAllowed, type BrowseRules } from "./rules.js";

export interface Visit { url: string; title: string; text: string; why: string; jobId: number | null; ts: number }
export interface Live { busy: boolean; url: string; title: string; why: string; jobId: number | null; ts: number; frame: string }

let live: Live = { busy: false, url: "", title: "", why: "", jobId: null, ts: 0, frame: "" };
export const liveView = () => live;

type PW = typeof import("playwright-core");
let pw: Promise<PW> | null = null;
const load = () => (pw ??= import("playwright-core"));

let queue: Promise<unknown> = Promise.resolve();

/** One visit at a time, so "Watch live" always shows the one thing Pip is doing. */
export function browse(url: string, why: string, jobId: number | null, rules: BrowseRules): Promise<Visit> {
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
      javaScriptEnabled: false, acceptDownloads: false, serviceWorkers: "block", viewport: { width: 1000, height: 700 },
      userAgent: "Mozilla/5.0 (compatible; KithDesk/0.1; read-only)", locale: "en-GB",
    });
    await context.route("**/*", (route) => {
      const r = route.request();
      return resourceAllowed(r.url(), r.resourceType(), r.method(), rules) ? route.continue() : route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.on("filechooser", () => undefined); // never pick or upload files
    live = { busy: true, url, title: "", why, jobId, ts: Date.now(), frame: live.frame };
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const finalUrl = page.url();
    if (!pageAllowed(finalUrl, rules)) throw new Error("That page sent the browser off the safe list.");
    if (res && !res.ok()) throw new Error(`The page answered ${res.status()}.`);
    const title = (await page.title()).slice(0, 200);
    const text = (await page.evaluate("document.body ? document.body.innerText : ''") as string).replace(/\n{3,}/g, "\n\n").slice(0, 20_000);
    const shot = await page.screenshot({ type: "jpeg", quality: 55 });
    live = { busy: false, url: finalUrl, title, why, jobId, ts: Date.now(), frame: `data:image/jpeg;base64,${shot.toString("base64")}` };
    await context.close();
    return { url: finalUrl, title, text, why, jobId, ts: Date.now() };
  } catch (err) {
    live = { ...live, busy: false };
    throw err;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
