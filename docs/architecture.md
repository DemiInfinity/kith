# How Kith fits together

```
 phone / Mac (React PWA)
        │  https, session cookie (HttpOnly), X-Kith header on changes
        ▼
 kith server (Fastify, TypeScript) ── SQLite (/data)
   ├─ sign-in: OpenID Connect (PKCE, state, nonce), configured people only
   ├─ chat turn: safety in → redact → energy → Claude (tools) → safety out → tell first → report
   ├─ budgets: spend ledger (every call costed) → energy (child) / money (parent)
   ├─ connections: parent-approved tools (HA REST, Kin/MCP, Jellyfin, calculator, dictionary, websites)
   ├─ studio: desk jobs (desk budget) ──────────────▶ desk container (internal network, no internet)
   ├─ voice: Wyoming client ─▶ whisper (speech-to-text), piper (text-to-speech)
   ├─ scheduler: check-ins (web push), journal, weekly summary, retention, report retries
   └─ reporters: console, Home Assistant AI board, …
        │
        ▼
 Claude API (server only): Sonnet 5.5 (Full power), Haiku 5.5 (Low power + safety check)
```

## Layout

| Path | What |
|---|---|
| `server/src/companion/` | the chat turn, prompts, memory, built-in tools |
| `server/src/safety/` | fixed rules and the separate safety check |
| `server/src/budget/` | pricing, energy, time zones |
| `server/src/connections/` | parent-approved connections |
| `server/src/desk/` | the Studio, the OC workshop, the desk client |
| `server/src/voice/` | the Wyoming protocol client |
| `server/src/checkins/` | check-in rules and web push |
| `server/src/reporting/` | reporters |
| `desk/` | the desk service (file store + safety scan), no dependencies |
| `client/` | the React app (Vite), phone and Mac layouts in one |

## Claude API notes

- **SDK:** the official `@anthropic-ai/sdk`, server side only. `server/src/llm.ts` is the only place that talks to it,
  and it records the cost of every call.
- **Chat:**
  - Effort `low`, adaptive thinking (the model default).
  - Prompt caching on the stable part of the system prompt (rules + personality). Memories and the time go in a second,
    uncached block.
- **Operator notes:** per-turn guidance from the safety check, and the "tell them first" instruction, are added as a
  mid-conversation `role: "system"` message after the child's message. The history stays append-only within a turn's
  tool loop.
- **History between turns:** earlier turns are replayed as plain text, without thinking blocks. That's an allowed form
  under the API's history-editing check (dropping all earlier thinking blocks).
- **Safety check:** structured outputs (`output_config.format` with a JSON schema) on Claude Haiku 5.5.
- **Desk items:** streamed (`messages.stream(...).finalMessage()`) because they can be long.
- **Refusals:** `stop_reason: "refusal"` is treated as "held back". No server-side fallback to another model is turned
  on: for a child's companion, a decline should stay declined.

## Making the Mac app

See [macos.md](macos.md). The client is a plain static build talking to the server over same-origin `/api`, or to
`VITE_KITH_API` when it's wrapped.
