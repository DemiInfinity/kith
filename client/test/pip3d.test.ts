import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK, describeLook, EARS, NEW_CHARACTER, normaliseLook, speciesGuess, surpriseLook, WEAR } from "../src/pip3d/look";
import { pipPictureUrl, pipPictureVersion, setPipPicture } from "../src/components/CompanionPic";
import { fileName } from "../src/pip3d/Maker";

describe("the 3D look on the client", () => {
  it("keeps a valid look as it is", () => {
    const l = { ...NEW_CHARACTER, name: "Luna", ears: "wolf" as const, wear: ["headphones" as const] };
    expect(normaliseLook(l)).toEqual(l);
  });
  it("drops anything unknown back to the base", () => {
    const l = normaliseLook({ kind: "dragon", ears: "horns", wear: ["crown", "scarf", "scarf"], hair: "green", beanie: "#e25c6e", name: 7 });
    expect(l).toMatchObject({ kind: DEFAULT_LOOK.kind, ears: DEFAULT_LOOK.ears, wear: ["scarf"], hair: DEFAULT_LOOK.hair, beanie: "#E25C6E", name: DEFAULT_LOOK.name });
    expect(normaliseLook(null)).toEqual(DEFAULT_LOOK);
    expect(normaliseLook({ name: "x".repeat(40) }).name).toHaveLength(20);
  });
  it("describes a look in a short line", () => {
    expect(describeLook({ ...DEFAULT_LOOK, pattern: "galaxy", ears: "fox", wear: ["beanie"] })).toBe("Glossy toy · galaxy · fox ears · beanie");
    expect(describeLook({ ...NEW_CHARACTER, ears: "wolf", hairStyle: "twin" })).toBe("Anime chibi · dark twin tails · wolf ears and tail · amber eyes");
    expect(speciesGuess({ ...NEW_CHARACTER, ears: "none" })).toBe("human");
    expect(speciesGuess({ ...DEFAULT_LOOK, ears: "bunny" })).toBe("bunny-eared blob creature");
  });
  it("surprise always gives a valid look and keeps the name", () => {
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 50; i++) {
      const l = surpriseLook({ ...DEFAULT_LOOK, name: "Bean" }, rnd);
      expect(normaliseLook(l)).toEqual(l);
      expect(l.name).toBe("Bean");
      expect(EARS).toContain(l.ears);
      for (const w of l.wear) expect(WEAR).toContain(w);
    }
  });
});

describe("the chat picture", () => {
  it("is used only once there is one, and its address changes with it", () => {
    setPipPicture(null);
    expect(pipPictureVersion()).toBeNull();
    setPipPicture(123);
    expect(pipPictureVersion()).toBe(123);
    expect(pipPictureUrl(123)).toBe("/api/pip/picture.png?v=123");
    setPipPicture(undefined);
    expect(pipPictureVersion()).toBeNull();
  });
  it("names picture files safely", () => {
    expect(fileName("Luna Star!", "character", "card")).toBe("luna-star-card.png");
    expect(fileName("", "pip", "picture")).toBe("pip-picture.png");
    expect(fileName("../../x", "pip", "picture")).toBe("x-picture.png");
  });
});
