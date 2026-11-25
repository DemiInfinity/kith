// A minimal Wyoming protocol client (the protocol Home Assistant uses for local voice).
// An event is one JSON line: {"type", "data"?, "data_length"?, "payload_length"?}\n,
// then `data_length` bytes of extra JSON data, then `payload_length` bytes of payload (audio).
// Audio stays in memory only: nothing is written to disk.

import net from "node:net";

export interface WyomingEvent { type: string; data: Record<string, unknown>; payload?: Buffer }

export function encodeEvent(type: string, data: Record<string, unknown> = {}, payload?: Buffer): Buffer {
  const dataBuf = Buffer.from(JSON.stringify(data), "utf8");
  const header: Record<string, unknown> = { type, data_length: dataBuf.length };
  if (payload?.length) header.payload_length = payload.length;
  return Buffer.concat([Buffer.from(JSON.stringify(header) + "\n", "utf8"), dataBuf, payload ?? Buffer.alloc(0)]);
}

/** Incremental parser: feed it chunks from the socket, get whole events out. */
export class EventParser {
  private buf = Buffer.alloc(0);
  push(chunk: Buffer): WyomingEvent[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: WyomingEvent[] = [];
    for (;;) {
      const nl = this.buf.indexOf(0x0a);
      if (nl < 0) break;
      const header = JSON.parse(this.buf.subarray(0, nl).toString("utf8")) as {
        type: string; data?: Record<string, unknown>; data_length?: number; payload_length?: number;
      };
      const dl = header.data_length ?? 0;
      const pl = header.payload_length ?? 0;
      if (this.buf.length < nl + 1 + dl + pl) break;
      let data = header.data ?? {};
      if (dl) data = { ...data, ...JSON.parse(this.buf.subarray(nl + 1, nl + 1 + dl).toString("utf8")) };
      const payload = pl ? Buffer.from(this.buf.subarray(nl + 1 + dl, nl + 1 + dl + pl)) : undefined;
      out.push({ type: header.type, data, payload });
      this.buf = this.buf.subarray(nl + 1 + dl + pl);
    }
    return out;
  }
}

/** Open a connection, send events, and collect events until `done` says stop. */
export function exchange(
  host: string, port: number, events: Buffer[], done: (e: WyomingEvent) => boolean, timeoutMs = 30_000,
): Promise<WyomingEvent[]> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    const parser = new EventParser();
    const got: WyomingEvent[] = [];
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("Voice service timed out")); }, timeoutMs);
    sock.on("connect", () => { for (const e of events) sock.write(e); });
    sock.on("data", (chunk) => {
      try {
        for (const e of parser.push(chunk)) {
          got.push(e);
          if (done(e)) { clearTimeout(timer); sock.end(); resolve(got); return; }
        }
      } catch (err) { clearTimeout(timer); sock.destroy(); reject(err); }
    });
    sock.on("error", (err) => { clearTimeout(timer); reject(new Error(`Voice service unavailable (${err.message})`)); });
    sock.on("close", () => { clearTimeout(timer); resolve(got); });
  });
}

/** Speech to text: 16 kHz, 16-bit mono PCM in, text out. */
export async function transcribe(host: string, port: number, pcm: Buffer, language = "en"): Promise<string> {
  const fmt = { rate: 16000, width: 2, channels: 1 };
  const events = [encodeEvent("transcribe", { language }), encodeEvent("audio-start", fmt)];
  const CHUNK = 16000 * 2; // one second
  for (let i = 0; i < pcm.length; i += CHUNK) events.push(encodeEvent("audio-chunk", fmt, pcm.subarray(i, i + CHUNK)));
  events.push(encodeEvent("audio-stop", {}));
  const got = await exchange(host, port, events, (e) => e.type === "transcript", 60_000);
  const t = got.find((e) => e.type === "transcript");
  if (!t) throw new Error("No transcript came back");
  return String(t.data.text ?? "").trim();
}

/** Text to speech with Piper: returns a WAV file. */
export async function synthesize(host: string, port: number, text: string, voice: string): Promise<Buffer> {
  const got = await exchange(host, port, [encodeEvent("synthesize", { text, voice: { name: voice } })], (e) => e.type === "audio-stop", 60_000);
  const start = got.find((e) => e.type === "audio-start");
  if (!start) throw new Error("No audio came back");
  const pcm = Buffer.concat(got.filter((e) => e.type === "audio-chunk" && e.payload).map((e) => e.payload!));
  return wav(pcm, Number(start.data.rate ?? 22050), Number(start.data.width ?? 2), Number(start.data.channels ?? 1));
}

export function wav(pcm: Buffer, rate: number, width: number, channels: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * width * channels, 28); h.writeUInt16LE(width * channels, 32); h.writeUInt16LE(width * 8, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Text for speaking: drop emoji and markdown so the voice reads it naturally. */
export function speakable(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️/gu, "")
    .replace(/[*_#`>~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
