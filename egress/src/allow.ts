// The proxy's rules, kept separate so they're easy to test. "blocklist" mode (the default): any public
// host except blocked ones. "safelist" mode: listed hosts only.
import net from "node:net";

/** "bbc.co.uk/bitesize" → host "bbc.co.uk". Paths are enforced by the desk browser; the proxy works on hosts. */
export function hostOf(entry: string): string {
  return entry.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "").replace(/^\*\./, "");
}

/** A host is allowed if it is, or is under, a listed site (www. and other subdomains included). */
export function hostAllowed(host: string, list: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || net.isIP(h)) return false; // never raw IP addresses
  return list.map(hostOf).filter(Boolean).some((site) => h === site || h.endsWith("." + site));
}

/** Private, loopback, link-local and other internal addresses are never reachable. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

function internalName(h: string) {
  return !h.includes(".") || net.isIP(h) !== 0 || /\.(local|lan|home|internal|intranet|corp|localhost|home\.arpa|onion)$/.test(h);
}

export interface ProxyRules { mode: "blocklist" | "safelist"; hosts: string[]; blocked: Set<string>; words: string[] }

/** Blocked if the host or any domain it sits under is listed, or a host part holds a blocked word. */
export function hostBlocked(host: string, blocked: Set<string>, words: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (internalName(h)) return true;
  const labels = h.split(".");
  for (let i = 0; i < labels.length - 1; i++) if (blocked.has(labels.slice(i).join("."))) return true;
  const parts = h.split(/[.-]/);
  return words.some((w) => parts.some((p) => p === w || (w.length >= 5 && p.includes(w))));
}

export function proxyAllows(host: string, r: ProxyRules): boolean {
  if (r.mode === "safelist") return hostAllowed(host, r.hosts);
  if (hostAllowed(host, r.hosts) && !r.blocked.has(hostOf(host))) return true;
  return !hostBlocked(host, r.blocked, r.words);
}
