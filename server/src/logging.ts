// What Kith's request logs keep. Query strings never reach the log: they can carry sign-in codes,
// states, handoff ids and search words. Wired into Fastify as `logger.serializers.req` in index.ts.

import type { FastifyRequest } from "fastify";

/** The path of a request URL, without its query string or fragment. */
export function pathOnly(url: string | undefined): string {
  if (!url) return "";
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Fastify's request serializer, minus the query string. */
export function reqSerializer(req: FastifyRequest | { method?: string; url?: string; ip?: string; socket?: { remotePort?: number } }) {
  return {
    method: req.method,
    url: pathOnly(req.url),
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
