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

/** "2001:db8::1" → its eight 16-bit groups (an IPv4 tail such as "::ffff:1.2.3.4" counts as two). */
export function ipv6Groups(ip: string): number[] | null {
  let v = ip.toLowerCase().replace(/%.*$/, "");
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (v4) {
    if (!net.isIPv4(v4[1])) return null;
    const [a, b, c, d] = v4[1].split(".").map(Number);
    v = v.slice(0, -v4[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = v.split("::");
  if (halves.length > 2) return null;
  const part = (h: string) => (h ? h.split(":").map((x) => parseInt(x, 16)) : []);
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill(0), ...tail];
  return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function privateV4(ip: string): boolean {
  const [a, b, c] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    || (a === 198 && (b === 18 || b === 19)) // benchmarking 198.18.0.0/15
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) // special and documentation
    || a >= 224; // multicast and reserved
}

/**
 * Private, loopback, link-local and other internal addresses are never reachable, including
 * IPv6 forms that carry an IPv4 address inside (mapped, compatible, NAT64, 6to4, Teredo).
 */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return privateV4(ip);
  const g = ipv6Groups(ip);
  if (!g) return true; // can't read it: not reachable
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(5) && g[5] === 0xffff) return privateV4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`); // ::ffff:a.b.c.d
  if (zeros(6)) return true; // ::, ::1 and IPv4-compatible ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 64:ff9b::/96 (and 64:ff9b:1::/48)
  if (g[0] === 0x2002) return true; // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if (g[0] === 0x100 && zeros(4)) return true; // discard 100::/64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, old site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

function internalName(h: string) {
  return !h.includes(".") || net.isIP(h) !== 0 || /\.(local|lan|home|internal|intranet|corp|localhost|home\.arpa|onion)$/.test(h);
}

/** Anything with has(): a Set, or the big public list and the family's own list together. */
export interface DomainSet { has(domain: string): boolean }

/** Both lists, checked in place (the big list isn't copied each time the family's rules refresh). */
export function eitherSet(a: DomainSet, b: DomainSet): DomainSet {
  return { has: (d) => a.has(d) || b.has(d) };
}

export interface ProxyRules { mode: "blocklist" | "safelist"; hosts: string[]; blocked: DomainSet; words: string[] }

/** Blocked if the host or any domain it sits under is listed, or a host part holds a blocked word. */
export function hostBlocked(host: string, blocked: DomainSet, words: string[]): boolean {
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
