// Lights, sockets, scenes and speakers in the house, through Home Assistant. Only the entities the
// grown-up listed in KITH_HA_DEVICES: everything else in the house is invisible to the companion,
// and an id that isn't on the list is refused before anything is sent.

import { z } from "zod";
import type { DB } from "../db.js";
import type { ToolDef } from "../connections/connections.js";
import { config } from "../config.js";
import { logActivity } from "../desk/activity.js";
import { stage, type TurnEffects } from "./tools.js";

type Fetch = typeof fetch;
type Ha = { url: string; token: string; devices: string[] };

const DOMAINS = ["light", "switch", "scene", "media_player"] as const;
const COLOURS: Record<string, [number, number, number]> = {
  red: [255, 40, 40], orange: [255, 140, 0], yellow: [255, 220, 0], green: [40, 220, 80], teal: [0, 200, 180],
  blue: [40, 90, 255], purple: [150, 60, 255], pink: [255, 105, 180], white: [255, 255, 255], warm: [255, 190, 120],
};

export function allowed(ha: Ha = config.reporting.ha): string[] {
  return ha.devices.filter((id) => DOMAINS.some((d) => id.startsWith(`${d}.`)));
}
export const homeConfigured = (ha: Ha = config.reporting.ha) => Boolean(ha.url && ha.token && allowed(ha).length);

async function call(ha: Ha, f: Fetch, path: string, body?: unknown) {
  const res = await f(`${ha.url}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${ha.token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Home Assistant answered ${res.status}`);
  return res.json() as Promise<unknown>;
}

interface State { entity_id: string; state: string; attributes: Record<string, unknown> }

/** One line per allowed device: name, id and how it is now. */
export function describeStates(states: State[], ids: string[]): string {
  const byId = new Map(states.map((s) => [s.entity_id, s]));
  return ids.map((id) => {
    const s = byId.get(id);
    if (!s) return `${id}: not found`;
    const a = s.attributes;
    const name = typeof a.friendly_name === "string" && a.friendly_name ? a.friendly_name : id;
    const bits = [s.state];
    if (id.startsWith("light.") && s.state === "on" && typeof a.brightness === "number") bits.push(`${Math.round((a.brightness / 255) * 100)}%`);
    if (id.startsWith("media_player.") && typeof a.volume_level === "number") bits.push(`volume ${Math.round(a.volume_level * 100)}%`);
    if (id.startsWith("media_player.") && typeof a.media_title === "string") bits.push(`playing "${a.media_title}"`);
    return `${name} (${id}): ${bits.join(", ")}`;
  }).join("\n");
}

const Action = z.object({
  device: z.string(),
  action: z.enum(["on", "off", "toggle", "play", "pause", "volume"]),
  brightness: z.number().min(1).max(100).optional(),
  colour: z.string().optional(),
  volume: z.number().min(0).max(100).optional(),
});

/** The Home Assistant service and data for an action, or why it can't be done. */
export function serviceFor(a: z.infer<typeof Action>): { path: string; data: Record<string, unknown> } | string {
  const [domain] = a.device.split(".");
  const data: Record<string, unknown> = { entity_id: a.device };
  if (domain === "scene") return a.action === "on" ? { path: "services/scene/turn_on", data } : "A scene can only be switched on.";
  if (domain === "media_player") {
    if (a.action === "play") return { path: "services/media_player/media_play", data };
    if (a.action === "pause") return { path: "services/media_player/media_pause", data };
    if (a.action === "volume") return a.volume === undefined ? "Say what volume (0 to 100)." : { path: "services/media_player/volume_set", data: { ...data, volume_level: a.volume / 100 } };
    if (a.action === "on" || a.action === "off") return { path: `services/media_player/turn_${a.action}`, data };
    return { path: "services/media_player/toggle", data };
  }
  if (a.action === "play" || a.action === "pause" || a.action === "volume") return "That's only for speakers and TVs.";
  if (domain === "light" && a.action === "on") {
    if (a.brightness !== undefined) data.brightness_pct = a.brightness;
    if (a.colour) {
      const rgb = COLOURS[a.colour.toLowerCase().trim()];
      if (!rgb) return `I know these colours: ${Object.keys(COLOURS).join(", ")}.`;
      data.rgb_color = rgb;
    }
  }
  return { path: `services/${domain}/${a.action === "toggle" ? "toggle" : `turn_${a.action}`}`, data };
}

export function homeTools(db: DB, effects: TurnEffects, ha: Ha = config.reporting.ha, f: Fetch = fetch): ToolDef[] {
  if (!homeConfigured(ha)) return [];
  const ids = allowed(ha);
  const fail = (e: unknown) => `Home Assistant didn't answer (${(e as Error).message}). Try the switch, or ask ${config.people.parentLabel}.`;
  return [
    {
      name: "home_devices",
      description: "The lights, sockets, scenes and speakers in the house you may check and control for them, and how each is now. Only these: you can't see or change anything else in the house.",
      input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
      connection: "Home", level: "look",
      run: async () => {
        try { return describeStates(await call(ha, f, "states") as State[], ids); } catch (e) { return fail(e); }
      },
    },
    {
      name: "home_control",
      description: `Switch a light, socket or speaker on or off, set a light's brightness or colour, start a scene, or play, pause or set the volume on a speaker or TV, when they ask. Only devices from home_devices. Colours: ${Object.keys(COLOURS).join(", ")}. Don't do it late at night or to wake or annoy anyone else in the house; if they ask for that, kindly say no.`,
      input_schema: {
        type: "object", additionalProperties: false, required: ["device", "action"],
        properties: {
          device: { type: "string", description: "The device id, e.g. light.sam_room" },
          action: { type: "string", enum: ["on", "off", "toggle", "play", "pause", "volume"] },
          brightness: { type: "number", description: "Lights: 1 to 100 (with action on)" },
          colour: { type: "string", description: "Lights: a colour name (with action on)" },
          volume: { type: "number", description: "Speakers: 0 to 100 (with action volume)" },
        },
      },
      connection: "Home", level: "act",
      run: async (input) => {
        const p = Action.safeParse(input);
        if (!p.success) return "That didn't make sense: give a device and an action.";
        if (!ids.includes(p.data.device)) return "You can't control that one. Use home_devices to see the ones you can.";
        const svc = serviceFor(p.data);
        if (typeof svc === "string") return svc;
        await stage(effects, {
          label: "home", text: "",
          commit: async () => {
            try {
              await call(ha, f, svc.path, svc.data);
              logActivity(db, "💡", `${p.data.device}: ${p.data.action}${p.data.brightness ? ` ${p.data.brightness}%` : ""}${p.data.colour ? ` ${p.data.colour}` : ""}${p.data.volume !== undefined ? ` ${p.data.volume}%` : ""}`);
            } catch (e) { console.warn("[home] didn't work:", (e as Error).message); }
          },
        });
        return "Done once this reply is sent.";
      },
    },
  ];
}
