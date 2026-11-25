// Pip's desk: a small offline computer for the things the companion makes. Runs in its own
// container on a network with no internet access. It holds no API key: the Kith server does the
// thinking and hands finished things here. Only the Kith server can reach it (shared token).

import type { BrowseRules } from "./rules.js";
import http from "node:http";
import crypto from "node:crypto";
import { DeskStore, type Format } from "./store.js";
import { act, browse, clearStorage, sleep, liveView, release, takeOver, takenOver } from "./browser.js";

const PORT = Number(process.env.DESK_PORT ?? 8790);
const TOKEN = process.env.KITH_DESK_TOKEN ?? "";
const store = new DeskStore(process.env.DESK_DIR ?? "./desk-data");

if (!TOKEN) {
  console.error("KITH_DESK_TOKEN is not set; the desk refuses to start without it.");
  process.exit(1);
}

let status: { activity: string; progress: number; updatedAt: number } = { activity: "", progress: 0, updatedAt: Date.now() };

function send(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error("too big");
    chunks.push(c as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function authorised(req: http.IncomingMessage) {
  const got = Buffer.from(req.headers.authorization ?? "");
  const want = Buffer.from(`Bearer ${TOKEN}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function readRules(b: Record<string, unknown>): BrowseRules {
  const r = (b.rules ?? b) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 5000) : []);
  return { mode: r.mode === "blocklist" ? "blocklist" : "safelist", sites: list(r.sites), assetHosts: list(r.assetHosts), blocked: list(r.blocked), words: list(r.words) };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://desk");
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    if (!authorised(req)) return send(res, 401, { error: "unauthorised" });

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "status") {
      if (req.method === "GET") return send(res, 200, status);
      if (req.method === "PUT") {
        const b = await readJson(req);
        status = { activity: String(b.activity ?? "").slice(0, 120), progress: Math.max(0, Math.min(100, Number(b.progress) || 0)), updatedAt: Date.now() };
        return send(res, 200, status);
      }
    }
    if (parts[0] === "browse" && req.method === "POST") {
      const b = await readJson(req);
      const rules = readRules(b);
      try {
        return send(res, 200, await browse(String(b.url), String(b.why ?? "").slice(0, 200), Number.isInteger(b.jobId) ? (b.jobId as number) : null, rules));
      } catch (err) {
        return send(res, 422, { error: (err as Error).message });
      }
    }
    if (parts[0] === "browser" && parts[1] === "live" && req.method === "GET") return send(res, 200, { ...liveView(), takenOverBy: takenOver() });
    if (parts[0] === "browser" && req.method === "POST") {
      const b = await readJson(req);
      try {
        if (parts[1] === "takeover") {
          return send(res, 200, await takeOver(String(b.who ?? "someone").slice(0, 20), readRules(b), b.url as string | undefined, typeof b.name === "string" ? b.name : undefined));
        }
        if (parts[1] === "action") return send(res, 200, await act(b as never));
        if (parts[1] === "release") { await release(); return send(res, 200, { ok: true }); }
        if (parts[1] === "sleep") return send(res, 200, { slept: await sleep() });
        if (parts[1] === "clear") { await clearStorage(); return send(res, 200, { ok: true }); }
      } catch (err) {
        return send(res, 422, { error: (err as Error).message });
      }
    }
    if (parts[0] === "items") {
      const id = parts[1];
      if (!id && req.method === "GET") return send(res, 200, store.list());
      if (!id && req.method === "POST") {
        const b = await readJson(req);
        const r = store.write({
          kind: String(b.kind ?? "thing"), title: String(b.title ?? "Untitled"), icon: b.icon as string | undefined,
          format: String(b.format) as Format, summary: b.summary as string | undefined,
          characterIds: Array.isArray(b.characterIds) ? (b.characterIds as number[]).filter(Number.isInteger) : [],
          content: String(b.content ?? ""),
        });
        return r.ok ? send(res, 201, r.meta) : send(res, 422, { problems: r.problems });
      }
      if (id && parts[2] === "favourite" && req.method === "PUT") {
        const b = await readJson(req);
        const m = store.setFavourite(id, Boolean(b.favourite));
        return m ? send(res, 200, m) : send(res, 404, { error: "not found" });
      }
      if (id && req.method === "GET") {
        const v = url.searchParams.get("v");
        const r = store.read(id, v ? Number(v) : undefined);
        return r ? send(res, 200, r) : send(res, 404, { error: "not found" });
      }
      if (id && req.method === "PUT") {
        const b = await readJson(req);
        const existing = store.meta(id);
        if (!existing) return send(res, 404, { error: "not found" });
        const r = store.write({
          id, kind: existing.kind, title: String(b.title ?? existing.title), format: existing.format,
          summary: b.summary as string | undefined, content: String(b.content ?? ""),
        });
        return r.ok ? send(res, 200, r.meta) : send(res, 422, { problems: r.problems });
      }
      if (id && req.method === "DELETE") return store.remove(id) ? send(res, 200, { ok: true }) : send(res, 404, { error: "not found" });
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 400, { error: (err as Error).message });
  }
});

server.listen(PORT, () => console.log(`Pip's desk is listening on ${PORT} (offline)`));
