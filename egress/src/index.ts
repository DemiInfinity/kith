// Egress proxy for the desk's browser. The desk sits on a network with no internet; this proxy is
// its only way out. It lets through HTTPS (CONNECT) and HTTP GETs to public hosts that aren't on the
// block list (or, in "safelist" mode, only to listed hosts), never to private addresses. The rules
// come from the Kith server (the parent edits them in the parent view) and refresh every 30 seconds;
// the big public block list is fetched again whenever it changes. Every request is logged to stdout.

import http from "node:http";
import net from "node:net";
import dns from "node:dns/promises";
import { isPrivateAddress, proxyAllows, type ProxyRules } from "./allow.js";

const PORT = Number(process.env.EGRESS_PORT ?? 3128);
const KITH = (process.env.KITH_INTERNAL_URL ?? "http://kith:8787").replace(/\/$/, "");
const TOKEN = process.env.KITH_DESK_TOKEN ?? "";
if (!TOKEN) { console.error("KITH_DESK_TOKEN is not set"); process.exit(1); }

let rules: ProxyRules = { mode: "safelist", hosts: [], blocked: new Set(), words: [] };
let enabled = false;
let loaded = false;
let listVersion = -1;
let bigList = new Set<string>();

async function refresh() {
  try {
    const auth = { Authorization: `Bearer ${TOKEN}` };
    const r = await fetch(`${KITH}/internal/egress`, { headers: auth, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { enabled: boolean; mode?: "blocklist" | "safelist"; hosts: string[]; blocked?: string[]; words?: string[]; listVersion?: number };
    const mode = j.mode ?? "safelist";
    if (mode === "blocklist" && j.listVersion !== listVersion) {
      const l = await fetch(`${KITH}/internal/egress/list`, { headers: auth, signal: AbortSignal.timeout(30_000) });
      if (!l.ok) throw new Error(`list ${l.status}`);
      bigList = new Set((await l.text()).split("\n").filter(Boolean));
      listVersion = j.listVersion ?? 0;
      console.log(`[egress] block list loaded: ${bigList.size} domains`);
    }
    const blocked = new Set(bigList);
    for (const d of j.blocked ?? []) blocked.add(d);
    rules = { mode, hosts: j.hosts, blocked, words: j.words ?? [] };
    enabled = j.enabled;
    loaded = true;
  } catch (err) {
    // Keep the last list; if we never got one, nothing is allowed.
    console.warn(`[egress] couldn't refresh the safe list: ${(err as Error).message}`);
  }
}
// Until the first list arrives (Kith may still be starting), try every 3 seconds; then every 30.
void refresh();
const early = setInterval(() => (loaded ? clearInterval(early) : void refresh()), 3_000);
setInterval(refresh, 30_000);

async function resolvePublic(host: string): Promise<string | null> {
  try {
    const addrs = await dns.lookup(host, { all: true });
    const ok = addrs.find((a) => !isPrivateAddress(a.address));
    return addrs.every((a) => !isPrivateAddress(a.address)) && ok ? ok.address : null;
  } catch {
    return null;
  }
}

function deny(what: string, why: string) {
  console.log(JSON.stringify({ ts: Date.now(), allowed: false, what, why }));
}

const server = http.createServer(async (req, res) => {
  // Plain HTTP through the proxy: GET/HEAD only, safe-listed hosts only.
  try {
    const url = new URL(req.url ?? "");
    if (!enabled || !proxyAllows(url.hostname, rules)) { deny(url.host, "blocked"); res.writeHead(403).end("Blocked"); return; }
    if (req.method !== "GET" && req.method !== "HEAD") { deny(url.host, `method ${req.method}`); res.writeHead(405).end("Read-only"); return; }
    const ip = await resolvePublic(url.hostname);
    if (!ip) { deny(url.host, "private or unknown address"); res.writeHead(403).end("Blocked"); return; }
    console.log(JSON.stringify({ ts: Date.now(), allowed: true, what: `${req.method} ${url.host}${url.pathname}` }));
    const up = http.request({ host: ip, port: url.port || 80, path: url.pathname + url.search, method: req.method, headers: { ...req.headers, host: url.host, cookie: "" } }, (r) => {
      res.writeHead(r.statusCode ?? 502, { ...r.headers, "set-cookie": [] });
      r.pipe(res);
    });
    up.on("error", () => res.writeHead(502).end());
    up.end();
  } catch {
    res.writeHead(400).end();
  }
});

// HTTPS: a CONNECT tunnel to port 443 of a safe-listed host only.
server.on("connect", async (req, client: net.Socket, head) => {
  const [host, portStr] = (req.url ?? "").split(":");
  const port = Number(portStr || 443);
  const refuse = (why: string) => { deny(req.url ?? "", why); client.end("HTTP/1.1 403 Forbidden\r\n\r\n"); };
  if (!enabled) return refuse("browsing is switched off");
  if (port !== 443) return refuse("only https");
  if (!proxyAllows(host, rules)) return refuse(rules.mode === "safelist" ? "not on the safe list" : "on the block list");
  const ip = await resolvePublic(host);
  if (!ip) return refuse("private or unknown address");
  console.log(JSON.stringify({ ts: Date.now(), allowed: true, what: `CONNECT ${host}` }));
  const up = net.connect(port, ip, () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) up.write(head);
    up.pipe(client);
    client.pipe(up);
  });
  up.setTimeout(60_000, () => up.destroy());
  up.on("error", () => client.destroy());
  client.on("error", () => up.destroy());
});

server.listen(PORT, () => console.log(`egress proxy on ${PORT} (${"block list or safe list, from Kith"})`));
