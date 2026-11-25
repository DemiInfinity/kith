// Egress proxy for the desk's browser. The desk sits on a network with no internet; this proxy is
// its only way out, and it only lets through HTTPS (CONNECT) and HTTP GETs to hosts on the family's
// safe list, never to private addresses. The safe list comes from the Kith server (the parent edits
// it in the parent view) and is refreshed every 30 seconds. Every request is logged to stdout.

import http from "node:http";
import net from "node:net";
import dns from "node:dns/promises";
import { hostAllowed, isPrivateAddress } from "./allow.js";

const PORT = Number(process.env.EGRESS_PORT ?? 3128);
const KITH = (process.env.KITH_INTERNAL_URL ?? "http://kith:8787").replace(/\/$/, "");
const TOKEN = process.env.KITH_DESK_TOKEN ?? "";
if (!TOKEN) { console.error("KITH_DESK_TOKEN is not set"); process.exit(1); }

let allow: string[] = [];
let enabled = false;
let loaded = false;

async function refresh() {
  try {
    const r = await fetch(`${KITH}/internal/egress`, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { enabled: boolean; hosts: string[] };
    enabled = j.enabled;
    allow = j.hosts;
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
    if (!enabled || !hostAllowed(url.hostname, allow)) { deny(url.host, "not on the safe list"); res.writeHead(403).end("Not on the safe list"); return; }
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
  if (!hostAllowed(host, allow)) return refuse("not on the safe list");
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

server.listen(PORT, () => console.log(`egress proxy on ${PORT} (safe list only)`));
