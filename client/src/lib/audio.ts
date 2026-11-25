// Voice in and out for calls. The microphone audio is held in memory, turned into 16 kHz mono
// PCM and sent to the home server for speech-to-text. Nothing is recorded or saved.

export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private heardSpeech = false;
  private quietSince = 0;
  onLevel: (rms: number) => void = () => {};
  /** Called when they stop talking (after some speech, ~1.2 s of quiet). */
  onSilence: () => void = () => {};

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule("/pcm-worklet.js");
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-collector");
    this.chunks = [];
    this.heardSpeech = false;
    this.quietSince = 0;
    this.node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; rms: number }>) => {
      this.chunks.push(e.data.samples);
      this.onLevel(e.data.rms);
      const now = performance.now();
      if (e.data.rms > 0.03) { this.heardSpeech = true; this.quietSince = 0; }
      else if (this.heardSpeech) {
        if (!this.quietSince) this.quietSince = now;
        else if (now - this.quietSince > 1200) { this.heardSpeech = false; this.onSilence(); }
      }
    };
    src.connect(this.node);
  }

  /** Stops the mic and returns 16 kHz, 16-bit mono PCM. */
  async stop(): Promise<ArrayBuffer> {
    const rate = this.ctx?.sampleRate ?? 48000;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.disconnect();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) { all.set(c, o); o += c.length; }
    this.chunks = [];
    return toPcm16(all, rate, 16000);
  }
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
export async function playWithMouth(wav: Blob, onMouth: (open: number) => void, signal?: AbortSignal): Promise<void> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await wav.arrayBuffer());
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
      signal?.addEventListener("abort", () => { try { src.stop(); } catch { /* already stopped */ } resolve(); });
      src.start();
      frame();
    });
    cancelAnimationFrame(raf);
    onMouth(0);
  } finally {
    await ctx.close().catch(() => undefined);
  }
}
