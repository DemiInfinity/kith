// Round thumbnails for characters made without one (for example in chat, where the server can't
// draw 3D): drawn here once, off screen, one at a time, then saved on the character.

import { api, type Character } from "../api";
import { loadEngine } from "./Stage";
import { normaliseLook, NEW_CHARACTER, type Look } from "./look";

/** Thumbnails are capped on the server (about 120 kB); a smaller size is tried if one is too big. */
const MAX_CHARS = 155_000;

let queue: Promise<unknown> = Promise.resolve();

/** A PNG data URL of the look's head and shoulders, or null when WebGL isn't there. */
export function renderThumb(look: Look, px = 200): Promise<string | null> {
  const job = queue.then(async () => {
    const m = await loadEngine();
    if (!m.webglAvailable()) return null;
    const box = document.createElement("div");
    box.setAttribute("aria-hidden", "true");
    box.style.cssText = `position:fixed;left:-10000px;top:0;width:${px}px;height:${px}px;pointer-events:none;opacity:0`;
    const canvas = document.createElement("canvas");
    box.appendChild(canvas);
    document.body.appendChild(box);
    const stage = m.createPipStage(canvas, look, { still: true, active: false });
    try {
      for (const size of [px, Math.round(px * 0.8), Math.round(px * 0.64)]) {
        const url = stage.snapshot("portrait", size, false).toDataURL("image/png");
        if (url.length <= MAX_CHARS) return url;
      }
      return null;
    } finally {
      stage.dispose();
      box.remove();
    }
  });
  queue = job.catch(() => undefined);
  return job.catch(() => null);
}

const tried = new Set<number>();
/** Makes and saves a thumbnail for a character that has none (once per visit). Returns it. */
export async function ensureThumb(c: Character): Promise<string | null> {
  if (c.sheet.thumb) return c.sheet.thumb;
  if (tried.has(c.id)) return null;
  tried.add(c.id);
  const thumb = await renderThumb(normaliseLook(c.sheet.model ?? { ...NEW_CHARACTER, name: c.sheet.name.slice(0, 20) }));
  if (!thumb) return null;
  try {
    await api(`/api/oc/characters/${c.id}`, { method: "PUT", body: { thumb } });
  } catch { /* shown this time; tried again next visit */ }
  return thumb;
}
