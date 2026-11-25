// What the desk browser may load. Pure, so it's testable without a browser.
// "blocklist" (the default): the whole web over https, minus blocked sites and host words.
// "safelist": only the listed sites. The egress proxy applies the big public block list on top.

export interface BrowseRules {
  mode?: "blocklist" | "safelist";
  sites: string[];
  assetHosts: string[];
  blocked?: string[];
  words?: string[];
}

const strip = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
const hostOf = (s: string) => strip(s).replace(/[/:?#].*$/, "").replace(/^\*\./, "");

function internalName(h: string) {
  return !h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || /\.(local|lan|home|internal|intranet|corp|localhost|home\.arpa|onion)$/.test(h);
}

export function hostBlocked(host: string, rules: BrowseRules): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (internalName(h)) return true;
  const blocked = new Set((rules.blocked ?? []).map(hostOf));
  const labels = h.split(".");
  for (let i = 0; i < labels.length - 1; i++) if (blocked.has(labels.slice(i).join("."))) return true;
  const parts = h.split(/[.-]/);
  return (rules.words ?? []).some((w) => parts.some((p) => p === w || (w.length >= 5 && p.includes(w))));
}

function onList(u: URL, sites: string[]): boolean {
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  return sites.map(strip).some((entry) => {
    const [h, ...rest] = entry.split("/");
    const prefix = rest.length ? "/" + rest.join("/") : "";
    const hostOk = host === h || host.endsWith("." + h) || (h.startsWith("www.") && host === h.slice(4));
    return hostOk && (!prefix || path === prefix || path.startsWith(prefix + "/") || path.startsWith(prefix));
  });
}

/** Page navigations: https only; then the safe list, or "not blocked". */
export function pageAllowed(url: string, rules: BrowseRules): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  if ((rules.mode ?? "safelist") === "safelist") return onList(u, rules.sites);
  if (onList(u, rules.sites) && !onList(u, rules.blocked ?? [])) return true;
  return !hostBlocked(u.hostname, rules);
}

/** Images and styles only (scripts, fetches and sockets never load). */
export function resourceAllowed(url: string, type: string, method: string, rules: BrowseRules): boolean {
  if (method !== "GET") return false;
  if (type === "script" || type === "xhr" || type === "fetch" || type === "websocket" || type === "eventsource" || type === "manifest" || type === "other") return false;
  if (type === "document") return pageAllowed(url, rules);
  if ((rules.mode ?? "safelist") === "blocklist") return pageAllowed(url, rules);
  if (pageAllowed(url, { sites: rules.sites.map((s) => strip(s).split("/")[0]), assetHosts: [] })) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return url.startsWith("https://") && rules.assetHosts.map(strip).some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

/** A robot check (CAPTCHA, "are you human?") instead of the page. Pip stops; it never tries to pass one. */
const ROBOT = /captcha|are you (a )?(human|robot)|verify (that )?you('| a)re (a )?human|unusual traffic|checking your browser|just a moment\.\.\.|attention required|press (&|and) hold|bots use duckduckgo/i;
export function looksLikeRobotCheck(title: string, text: string, frames: string[] = [], status = 200): boolean {
  if (frames.some((f) => /recaptcha|hcaptcha\.com|challenges\.cloudflare\.com|arkoselabs|funcaptcha|geo\.captcha-delivery/i.test(f))) return true;
  const head = `${title}\n${text.slice(0, 1500)}`;
  if (ROBOT.test(head) && (text.length < 4000 || status === 403 || status === 429 || status === 503)) return true;
  return false;
}
