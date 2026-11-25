// A character card: the full-body picture and their sheet in one PNG, to keep or share.

import type { PipStage } from "./engine";
import { OUTFIT, PALETTES, speciesGuess, type Look } from "./look";

export interface CardSheet { species?: string; pronouns?: string; age?: string; traits?: string[]; likes?: string; dislikes?: string; catchphrase?: string; backstory?: string }

export async function characterCard(stage: PipStage, look: Look, name: string, sh: CardSheet): Promise<HTMLCanvasElement> {
  try { await document.fonts.ready; } catch { /* the default fonts will do */ }
  const W = 1080, H = 1350, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  if (!g) throw new Error("no canvas");
  const accent = look.kind === "chibi" ? OUTFIT[look.outfit] : PALETTES[look.palette].c[1];
  g.fillStyle = "#1C1219"; g.fillRect(0, 0, W, H);
  const rg = g.createRadialGradient(W / 2, 380, 0, W / 2, 380, 620); rg.addColorStop(0, accent + "88"); rg.addColorStop(1, accent + "00");
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  const pic = stage.snapshot("full", 720, true), ph = 760, pw = (ph * pic.width) / pic.height;
  g.drawImage(pic, (W - pw) / 2, 30, pw, ph);
  let y = 860; const x0 = 80, maxW = W - 160;
  g.fillStyle = "#FBEAF6"; g.font = "700 76px 'Fraunces Variable', Fraunces, Georgia, serif"; g.textBaseline = "alphabetic"; g.fillText(name || "Unnamed", x0, y, maxW);
  y += 50; g.font = "800 30px 'Nunito Variable', Nunito, sans-serif"; g.fillStyle = "#D8C2D2";
  g.fillText([sh.species || speciesGuess(look), sh.pronouns, sh.age && `age ${sh.age}`].filter(Boolean).join("  ·  "), x0, y, maxW);
  const traits = sh.traits ?? [];
  if (traits.length) {
    y += 26; let x = x0; g.font = "800 24px 'Nunito Variable', Nunito, sans-serif";
    for (const t of traits) {
      const tw = g.measureText(t).width + 32;
      if (x + tw > x0 + maxW) { x = x0; y += 50; }
      g.fillStyle = "rgba(231,180,238,.18)"; g.beginPath(); g.roundRect(x, y, tw, 40, 20); g.fill();
      g.fillStyle = "#E7B4EE"; g.fillText(t, x + 16, y + 28); x += tw + 10;
    }
    y += 40;
  }
  g.font = "700 26px 'Nunito Variable', Nunito, sans-serif";
  for (const [k, v] of [["Likes", sh.likes], ["Dislikes", sh.dislikes]] as const) if (v) {
    y += 44; g.fillStyle = "#B79CB0"; g.fillText(`${k}:`, x0, y);
    const kw = g.measureText(`${k}: `).width; g.fillStyle = "#FBEAF6"; g.fillText(v, x0 + kw, y, maxW - kw);
  }
  if (sh.catchphrase) { y += 56; g.font = "italic 600 32px 'Fraunces Variable', Fraunces, Georgia, serif"; g.fillStyle = "#E7B4EE"; g.fillText(`“${sh.catchphrase}”`, x0, y, maxW); }
  if (sh.backstory) {
    y += 52; g.font = "600 25px 'Nunito Variable', Nunito, sans-serif"; g.fillStyle = "#E9DCE6";
    const lh = 36, maxY = H - 70, words = sh.backstory.replace(/\s+/g, " ").split(" ");
    let line: string | null = "";
    for (const w of words) {
      const test: string = line ? `${line} ${w}` : w;
      if (g.measureText(test).width > maxW) {
        if (y + lh > maxY) { g.fillText(`${line!.replace(/[,.;:]?$/, "")}…`, x0, y); line = null; break; }
        g.fillText(line!, x0, y); y += lh; line = w;
      } else line = test;
    }
    if (line) g.fillText(line, x0, y);
  }
  g.font = "800 20px 'Nunito Variable', Nunito, sans-serif"; g.fillStyle = "#8F7489"; g.textAlign = "right"; g.fillText("made in Kith", W - 40, H - 30); g.textAlign = "left";
  return cv;
}
