// Small wrapper for Vercel's Node functions: errors become friendly JSON (or a page), and nothing
// about the request (codes, tokens) is ever logged.
import { HttpError, settings } from "./broker.mjs";

export function handler(fn, { methods = ["GET"] } = {}) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!methods.includes(req.method)) { res.statusCode = 405; return res.end(); }
    try {
      await fn(req, res, settings());
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error("[kith-connect]", e instanceof Error ? e.message : "error");
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: e instanceof HttpError ? e.message : "Something went wrong." }));
    }
  };
}
export const redirect = (res, url) => { res.statusCode = 302; res.setHeader("Location", url); res.end(); };
export const json = (res, status, body) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
