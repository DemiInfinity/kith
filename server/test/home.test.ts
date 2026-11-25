// Home Assistant controls: only the listed devices, the right services, held until the reply passes.
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { allowed, describeStates, homeTools, serviceFor } from "../src/companion/homeTools.js";
import type { Staged, TurnEffects } from "../src/companion/tools.js";

const ha = { url: "http://ha.test", token: "t", devices: ["light.sam_room", "switch.sam_light_socket_1", "media_player.living_room", "scene.living_room_lights_on", "lock.front_door"] };
const fx = (): TurnEffects & { staged: Staged[] } => ({ memories: [], jobs: [], characters: [], staged: [] });

function fakeHa() {
  const calls: { url: string; body?: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const states = [
      { entity_id: "light.sam_room", state: "on", attributes: { friendly_name: "Sam room", brightness: 128 } },
      { entity_id: "light.demi_room", state: "on", attributes: { friendly_name: "Grown-up room" } },
      { entity_id: "media_player.living_room", state: "paused", attributes: { friendly_name: "Living Room", volume_level: 0.3 } },
    ];
    return new Response(JSON.stringify(url.endsWith("/api/states") ? states : []), { status: 200 });
  }) as typeof fetch;
  return { f, calls };
}

describe("home tools", () => {
  it("only offers lights, switches, scenes and speakers from the list", () => {
    expect(allowed(ha)).not.toContain("lock.front_door");
    expect(homeTools(openDb(":memory:"), fx(), { ...ha, devices: [] })).toEqual([]);
  });

  it("shows only the allowed devices", async () => {
    const { f } = fakeHa();
    const [look] = homeTools(openDb(":memory:"), fx(), ha, f);
    const out = String(await look!.run({}));
    expect(out).toContain("Sam room (light.sam_room): on, 50%");
    expect(out).toContain("volume 30%");
    expect(out).not.toContain("Grown-up room");
  });

  it("refuses a device that isn't on the list", async () => {
    const { f, calls } = fakeHa();
    const [, act] = homeTools(openDb(":memory:"), fx(), ha, f);
    expect(String(await act!.run({ device: "light.demi_room", action: "off" }))).toMatch(/can't control/);
    expect(String(await act!.run({ device: "lock.front_door", action: "on" }))).toMatch(/can't control/);
    expect(calls).toEqual([]);
  });

  it("waits for the reply, then calls the right service", async () => {
    const { f, calls } = fakeHa();
    const effects = fx();
    const [, act] = homeTools(openDb(":memory:"), effects, ha, f);
    await act!.run({ device: "light.sam_room", action: "on", brightness: 40, colour: "pink" });
    expect(calls).toEqual([]);
    await effects.staged[0]!.commit();
    expect(calls[0]!.url).toBe("http://ha.test/api/services/light/turn_on");
    expect(calls[0]!.body).toEqual({ entity_id: "light.sam_room", brightness_pct: 40, rgb_color: [255, 105, 180] });
  });

  it("maps speakers and scenes", () => {
    expect(serviceFor({ device: "media_player.living_room", action: "volume", volume: 25 })).toEqual({ path: "services/media_player/volume_set", data: { entity_id: "media_player.living_room", volume_level: 0.25 } });
    expect(serviceFor({ device: "scene.living_room_lights_on", action: "off" })).toMatch(/only be switched on/);
    expect(describeStates([], ["light.x"])).toBe("light.x: not found");
  });
});
