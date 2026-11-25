// The safe-list rules, kept separate so they're easy to test.
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
