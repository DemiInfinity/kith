// Small sounds for calls, made in code with the Web Audio API (no sound files). Each plays through
// the AudioContext it's given, so it comes out wherever the call's voice does.

/** One soft note: a sine with a gentle start and a long fade, so it never clicks. */
function note(ctx: AudioContext, freq: number, at: number, length: number, volume: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/**
 * "Call ended": two gentle falling notes (G5 then D5), about half a second, at a modest volume.
 * Returns how long it lasts in ms (0 if it couldn't play), so the context isn't closed under it.
 */
export function playHangUp(ctx: AudioContext | null): number {
  if (!ctx || ctx.state !== "running") return 0;
  try {
    const t = ctx.currentTime + 0.01;
    note(ctx, 784, t, 0.24, 0.12);
    note(ctx, 587.33, t + 0.2, 0.32, 0.12);
    return 560;
  } catch {
    return 0;
  }
}
