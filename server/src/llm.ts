// The only place that talks to the Claude API. The API key stays on the server.
// Every call is costed into the spend ledger, so the energy bar and the parent's money view are
// always up to date.

import Anthropic from "@anthropic-ai/sdk";
import type { DB } from "./db.js";
import { cancelSpend, reserveSpend, settleSpend, type Bucket, type SpendKind } from "./budget/budget.js";
import { estimateCostUsd, type UsageLike } from "./budget/pricing.js";

export class OfflineError extends Error {
  constructor() {
    super("No Anthropic API key is set, so the companion can't think yet.");
  }
}

export interface CallOpts {
  bucket: Bucket;
  kind: SpendKind;
  params: Anthropic.MessageCreateParamsNonStreaming;
  /** Stream under the hood (for long outputs such as desk artifacts). */
  long?: boolean;
}

export interface LLM {
  readonly available: boolean;
  call(opts: CallOpts): Promise<Anthropic.Message>;
  setKey?(apiKey: string): void;
}

export class AnthropicLLM implements LLM {
  private client: Anthropic | null = null;
  constructor(private db: DB, apiKey: string) {
    this.setKey(apiKey);
  }
  /** Switches to a new key straight away (the parent can set it in the parent view). */
  setKey(apiKey: string) {
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 }) : null;
  }
  get available() {
    return this.client !== null;
  }
  async call({ bucket, kind, params, long }: CallOpts): Promise<Anthropic.Message> {
    if (!this.client) throw new OfflineError();
    return metered(this.db, { bucket, kind, params }, async (seen) => {
      if (!long) return this.client!.messages.create(params);
      const stream = this.client!.messages.stream(params);
      stream.on("streamEvent", () => { seen.usage = stream.currentMessage?.usage; });
      return stream.finalMessage();
    });
  }
}

/**
 * Books a call's worst-case cost before it's made and settles it afterwards. A call that fails
 * after Claude started on it (a timeout, a dropped connection, a stream that broke part-way) may
 * still be billed, so it's counted at the best estimate: the usage seen so far, or the worst case.
 * A call the API refused outright (an HTTP error status) isn't billed and isn't counted.
 */
export async function metered(
  db: DB, opts: { bucket: Bucket; kind: SpendKind; params: Anthropic.MessageCreateParamsNonStreaming },
  run: (seen: { usage?: UsageLike }) => Promise<Anthropic.Message>,
): Promise<Anthropic.Message> {
  const { model } = opts.params;
  const worst = estimateCostUsd(opts.params as never);
  const id = reserveSpend(db, { bucket: opts.bucket, kind: opts.kind, model, usd: worst });
  const seen: { usage?: UsageLike } = {};
  try {
    const msg = await run(seen);
    settleSpend(db, id, model, msg.usage);
    return msg;
  } catch (err) {
    const refused = err instanceof Anthropic.APIError && typeof err.status === "number";
    if (refused) cancelSpend(db, id);
    else if (seen.usage && (seen.usage.input_tokens ?? 0) > 0) {
      // Part of a stream arrived: what it used so far, and no less than its input.
      settleSpend(db, id, model, seen.usage);
    }
    // Otherwise the worst-case reservation stands.
    throw err;
  }
}

export function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Ask for JSON matching a schema (structured outputs) and parse it. */
export async function callJson<T>(
  llm: LLM,
  opts: Omit<CallOpts, "params"> & {
    params: Anthropic.MessageCreateParamsNonStreaming;
    schema: Record<string, unknown>;
    parse: (v: unknown) => T;
  },
): Promise<T> {
  const msg = await llm.call({
    ...opts,
    params: {
      ...opts.params,
      output_config: {
        ...((opts.params as { output_config?: Record<string, unknown> }).output_config ?? {}),
        format: { type: "json_schema", schema: opts.schema },
      },
    } as Anthropic.MessageCreateParamsNonStreaming,
  });
  if (msg.stop_reason === "refusal") throw new Error("The safety check model declined to answer.");
  return opts.parse(JSON.parse(textOf(msg)));
}
