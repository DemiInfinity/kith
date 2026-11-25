// The only place that talks to the Claude API. The API key stays on the server.
// Every call is costed into the spend ledger, so the energy bar and the parent's money view are
// always up to date.

import Anthropic from "@anthropic-ai/sdk";
import type { DB } from "./db.js";
import { recordSpend, type Bucket, type SpendKind } from "./budget/budget.js";

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
}

export class AnthropicLLM implements LLM {
  private client: Anthropic | null;
  constructor(private db: DB, apiKey: string) {
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 }) : null;
  }
  get available() {
    return this.client !== null;
  }
  async call({ bucket, kind, params, long }: CallOpts): Promise<Anthropic.Message> {
    if (!this.client) throw new OfflineError();
    const msg = long
      ? await this.client.messages.stream(params).finalMessage()
      : await this.client.messages.create(params);
    recordSpend(this.db, { bucket, kind, model: params.model, usage: msg.usage });
    return msg;
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
