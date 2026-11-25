// Voice in and out for calls. The microphone audio is held in memory, turned into 16 kHz mono
// PCM and sent to the home server for speech-to-text. Nothing is recorded or saved.

/** An AudioContext made (and resumed) inside a tap, which iOS Safari needs before it plays or records.
 *  Calls make one when the mic is first tapped (or on opening the call, if the browser allows it
 *  then) and reuse it for listening and speaking. */
export function audioContextFromTap(existing: AudioContext | null): AudioContext {
  const ctx = existing && existing.state !== "closed" ? existing : new AudioContext();
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/**
 * The microphone, open for a call. Each small frame of audio (and how loud it is) goes to onFrame;
 * what's kept for a turn is decided by the call (vad.ts). Stopping it releases the microphone, so the
 * system's "mic on" light goes off.
 */
export class MicStream {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  /** Bumped by stop(), so a start() still waiting for the microphone gives it straight back. */
  private gen = 0;
  onFrame: (samples: Float32Array, rms: number) => void = () => {};

  get sampleRate(): number { return this.ctx?.sampleRate ?? 48000; }
  get open(): boolean { return this.stream !== null; }

  /** Starts listening, on the call's AudioContext (made in a tap). */
  async start(ctx: AudioContext) {
    const gen = ++this.gen;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    if (gen !== this.gen) { stream.getTracks().forEach((t) => t.stop()); return; }
    this.stream = stream;
    try {
      this.ctx = ctx;
      if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
      await ctx.audioWorklet.addModule("/pcm-worklet.js");
    } catch (e) {
      // Don't leave the microphone on (and its indicator showing) if the worklet couldn't load.
      this.stop();
      throw e;
    }
    if (gen !== this.gen || !this.stream) return; // stopped while it was starting
    const src = ctx.createMediaStreamSource(this.stream);
    this.src = src;
    this.node = new AudioWorkletNode(ctx, "pcm-collector");
    this.node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; rms: number }>) => this.onFrame(e.data.samples, e.data.rms);
    src.connect(this.node);
  }

  stop() {
    this.gen++;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.src?.disconnect();
    this.src = null;
    if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); this.node = null; }
    this.ctx = null;
  }
}

/** A turn's frames as 16 kHz, 16-bit mono PCM for speech-to-text. */
export function joinPcm(chunks: Float32Array[], rate: number): ArrayBuffer {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return toPcm16(all, rate, 16000);
}

export function toPcm16(input: Float32Array, fromRate: number, toRate: number): ArrayBuffer {
  const ratio = fromRate / toRate;
  const len = Math.floor(input.length / ratio);
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    // average the samples that fall into this output sample (a simple low-pass)
    const start = Math.floor(i * ratio), end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out.buffer;
}

/** Plays a WAV and reports how loud it is, frame by frame, so the avatar's mouth can follow. */
export async function playWithMouth(wav: Blob, onMouth: (open: number) => void, signal?: AbortSignal, shared?: AudioContext): Promise<void> {
  const ctx = shared && shared.state !== "closed" ? shared : new AudioContext();
  try {
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    // Never hang silently: if the browser won't let sound start, say so instead of waiting forever.
    if (ctx.state !== "running") throw new Error("sound-blocked");
    const buf = await ctx.decodeAudioData(await wav.arrayBuffer());
    if (signal?.aborted) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    const data = new Uint8Array(analyser.fftSize);
    let smooth = 0;
    let raf = 0;
    const frame = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
      const rms = Math.sqrt(sum / data.length);
      const target = Math.min(1, rms * 5.5);
      smooth = smooth * 0.55 + target * 0.45;
      onMouth(smooth < 0.05 ? 0 : smooth);
      raf = requestAnimationFrame(frame);
    };
    await new Promise<void>((resolve) => {
      src.onended = () => resolve();
      signal?.addEventListener("abort", () => { try { src.stop(); } catch { /* already stopped */ } resolve(); }, { once: true });
      src.start();
      frame();
    });
    cancelAnimationFrame(raf);
    onMouth(0);
  } finally {
    if (ctx !== shared) await ctx.close().catch(() => undefined);
  }
}
