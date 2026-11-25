// Checking long text in full. The output check reads one piece of text at a time, so anything long
// (a desk game, a three-chapter story, a Google change) is split into chunks of about 7,000
// characters with no gaps between them, and every chunk is checked. Any chunk that fails fails the
// whole thing. Nothing is skipped because it's long.

import type { CheckOpts, SafetyChecker } from "./check.js";
import type { OutputVerdict } from "./types.js";

export const CHUNK_CHARS = 7000;

/**
 * Splits text into chunks of at most `size` characters that together hold every character, in
 * order. Breaks at a newline or space near the end of a chunk when there is one, so words aren't cut.
 */
export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      const sp = text.lastIndexOf(" ", end);
      const cut = Math.max(nl, sp);
      if (cut > i + size / 2) end = cut + 1;
    }
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

/** Checks every chunk of every piece of text. Empty pieces are skipped; nothing else is. */
export async function checkOutputAll(
  safety: SafetyChecker, texts: (string | undefined | null)[], childText: string, bucket: "chat" | "desk" = "chat", opts: CheckOpts = {},
): Promise<OutputVerdict> {
  const joined = texts.map((t) => (t ?? "").trim()).filter(Boolean).join("\n\n");
  if (!joined) return { ok: true, categories: [], reason: "Nothing to check." };
  for (const chunk of chunkText(joined)) {
    const v = await safety.checkOutput(chunk, childText, bucket, opts);
    if (!v.ok) return v;
  }
  return { ok: true, categories: [], reason: "" };
}

const decode = (s: string) => s
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, "&");

/** Every quoted string in a script or style: '…', "…" and `…` (template text included). */
export function stringLiterals(code: string): string[] {
  const out: string[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\[\s\S])*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const s = (m[1] ?? m[2] ?? m[3] ?? "")
      .replace(/\\u\{([0-9a-f]+)\}/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\n/g, "\n").replace(/\\(.)/g, "$1");
    if (/[A-Za-zÀ-￿]{2,}/.test(s)) out.push(s);
  }
  return out;
}

/**
 * All the words a desk item can show or say: the text between tags, text-bearing attributes
 * (alt, title, placeholder, value, aria-label, content), and every string literal inside its
 * scripts and styles (a game's dialogue usually lives in its JavaScript). Markdown is all text.
 */
export function visibleText(content: string, format: string): string {
  if (format === "md") return content;
  const parts: string[] = [];
  const scripts = /<(script|style)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = scripts.exec(content))) parts.push(...stringLiterals(m[2]));
  const attrs = /\b(?:alt|title|placeholder|value|aria-label|content|label|data-[\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  while ((m = attrs.exec(content))) { const v = m[2] ?? m[3] ?? ""; if (v.trim()) parts.push(decode(v)); }
  // Inline handlers (onclick="alert('…')") hold strings too.
  const handlers = /\bon\w+\s*=\s*("([^"]*)"|'([^']*)')/gi;
  while ((m = handlers.exec(content))) parts.push(...stringLiterals(decode(m[2] ?? m[3] ?? "")));
  const text = decode(content.replace(scripts, " ").replace(/<!--[\s\S]*?-->/g, (c) => ` ${c.slice(4, -3)} `).replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return [text, ...parts].filter((p) => p.trim()).join("\n");
}
