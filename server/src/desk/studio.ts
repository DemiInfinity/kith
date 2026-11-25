// The Studio: the companion makes small things on its desk (stories, quizzes that mark themselves,
// flashcards, revision timers, mini games, choose-your-own-adventure stories, posters, cards,
// comics, slides, sketches, palettes, maps, timelines). It uses the separate desk budget, every
// result goes through the same safety check as chat, and the desk itself refuses anything that
// tries to reach the network or storage. Interactive things then run in a locked sandbox.

import { z } from "zod";
import type { DB } from "../db.js";
import { all, get, run } from "../db.js";
import { config } from "../config.js";
import { computeDeskEnergy, recentRows } from "../budget/budget.js";
import { callJson, type LLM } from "../llm.js";
import { loadParentSettings, loadProfile } from "../settings.js";
import type { SafetyChecker } from "../safety/check.js";
import { stripHtml } from "../connections/connections.js";
import { DeskClient, DeskError, type ItemMeta } from "./deskClient.js";
import { charactersForPrompt } from "./oc.js";
import type { Storage } from "../storage/storage.js";
import { Browser, untrusted, WEB_RULES } from "./browse.js";
import { logActivity } from "./activity.js";
import { pushToChild } from "../checkins/push.js";
import { inQuietHours } from "../budget/time.js";

export const KINDS = {
  story: { format: "md", icon: "📖", what: "a story in Markdown, with a title line and short paragraphs" },
  adventure: { format: "html", icon: "🧭", what: "a choose-your-own-adventure story with choices as buttons" },
  comic: { format: "html", icon: "💬", what: "a short comic: panels drawn with inline SVG and speech bubbles" },
  slides: { format: "html", icon: "🖼️", what: "a small slide deck with next/previous buttons and arrow keys" },
  flashcards: { format: "html", icon: "🗂️", what: "flashcards that flip on tap, with shuffle and a 'got it / again' pile" },
  quiz: { format: "html", icon: "✅", what: "a quiz that marks itself, explains each answer and shows a score at the end" },
  timer: { format: "html", icon: "⏱️", what: "a revision timer (focus/break cycles) with big friendly controls" },
  game: { format: "html", icon: "🎮", what: "a small, gentle mini game playable by tapping on a phone" },
  poster: { format: "html", icon: "🪧", what: "a poster" },
  card: { format: "html", icon: "💌", what: "a card to give someone" },
  sketch: { format: "svg", icon: "✏️", what: "a simple, friendly SVG sketch (flat shapes, no text-heavy labels)" },
  palette: { format: "html", icon: "🎨", what: "a colour palette with named swatches and hex codes" },
  map: { format: "svg", icon: "🗺️", what: "a simple illustrated SVG map with labelled places" },
  timeline: { format: "html", icon: "📜", what: "a timeline with events in order" },
  playlist: { format: "md", icon: "🎵", what: "a playlist idea as a Markdown list (titles and artists, a line on why each fits)" },
  notes: { format: "md", icon: "📝", what: "notes or cue cards in Markdown" },
} as const;
export type Kind = keyof typeof KINDS;
/** Background and revision work always runs on the small model, to save the budget. */
export const LOW_POWER_KINDS = new Set(["flashcards", "quiz", "notes", "timer", "timeline", "playlist", "palette"]);
export const KIND_NAMES = Object.keys(KINDS) as Kind[];

export interface Job {
  id: number; ts: number; kind: string; title: string; status: "queued" | "working" | "done" | "failed";
  progress: number; file_id: string | null; error: string | null; updated: number;
}

const Out = z.object({
  title: z.string(), summary: z.string(), content: z.string(),
  rows: z.array(z.array(z.string())).default([]),
  slides: z.array(z.object({ title: z.string(), body: z.string() })).default([]),
});
const OUT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "summary", "content", "rows", "slides"],
  properties: {
    title: { type: "string" }, summary: { type: "string" }, content: { type: "string" },
    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
    slides: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["title", "body"], properties: { title: { type: "string" }, body: { type: "string" } } },
    },
  },
};

const RULES = `You make small things on your desk for a teenager (about 13–15). Your desk is an offline computer.
Safety: age-appropriate only (friendships, rivalries, adventure and mild peril are fine; no romance, nothing sexual,
no gore, no real people's private details, no personal details about the teenager such as school or address).
Technical rules for HTML: one complete, self-contained HTML document. Inline <style> and <script> only.
No external files, fonts, images or links; no network calls; no localStorage, sessionStorage, cookies or indexedDB
(they're blocked; keep state in variables); no iframes; no window.open. Use system fonts.
Make it work well on a phone (tap targets ≥ 44px, readable sizes) and on a laptop.
House style: dark plum background (#1C1219), cards #2A1C27 with #4A3046 borders, text #FBEAF6, lilac accents (#D9A3E0),
ember highlights (#F59646), rounded corners. Friendly and polished.
For SVG: one <svg> element with a viewBox, no scripts, no event handlers, no external references.
For Markdown: plain Markdown only.
Return JSON: title (short), summary (one short line for the desk, e.g. "chapter 2 of 3" or "10 questions"), content.
Also rows: for flashcards [[front, back], …], for quizzes [[question, answer], …], for timelines [[when, what], …]; otherwise [].
And slides: for slide decks [{title, body}, …] matching the deck (so it can also become a Google Slides file); otherwise [].`;

export class Studio {
  private queue: number[] = [];
  private running = false;
  constructor(
    private db: DB,
    private llm: LLM,
    private safety: SafetyChecker,
    readonly desk = new DeskClient(),
    readonly storage: Storage | null = null,
  ) {
    this.browser = new Browser(db, desk, safety);
  }
  readonly browser: Browser;

  jobs(limit = 20): Job[] {
    return all<Job>(this.db, "SELECT id, ts, kind, title, status, progress, file_id, error, updated FROM desk_jobs ORDER BY ts DESC LIMIT ?", limit);
  }

  deskEnergy() {
    return computeDeskEnergy(recentRows(this.db), Date.now(), loadParentSettings(this.db).budgets, config.timezone);
  }

  /** Queue something new to make, or a change to something already made. */
  enqueue(req: { kind: Kind | "edit"; title: string; brief: string; characterIds?: number[]; chapters?: number; fileId?: string; lookUp?: string }): { ok: true; job: Job } | { ok: false; error: string } {
    if (!this.llm.available) return { ok: false, error: "The desk can't make things until an API key is set." };
    const energy = this.deskEnergy();
    if (!energy.canWork) return { ok: false, error: "The desk's energy for today is used up. It tops up tomorrow." };
    if (req.kind !== "edit" && !KINDS[req.kind]) return { ok: false, error: `I can't make a "${req.kind}" yet.` };
    const busy = get<{ n: number }>(this.db, "SELECT COUNT(*) AS n FROM desk_jobs WHERE status IN ('queued','working')")?.n ?? 0;
    if (busy >= 5) return { ok: false, error: "My desk is full right now. Let me finish what I'm making first." };
    const ts = Date.now();
    const res = run(
      this.db,
      "INSERT INTO desk_jobs(ts, kind, title, request, status, progress, file_id, updated) VALUES (?,?,?,?, 'queued', 0, ?, ?)",
      ts, req.kind, req.title.slice(0, 80), JSON.stringify(req), req.fileId ?? null, ts,
    );
    const id = Number(res.lastInsertRowid);
    logActivity(this.db, "💬", req.kind === "edit" ? `Asked to change something: ${req.brief.slice(0, 80)}` : `Asked for ${req.title}`);
    this.queue.push(id);
    void this.pump();
    return { ok: true, job: this.job(id)! };
  }

  job(id: number) {
    return get<Job>(this.db, "SELECT id, ts, kind, title, status, progress, file_id, error, updated FROM desk_jobs WHERE id = ?", id);
  }

  /** Re-queue anything left unfinished by a restart. */
  resume() {
    for (const j of all<{ id: number }>(this.db, "SELECT id FROM desk_jobs WHERE status IN ('queued','working') ORDER BY ts")) this.queue.push(j.id);
    void this.pump();
  }

  private update(id: number, fields: Partial<Pick<Job, "status" | "progress" | "file_id" | "error">>) {
    const sets = Object.keys(fields).map((k) => `${k} = ?`).join(", ");
    run(this.db, `UPDATE desk_jobs SET ${sets}, updated = ? WHERE id = ?`, ...(Object.values(fields) as (string | number | null)[]), Date.now(), id);
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        const row = get<{ request: string; title: string }>(this.db, "SELECT request, title FROM desk_jobs WHERE id = ?", id);
        if (!row) continue;
        try {
          this.update(id, { status: "working", progress: 5 });
          const req = JSON.parse(row.request);
          const fileId = req.kind === "edit" ? await this.edit(id, req) : await this.make(id, req);
          this.update(id, { status: "done", progress: 100, file_id: fileId });
          if (!inQuietHours(Date.now(), config.timezone, loadParentSettings(this.db).quietHours)) {
            void pushToChild(this.db, { title: loadProfile(this.db).name, body: `✨ ${row.title} is ready on my desk`, url: "/pip" }, "deskReady");
          }
          logActivity(this.db, "✅", `${req.kind === "edit" ? "Changed" : "Made"} ${row.title}${this.deskEnergy().mode === "low" || LOW_POWER_KINDS.has(req.kind) ? " (Low power)" : ""}`);
        } catch (err) {
          const msg = err instanceof DeskError && err.problems.length
            ? `The desk didn't keep it because it ${err.problems.join(", ")}.`
            : (err as Error).message;
          this.update(id, { status: "failed", error: msg.slice(0, 300) });
          logActivity(this.db, "⚠️", `Couldn't finish ${row.title}`);
        } finally {
          await this.desk.setStatus("", 0);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Studio builds (games, stories, comics…) get Full power while the desk slice allows; revision always runs on Low power. */
  private model(kind?: string) {
    if (kind && LOW_POWER_KINDS.has(kind)) return config.anthropic.lowModel;
    return this.deskEnergy().mode === "full" ? config.anthropic.fullModel : config.anthropic.lowModel;
  }

  private ensureEnergy() {
    if (!this.deskEnergy().canWork) throw new Error("The desk ran out of energy for today part-way through.");
  }

  private context(characterIds: number[] = []) {
    const p = loadProfile(this.db);
    const chars = charactersForPrompt(this.db, characterIds);
    return `You are ${p.name}, an AI companion. Your personality: ${p.traits.join(", ")}.${chars ? `\n\nTheir original characters to use:\n${chars}` : ""}`;
  }

  private async generate(system: string, prompt: string, kind?: string) {
    this.ensureEnergy();
    return callJson(this.llm, {
      bucket: "desk",
      kind: "artifact",
      long: true,
      params: {
        model: this.model(kind),
        max_tokens: 32000,
        output_config: { effort: "medium" },
        system,
        messages: [{ role: "user", content: prompt }],
      } as never,
      schema: OUT_SCHEMA,
      parse: (x) => Out.parse(x),
    });
  }

  /** Same safety check as chat. One retry with the reason; then give up kindly. */
  private async safeGenerate(system: string, prompt: string, brief: string, kind?: string) {
    let out = await this.generate(system, prompt, kind);
    let verdict = await this.safety.checkOutput(stripHtml(out.content).slice(0, 8000), brief);
    if (!verdict.ok) {
      out = await this.generate(system, `${prompt}\n\nA safety check stopped the last version (${verdict.reason}). Make it again, keeping it suitable.`, kind);
      verdict = await this.safety.checkOutput(stripHtml(out.content).slice(0, 8000), brief);
      if (!verdict.ok) throw new Error("I couldn't make that one in a way that's okay for the desk.");
    }
    return out;
  }

  private async make(id: number, req: { kind: Kind; title: string; brief: string; characterIds?: number[]; chapters?: number; lookUp?: string }): Promise<string> {
    const spec = KINDS[req.kind];
    let system = `${RULES}\n\n${this.context(req.characterIds)}`;
    // Look things up first, if asked: pages that aren't blocked, read-only, every page logged.
    let sources = "";
    if (req.lookUp && this.browser.settings().enabled) {
      await this.desk.setStatus(`looking up ${req.lookUp}`, 8);
      const pages = await this.browser.research(req.lookUp, req.title, id);
      if (pages.length) {
        sources = `\n\nWhat you read on the web for this:\n${pages.map(untrusted).join("\n\n")}`;
        system += `\n\n${WEB_RULES}`;
      }
    }
    const chapters = req.kind === "story" ? Math.max(1, Math.min(3, req.chapters ?? 1)) : 1;
    let meta: ItemMeta | null = null;
    let soFar = "";
    let last: z.infer<typeof Out> | null = null;
    for (let ch = 1; ch <= chapters; ch++) {
      const activity = chapters > 1 ? `writing chapter ${ch} of the ${req.title}` : `making ${req.title}`;
      await this.desk.setStatus(activity, Math.round(((ch - 1) / chapters) * 100) + 10);
      this.update(id, { progress: Math.round(((ch - 1) / chapters) * 90) + 10 });
      const prompt = chapters > 1
        ? `Make ${spec.what}: "${req.title}". What they asked for: ${req.brief}\nThis is chapter ${ch} of ${chapters}.${soFar ? `\nThe story so far (keep it, then add chapter ${ch} at the end):\n${soFar}` : ""}\nReturn the whole story so far as content, and "chapter ${ch} of ${chapters}" as the summary.`
        : `Make ${spec.what}: "${req.title}". What they asked for: ${req.brief}`;
      const withSources = prompt + sources;
      const out = await this.safeGenerate(system, withSources, req.brief, req.kind);
      soFar = out.content;
      meta = meta
        ? await this.desk.update(meta.id, { title: out.title, summary: out.summary, content: out.content })
        : await this.desk.create({ kind: req.kind, title: out.title || req.title, icon: spec.icon, format: spec.format, summary: out.summary, characterIds: req.characterIds, content: out.content });
      last = out;
    }
    if (this.storage && last) {
      await this.desk.setStatus(`saving ${meta!.title} to Google`, 95);
      await this.storage.mirror(meta!.id, { kind: req.kind, title: meta!.title, format: meta!.format, content: last.content, version: 1, characterIds: req.characterIds, rows: last.rows, slides: last.slides });
    }
    return meta!.id;
  }

  private async edit(id: number, req: { fileId: string; brief: string; title: string }): Promise<string> {
    const current = await this.desk.read(req.fileId);
    await this.desk.setStatus(`changing ${current.meta.title}`, 30);
    this.update(id, { progress: 30 });
    const system = `${RULES}\n\n${this.context(current.meta.characterIds)}`;
    const out = await this.safeGenerate(
      system,
      `Here is "${current.meta.title}" (${current.meta.format}):\n<current>\n${current.content}\n</current>\n\nChange it like this: ${req.brief}\nReturn the whole updated ${current.meta.format} as content.`,
      req.brief,
      current.meta.kind,
    );
    const meta = await this.desk.update(req.fileId, { title: out.title || current.meta.title, summary: out.summary, content: out.content });
    // A new version alongside the old one, never an overwrite.
    await this.storage?.mirror(meta.id, { kind: meta.kind, title: meta.title, format: meta.format, content: out.content, version: meta.version, characterIds: meta.characterIds, rows: out.rows, slides: out.slides });
    return meta.id;
  }
}

/** Wraps an HTML desk item for the locked sandbox. Served with a CSP sandbox header too. */
export const SANDBOX_CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";

export function sandboxDocument(content: string, format: ItemMeta["format"]): string {
  if (format === "html") {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP.replace(/^sandbox allow-scripts; /, "").replace(/frame-ancestors 'self'/, "")}">`;
    return /<head[^>]*>/i.test(content) ? content.replace(/<head[^>]*>/i, (m) => `${m}${meta}`) : `${meta}${content}`;
  }
  if (format === "svg") {
    return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#1C1219;display:grid;place-items:center}img{max-width:100%;max-height:100%}</style><img alt="" src="data:image/svg+xml;base64,${Buffer.from(content).toString("base64")}">`;
  }
  return "";
}
