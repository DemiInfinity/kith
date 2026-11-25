// Parent-approved connections ("tools"). The parent keeps the allow-list; the child can't add
// anything. Each connection is "look" (read only) or "act" (can change things), and every use is
// logged for the parent view. Some things are never allowed, whatever the settings say:
// spending money, messaging people, posting online.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { DB } from "../db.js";
import { all, run } from "../db.js";
import { config } from "../config.js";
import type { Connection } from "../settings.js";
import { redactPersonal } from "../safety/rules.js";
import { calculate } from "./calculator.js";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  connection: string;
  level: "look" | "act";
  run(input: Record<string, unknown>): Promise<string>;
}

/** Never offered, whatever a connection says it can do. */
export const FORBIDDEN_TOOL = /(send|post|publish|message|messag|email|sms|text_?to|notify|announce|broadcast|tweet|share|purchase|buy|pay|order|checkout|transfer|subscribe|invite|call_?phone|delete_?account)/i;

export function isForbiddenTool(name: string) {
  return FORBIDDEN_TOOL.test(name);
}

const READ_ONLY_NAME = /^(get|list|search|read|find|lookup|query)[_A-Z]|^GetLiveContext$/;

export function hostAllowed(url: string, sites: string[]): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return sites.some((s) => {
    const site = s.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return host === site || host.endsWith("." + site);
  });
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const toolName = (conn: string, tool: string) => `${conn}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

// ── MCP ──────────────────────────────────────────────────────────────────────────────────────

const mcpClients = new Map<string, Promise<Client>>();

async function mcpClient(c: Connection): Promise<Client> {
  const key = `${c.id}|${c.url}`;
  let p = mcpClients.get(key);
  if (!p) {
    p = (async () => {
      const token = config.secret(c.tokenEnv);
      const transport = new StreamableHTTPClientTransport(new URL(c.url), {
        requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      });
      const client = new Client({ name: "kith", version: "0.1.0" });
      await client.connect(transport);
      return client;
    })();
    p.catch(() => mcpClients.delete(key));
    mcpClients.set(key, p);
  }
  return p;
}

async function mcpTools(c: Connection, log: Logger): Promise<ToolDef[]> {
  if (!c.url) return [];
  const client = await mcpClient(c);
  const { tools } = await client.listTools();
  return tools
    .filter((t) => c.allowedTools.includes(t.name) && !isForbiddenTool(t.name))
    .map((t) => {
      const readOnly = t.annotations?.readOnlyHint === true || READ_ONLY_NAME.test(t.name);
      const level: "look" | "act" = readOnly ? "look" : "act";
      return { t, level };
    })
    .filter(({ level }) => c.level === "act" || level === "look")
    .map(({ t, level }) => ({
      name: toolName(c.id, t.name),
      description: `[${c.name}] ${t.description ?? t.name}`.slice(0, 1000),
      input_schema: { properties: {}, ...(t.inputSchema as object), type: "object" as const },
      connection: c.id,
      level,
      run: log(c, t.name, level, async (input) => {
        const res = await client.callTool({ name: t.name, arguments: input });
        const parts = (res.content as { type: string; text?: string }[] | undefined) ?? [];
        const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
        return (res.isError ? "Error: " : "") + text.slice(0, 6000);
      }),
    }));
}

// ── Home Assistant (REST, limited to listed entities) ────────────────────────────────────────
// HA's own MCP server exposes everything exposed to Assist and can't be narrowed per user, so
// Kith talks to the REST API and only ever touches the entities the parent listed.

function haTools(c: Connection, log: Logger): ToolDef[] {
  if (!c.url || !c.entities.length) return [];
  const base = c.url.replace(/\/$/, "");
  const headers = () => ({ Authorization: `Bearer ${config.secret(c.tokenEnv)}`, "Content-Type": "application/json" });
  const tools: ToolDef[] = [
    {
      name: toolName(c.id, "room_status"),
      description: `[${c.name}] See the state of the devices in their room: ${c.entities.join(", ")}.`,
      input_schema: { type: "object", properties: {}, additionalProperties: false },
      connection: c.id,
      level: "look",
      run: log(c, "room_status", "look", async () => {
        const out: string[] = [];
        for (const e of c.entities) {
          const r = await fetch(`${base}/api/states/${e}`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
          if (!r.ok) { out.push(`${e}: unavailable`); continue; }
          const s = (await r.json()) as { state: string; attributes?: { friendly_name?: string; brightness?: number } };
          out.push(`${s.attributes?.friendly_name ?? e} (${e}): ${s.state}${s.attributes?.brightness != null ? `, brightness ${Math.round((s.attributes.brightness / 255) * 100)}%` : ""}`);
        }
        return out.join("\n");
      }),
    },
  ];
  if (c.level === "act") {
    tools.push({
      name: toolName(c.id, "room_control"),
      description: `[${c.name}] Turn a device in their room on or off, or set a light's brightness/colour. Only these: ${c.entities.join(", ")}.`,
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["entity_id", "action"],
        properties: {
          entity_id: { type: "string", enum: c.entities },
          action: { type: "string", enum: ["turn_on", "turn_off", "toggle"] },
          brightness_pct: { type: "integer", minimum: 1, maximum: 100 },
          color_name: { type: "string" },
        },
      },
      connection: c.id,
      level: "act",
      run: log(c, "room_control", "act", async (input) => {
        const entity = String(input.entity_id);
        if (!c.entities.includes(entity)) return "That device isn't one I'm allowed to touch.";
        const action = String(input.action);
        if (!["turn_on", "turn_off", "toggle"].includes(action)) return "Unknown action.";
        const domain = entity.split(".")[0];
        const body: Record<string, unknown> = { entity_id: entity };
        if (action === "turn_on" && domain === "light") {
          if (typeof input.brightness_pct === "number") body.brightness_pct = input.brightness_pct;
          if (typeof input.color_name === "string") body.color_name = input.color_name;
        }
        const r = await fetch(`${base}/api/services/${domain}/${action}`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
        return r.ok ? "Done." : `Home Assistant said ${r.status}.`;
      }),
    });
  }
  return tools;
}

// ── Jellyfin ─────────────────────────────────────────────────────────────────────────────────

function jellyfinTools(c: Connection, log: Logger): ToolDef[] {
  if (!c.url) return [];
  const base = c.url.replace(/\/$/, "");
  const headers = () => ({ Authorization: `MediaBrowser Token="${config.secret(c.tokenEnv)}"`, "Content-Type": "application/json" });
  const tools: ToolDef[] = [
    {
      name: toolName(c.id, "find_media"),
      description: `[${c.name}] Search the family's film and music library.`,
      input_schema: {
        type: "object", additionalProperties: false, required: ["query", "type"],
        properties: { query: { type: "string" }, type: { type: "string", enum: ["film", "music", "series"] } },
      },
      connection: c.id,
      level: "look",
      run: log(c, "find_media", "look", async (input) => {
        const type = ({ film: "Movie", music: "Audio,MusicAlbum", series: "Series" } as Record<string, string>)[String(input.type)] ?? "Movie";
        const q = new URLSearchParams({ searchTerm: String(input.query).slice(0, 80), IncludeItemTypes: type, Recursive: "true", Limit: "15", Fields: "OfficialRating,ProductionYear" });
        if (c.account) q.set("UserId", c.account);
        const r = await fetch(`${base}/Items?${q}`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
        if (!r.ok) return `Jellyfin said ${r.status}.`;
        const j = (await r.json()) as { Items: { Id: string; Name: string; ProductionYear?: number; OfficialRating?: string; AlbumArtist?: string }[] };
        return j.Items.map((i) => `${i.Name}${i.ProductionYear ? ` (${i.ProductionYear})` : ""}${i.OfficialRating ? ` [${i.OfficialRating}]` : ""}${i.AlbumArtist ? ` – ${i.AlbumArtist}` : ""} id=${i.Id}`).join("\n") || "Nothing found.";
      }),
    },
  ];
  if (c.level === "act" && c.account) {
    tools.push({
      name: toolName(c.id, "make_playlist"),
      description: `[${c.name}] Make a playlist in the family library from songs found with find_media.`,
      input_schema: {
        type: "object", additionalProperties: false, required: ["name", "item_ids"],
        properties: { name: { type: "string" }, item_ids: { type: "array", items: { type: "string" }, maxItems: 60 } },
      },
      connection: c.id,
      level: "act",
      run: log(c, "make_playlist", "act", async (input) => {
        const ids = (input.item_ids as string[]).filter((x) => /^[a-f0-9-]{8,40}$/i.test(x));
        const r = await fetch(`${base}/Playlists`, {
          method: "POST", headers: headers(),
          body: JSON.stringify({ Name: String(input.name).slice(0, 80), Ids: ids, UserId: c.account, MediaType: "Audio" }),
          signal: AbortSignal.timeout(10_000),
        });
        return r.ok ? `Made the playlist with ${ids.length} songs.` : `Jellyfin said ${r.status}.`;
      }),
    });
  }
  return tools;
}

// ── Homework helpers and allow-listed websites ───────────────────────────────────────────────

function calculatorTools(c: Connection, log: Logger): ToolDef[] {
  return [{
    name: toolName(c.id, "calculate"),
    description: "Work out an arithmetic expression exactly, e.g. 3/4 + 1/8 or sqrt(2)*5. Use it to check working, not to skip the learning.",
    input_schema: { type: "object", additionalProperties: false, required: ["expression"], properties: { expression: { type: "string" } } },
    connection: c.id,
    level: "look",
    run: log(c, "calculate", "look", async (input) => calculate(String(input.expression))),
  }];
}

function dictionaryTools(c: Connection, log: Logger): ToolDef[] {
  if (!c.url) return [];
  return [{
    name: toolName(c.id, "define_word"),
    description: "Look up what an English word means.",
    input_schema: { type: "object", additionalProperties: false, required: ["word"], properties: { word: { type: "string" } } },
    connection: c.id,
    level: "look",
    run: log(c, "define_word", "look", async (input) => {
      const word = String(input.word).toLowerCase().replace(/[^a-z' -]/g, "").slice(0, 40);
      const r = await fetch(c.url + encodeURIComponent(word), { signal: AbortSignal.timeout(10_000), redirect: "error" });
      if (!r.ok) return "Couldn't find that word.";
      const j = (await r.json()) as { meanings?: { partOfSpeech: string; definitions: { definition: string }[] }[] }[];
      return (j[0]?.meanings ?? []).slice(0, 3).map((m) => `${m.partOfSpeech}: ${m.definitions[0]?.definition}`).join("\n") || "No definition found.";
    }),
  }];
}

function webTools(c: Connection, log: Logger): ToolDef[] {
  if (!c.sites.length) return [];
  return [{
    name: toolName(c.id, "read_page"),
    description: `Read a web page, only from these sites: ${c.sites.join(", ")}.`,
    input_schema: { type: "object", additionalProperties: false, required: ["url"], properties: { url: { type: "string" } } },
    connection: c.id,
    level: "look",
    run: log(c, "read_page", "look", async (input) => {
      let url = String(input.url);
      for (let hop = 0; hop < 3; hop++) {
        if (!hostAllowed(url, c.sites)) return "That site isn't on the allowed list.";
        const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "Kith/0.1 (home companion)" } });
        if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
          url = new URL(r.headers.get("location")!, url).toString();
          continue;
        }
        if (!r.ok) return `The page answered ${r.status}.`;
        return stripHtml(await r.text()).slice(0, 8000);
      }
      return "Too many redirects.";
    }),
  }];
}

// ── Registry ─────────────────────────────────────────────────────────────────────────────────

type Logger = (c: Connection, tool: string, level: "look" | "act", fn: (input: Record<string, unknown>) => Promise<string>) => (input: Record<string, unknown>) => Promise<string>;

export function makeLogger(db: DB): Logger {
  return (c, tool, level, fn) => async (input) => {
    const args = redactPersonal(JSON.stringify(input)).text.slice(0, 400);
    try {
      const out = await fn(input);
      run(db, "INSERT INTO tool_log(ts, connection, tool, level, args, result, ok) VALUES (?,?,?,?,?,?,1)", Date.now(), c.name, tool, level, args, out.slice(0, 400));
      return out;
    } catch (err) {
      const msg = (err as Error).message;
      run(db, "INSERT INTO tool_log(ts, connection, tool, level, args, result, ok) VALUES (?,?,?,?,?,?,0)", Date.now(), c.name, tool, level, args, msg.slice(0, 400));
      return `That didn't work (${msg}).`;
    }
  };
}

/** The tools the companion may use right now, from the parent's enabled connections. */
export async function connectionTools(db: DB, conns: Connection[]): Promise<ToolDef[]> {
  const log = makeLogger(db);
  const out: ToolDef[] = [];
  for (const c of conns.filter((x) => x.enabled)) {
    try {
      if (c.kind === "calculator") out.push(...calculatorTools(c, log));
      else if (c.kind === "dictionary") out.push(...dictionaryTools(c, log));
      else if (c.kind === "web") out.push(...webTools(c, log));
      else if (c.kind === "jellyfin") out.push(...jellyfinTools(c, log));
      else if (c.kind === "home-assistant") out.push(...haTools(c, log));
      else if (c.kind === "kin" || c.kind === "mcp") out.push(...(await mcpTools(c, log)));
    } catch (err) {
      console.warn(`[connections] ${c.name} is unavailable: ${(err as Error).message}`);
    }
  }
  return out.filter((t) => !isForbiddenTool(t.name.split("__")[1] ?? t.name));
}

export function toolLog(db: DB, limit = 100) {
  return all<{ id: number; ts: number; connection: string; tool: string; level: string; args: string; result: string; ok: number }>(
    db, "SELECT * FROM tool_log ORDER BY ts DESC LIMIT ?", limit,
  );
}
