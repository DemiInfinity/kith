// What the desk browser may load. Pure, so it's testable without a browser.

export interface BrowseRules { sites: string[]; assetHosts: string[] }

const strip = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");

/** Page navigations: https only, to a listed site (host, optionally with a path prefix). */
export function pageAllowed(url: string, rules: BrowseRules): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  return rules.sites.map(strip).some((entry) => {
    const [h, ...rest] = entry.split("/");
    const prefix = rest.length ? "/" + rest.join("/") : "";
    const hostOk = host === h || host.endsWith("." + h) || (h.startsWith("www.") && host === h.slice(4));
    return hostOk && (!prefix || path === prefix || path.startsWith(prefix + "/") || path.startsWith(prefix));
  });
}

/** Images and styles may also come from a listed asset host (e.g. upload.wikimedia.org). Scripts never load. */
export function resourceAllowed(url: string, type: string, method: string, rules: BrowseRules): boolean {
  if (method !== "GET") return false;
  if (type === "script" || type === "xhr" || type === "fetch" || type === "websocket" || type === "eventsource" || type === "manifest" || type === "other") return false;
  if (type === "document") return pageAllowed(url, rules);
  if (pageAllowed(url, { sites: rules.sites.map((s) => strip(s).split("/")[0]), assetHosts: [] })) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return url.startsWith("https://") && rules.assetHosts.map(strip).some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}
