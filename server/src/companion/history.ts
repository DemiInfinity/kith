// The chat history archive. When a conversation is compacted (older messages folded into a short
// summary to save tokens), the full text of those messages is written to a Markdown file here.
// Normal chatting never sends these files: the companion only searches them, with the
// recall_history tool, when the child asks it to remember something from before.
// They live on the home server only, only the child can read them, and they're deleted with chats
// after the retention period.

import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { localDate } from "../budget/time.js";

export interface HistoryFile { file: string; thread: number; from: string; to: string; title: string; size: number; mtime: number }

export function historyDir(base = config.dataDir) {
  return path.join(base, "history");
}

const SAFE = /^thread-\d+\/[0-9a-z-]+\.md$/;

/** Writes one compacted chapter. Returns its relative path. */
export function writeHistory(
  opts: { thread: number; threadTitle: string; companionName: string; childName: string; summary: string; messages: { id: number; ts: number; role: string; text: string }[] },
  base = config.dataDir,
): string {
  const msgs = opts.messages;
  if (!msgs.length) return "";
  const tz = config.timezone;
  const from = localDate(msgs[0].ts, tz);
  const to = localDate(msgs[msgs.length - 1].ts, tz);
  const rel = `thread-${opts.thread}/${from}-${msgs[0].id}-${msgs[msgs.length - 1].id}.md`;
  const time = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  let day = "";
  const lines: string[] = [];
  for (const m of msgs) {
    const d = localDate(m.ts, tz);
    if (d !== day) {
      day = d;
      lines.push(`\n## ${d}\n`);
    }
    const who = m.role === "child" ? opts.childName || "Me" : opts.companionName;
    lines.push(`**${who}** _${time(m.ts)}_  \n${m.text.replace(/\n/g, "  \n")}\n`);
  }
  const md = `# ${opts.threadTitle}: ${from === to ? from : `${from} to ${to}`}\n\n> In short: ${opts.summary.replace(/\n/g, " ")}\n${lines.join("\n")}\n`;
  const file = path.join(historyDir(base), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, md);
  return rel;
}

export function listHistory(base = config.dataDir): HistoryFile[] {
  const dir = historyDir(base);
  if (!fs.existsSync(dir)) return [];
  const out: HistoryFile[] = [];
  for (const t of fs.readdirSync(dir)) {
    const m = /^thread-(\d+)$/.exec(t);
    if (!m) continue;
    for (const f of fs.readdirSync(path.join(dir, t))) {
      if (!f.endsWith(".md")) continue;
      const full = path.join(dir, t, f);
      const st = fs.statSync(full);
      const text = fs.readFileSync(full, "utf8");
      const first = text.split("\n", 1)[0].replace(/^# /, "");
      const date = /^\d{4}-\d{2}-\d{2}/.test(f) ? f.slice(0, 10) : "";
      // The chapter ends on its last day heading.
      const days = text.match(/^## \d{4}-\d{2}-\d{2}$/gm);
      const to = days ? days[days.length - 1].slice(3) : date;
      out.push({ file: `${t}/${f}`, thread: Number(m[1]), from: date, to, title: first, size: st.size, mtime: st.mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export function readHistory(rel: string, base = config.dataDir): string | null {
  if (!SAFE.test(rel)) return null;
  const full = path.join(historyDir(base), rel);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

/**
 * Finds the parts of the archive that match a question. Simple and local: scores each day's section
 * by how many of the query's words it contains, and returns the best few, trimmed.
 */
export function searchHistory(query: string, base = config.dataDir, limit = 3, maxChars = 3500): { file: string; excerpt: string; score: number }[] {
  const words = query.toLowerCase().match(/[a-z0-9']{3,}/g)?.filter((w) => !STOP.has(w)) ?? [];
  if (!words.length) return [];
  const hits: { file: string; excerpt: string; score: number }[] = [];
  for (const h of listHistory(base)) {
    const text = readHistory(h.file, base) ?? "";
    for (const section of text.split(/\n(?=## )/)) {
      const low = section.toLowerCase();
      const score = words.reduce((t, w) => t + (low.includes(w) ? 1 + Math.min(3, low.split(w).length - 2) * 0.25 : 0), 0);
      if (score > 0) hits.push({ file: h.file, excerpt: section.trim(), score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  let budget = maxChars;
  const out: typeof hits = [];
  for (const h of hits.slice(0, limit)) {
    if (budget <= 200) break;
    const excerpt = h.excerpt.slice(0, Math.min(budget, 1600));
    budget -= excerpt.length;
    out.push({ ...h, excerpt });
  }
  return out;
}

/**
 * Deletes archived chapters whose last day is older than the retention period (same rule as
 * chats). It goes by the chapter's own dates, not the file's time, which a copy or restore resets.
 */
export function purgeHistory(retentionDays: number, now = Date.now(), base = config.dataDir) {
  const cutoff = now - retentionDays * 86_400_000;
  const cutoffDay = localDate(cutoff, config.timezone);
  for (const h of listHistory(base)) {
    const old = h.to ? h.to < cutoffDay : h.mtime < cutoff;
    if (old) fs.rmSync(path.join(historyDir(base), h.file), { force: true });
  }
}

const STOP = new Set(["the", "and", "you", "that", "was", "what", "when", "did", "about", "remember", "said", "with", "for", "this", "have", "were", "our", "your", "can", "how", "talk", "talked", "chat", "chatted", "time", "last", "before", "ago", "week"]);
