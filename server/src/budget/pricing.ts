// US dollars per million tokens, from Anthropic's price list (checked November 2026).
// Update these if prices change: the energy bar and the parent's money view both come from here.

export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }

export const PRICES: Record<string, Price> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

// Used for an unknown model so spending is over-counted rather than under-counted.
const FALLBACK: Price = { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 };

export interface UsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costUsd(model: string, usage: UsageLike): number {
  const p = PRICES[model] ?? FALLBACK;
  const m = 1_000_000;
  return (
    ((usage.input_tokens ?? 0) * p.input) / m +
    ((usage.output_tokens ?? 0) * p.output) / m +
    ((usage.cache_read_input_tokens ?? 0) * p.cacheRead) / m +
    ((usage.cache_creation_input_tokens ?? 0) * p.cacheWrite) / m
  );
}
