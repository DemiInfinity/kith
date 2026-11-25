// The voice setup in use: the parent view's settings where set, otherwise the server's .env.

import type { DB } from "../db.js";
import { config } from "../config.js";
import { loadParentSettings } from "../settings.js";
import { encodeEvent, exchange } from "./wyoming.js";

export function voiceSetup(db: DB) {
  const v = loadParentSettings(db).voice;
  return {
    sttHost: v.sttHost || config.voice.sttHost,
    sttPort: v.sttPort || config.voice.sttPort,
    ttsHost: v.ttsHost || config.voice.ttsHost,
    ttsPort: v.ttsPort || config.voice.ttsPort,
    language: config.voice.language,
    whisperModel: v.whisperModel,
    voices: v.voices.length ? v.voices : config.voice.voices,
  };
}

/** Asks a Wyoming server what it has ("describe" → "info"). */
export async function describe(host: string, port: number): Promise<{ ok: boolean; names: string[]; installed: string[]; error?: string }> {
  try {
    const got = await exchange(host, port, [encodeEvent("describe")], (e) => e.type === "info", 5000);
    const info = got.find((e) => e.type === "info")?.data ?? {};
    const names: string[] = [];
    const installed: string[] = [];
    for (const group of [...((info.asr as unknown[]) ?? []), ...((info.tts as unknown[]) ?? [])] as { models?: { name: string; installed?: boolean }[]; voices?: { name: string; installed?: boolean }[] }[]) {
      for (const m of [...(group.models ?? []), ...(group.voices ?? [])]) {
        names.push(m.name);
        if (m.installed) installed.push(m.name);
      }
    }
    return { ok: true, names, installed };
  } catch (err) {
    return { ok: false, names: [], installed: [], error: (err as Error).message };
  }
}
