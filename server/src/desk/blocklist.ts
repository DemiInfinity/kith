// What Pip's browser may open. By default that's the whole web minus a block list:
//  - built-in categories (adult, gambling, dating, social & chat, weapons & drugs, proxies),
//    matched by domain and by tell-tale words in the host name,
//  - the family's own blocked sites,
//  - public block lists fetched daily (hosts-file format, e.g. StevenBlack's porn + gambling list).
// The same rule runs in three places: here (search results and pages), the desk browser, and the
// egress proxy (the one that really counts, since it's the desk's only way out).
// "Safe list only" mode is still there for families who want it.

import fs from "node:fs";
import path from "node:path";
import net from "node:net";

export const CATEGORIES = {
  adult: {
    label: "Adult and explicit",
    domains: ["pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "onlyfans.com", "fansly.com", "chaturbate.com", "stripchat.com", "redtube.com", "youporn.com", "spankbang.com", "rule34.xxx", "e621.net", "nhentai.net", "literotica.com", "f95zone.to"],
    words: ["porn", "xxx", "sex", "nsfw", "hentai", "escort", "nude", "nudes", "camgirl", "fetish", "erotic", "milf", "onlyfans", "rule34"],
  },
  gambling: {
    label: "Gambling",
    domains: ["bet365.com", "williamhill.com", "paddypower.com", "skybet.com", "betfair.com", "ladbrokes.com", "coral.co.uk", "888.com", "pokerstars.com", "stake.com", "draftkings.com", "fanduel.com", "betway.com", "unibet.co.uk"],
    words: ["casino", "gambling", "poker", "slots", "betting", "sportsbook", "roulette", "blackjack", "bingo"],
  },
  dating: {
    label: "Dating",
    domains: ["tinder.com", "bumble.com", "hinge.co", "grindr.com", "match.com", "plentyoffish.com", "pof.com", "okcupid.com", "badoo.com", "ashleymadison.com"],
    words: ["dating", "hookup", "singles"],
  },
  social: {
    label: "Social media and stranger chat",
    domains: ["omegle.com", "ome.tv", "chatroulette.com", "emeraldchat.com", "chatib.us", "4chan.org", "4channel.org", "8kun.top", "kiwifarms.net", "reddit.com", "x.com", "twitter.com", "tiktok.com", "instagram.com", "facebook.com", "snapchat.com", "discord.com", "discord.gg", "tumblr.com", "telegram.org", "t.me", "kik.com", "wizz.chat", "yubo.live"],
    words: ["strangerchat", "randomchat"],
  },
  harm: {
    label: "Weapons, drugs, gore and self-harm",
    domains: ["bestgore.fun", "theync.com", "goregrish.com", "erowid.org", "silkroad.com"],
    words: ["gore", "suicide", "proana", "thinspo"],
  },
  proxies: {
    label: "Proxies, VPNs and ways around filters",
    domains: ["hide.me", "hidemyass.com", "proxysite.com", "croxyproxy.com", "kproxy.com", "torproject.org", "4everproxy.com", "blockaway.net"],
    words: ["proxy", "unblock", "unblocked"],
  },
} as const;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

/** Host words, split on dots and dashes, so "bet" never matches "alphabet". */
export function wordPatterns(cats: readonly Category[]): string[] {
  return cats.flatMap((c) => CATEGORIES[c].words.map((w) => w));
}

export function hostOf(entry: string): string {
  return entry.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:?#].*$/, "").replace(/^\*\./, "").replace(/\.$/, "");
}

/** Names that never belong to the public web. */
export function internalName(host: string): boolean {
  const h = host.toLowerCase();
  return !h.includes(".") || net.isIP(h) !== 0 || /\.(local|lan|home|internal|intranet|corp|localhost|home\.arpa|onion)$/.test(h);
}

export interface BlockRules { domains: Set<string>; words: string[] }

/** True if the host, or any domain it sits under, is blocked, or a host part contains a blocked word. */
export function hostBlocked(host: string, rules: BlockRules): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (internalName(h)) return true;
  const labels = h.split(".");
  for (let i = 0; i < labels.length - 1; i++) if (rules.domains.has(labels.slice(i).join("."))) return true;
  const parts = h.split(/[.-]/);
  return rules.words.some((w) => parts.some((p) => p === w || (w.length >= 5 && p.includes(w))));
}

/** Parses a hosts file ("0.0.0.0 example.com") or a plain list of domains. */
export function parseList(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const bits = line.split(/\s+/);
    const d = hostOf(bits.length > 1 && net.isIP(bits[0]) ? bits[1] : bits[0]);
    if (d && d.includes(".") && !net.isIP(d) && d !== "localhost" && /^[a-z0-9.-]+$/.test(d)) out.push(d);
  }
  return out;
}

/** Downloads and caches the public block lists. If a download fails, the last good copy is kept. */
export class ExternalLists {
  private set = new Set<string>();
  private fetchedAt = 0;
  private urlsKey = "";
  version = 0;
  constructor(private dir: string, private fetchImpl: typeof fetch = fetch) {
    try {
      const cached = fs.readFileSync(path.join(dir, "blocklist.txt"), "utf8");
      this.set = new Set(cached.split("\n").filter(Boolean));
      this.version = this.set.size ? 1 : 0;
    } catch { /* nothing cached yet */ }
  }
  domains(): Set<string> { return this.set; }
  async refresh(urls: string[], force = false): Promise<void> {
    const key = urls.join("\n");
    if (!force && key === this.urlsKey && Date.now() - this.fetchedAt < 24 * 3_600_000) return;
    this.urlsKey = key;
    this.fetchedAt = Date.now();
    if (!urls.length) { this.set = new Set(); this.version++; return; }
    const next = new Set<string>();
    let ok = 0;
    for (const u of urls) {
      try {
        const r = await this.fetchImpl(u, { signal: AbortSignal.timeout(30_000) });
        if (!r.ok) throw new Error(String(r.status));
        for (const d of parseList(await r.text())) next.add(d);
        ok++;
      } catch (err) {
        console.warn(`[blocklist] couldn't fetch ${u}: ${(err as Error).message}`);
      }
    }
    if (!ok) return; // keep what we had
    this.set = next;
    this.version++;
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(path.join(this.dir, "blocklist.txt"), [...next].join("\n")); } catch { /* cache is optional */ }
  }
}

export interface WebSettings { mode: "blocklist" | "safelist"; sites: string[]; blocked: string[]; categories: Category[] }

/** The full set of rules for a moment in time. */
export function blockRules(s: WebSettings, external: Set<string>): BlockRules {
  const domains = new Set(external);
  for (const c of s.categories) for (const d of CATEGORIES[c].domains) domains.add(d);
  for (const d of s.blocked) { const h = hostOf(d); if (h) domains.add(h); }
  // The family's own safe list always wins over a public list (never over its own blocked list).
  for (const d of s.sites) { const h = hostOf(d); if (h && !s.blocked.map(hostOf).includes(h)) domains.delete(h); }
  return { domains, words: wordPatterns(s.categories) };
}
