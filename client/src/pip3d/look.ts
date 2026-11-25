// What a 3D Pip (or one of her characters) looks like, as plain data. The server checks the same
// lists (server/src/pip/look.ts): anything not on them is refused, so keep the two in step.

export const KINDS = ["blob", "chibi"] as const;
export const STYLES = ["glossy", "clay", "plush"] as const;
export const PATTERNS = ["plain", "galaxy", "spots", "stripes"] as const;
export const EARS = ["none", "wolf", "fox", "bunny", "bear", "cat"] as const;
export const WEAR = ["beanie", "scarf", "glasses", "headphones"] as const;
export const HAIR_STYLES = ["short", "long", "twin", "bob", "ponytail", "buns", "curly", "braids"] as const;
export const OUTFIT_STYLES = ["hoodie", "dress", "dungarees", "tracksuit", "pyjamas"] as const;
export const MOODS = ["listening", "happy", "excited", "thinking", "surprised", "shy", "proud", "loving", "cheeky", "sad", "sleepy"] as const;
export const ACTIVITIES = ["none", "study", "art", "writing", "cocoa", "sleepy"] as const;
export const BEANIES = ["#E3A91C", "#E25C6E", "#6C8FE6", "#7FD0C9"] as const;

export const PALETTES = {
  pip: { name: "Pip pink", c: ["#EDBDF2", "#EFA6B8", "#F7A055"] },
  mint: { name: "Mint", c: ["#B6F0DA", "#8FD8CC", "#6CB4E6"] },
  sunset: { name: "Sunset", c: ["#FFD27A", "#F7A055", "#E0705A"] },
  sky: { name: "Sky", c: ["#BFD9FF", "#93B8F5", "#7B8FE8"] },
  lemon: { name: "Lemon", c: ["#FFF2A8", "#F6D86B", "#EDB24A"] },
  snow: { name: "Snowy", c: ["#FFFFFF", "#E6DFF0", "#C4B6DE"] },
  galaxy: { name: "Galaxy", c: ["#2B2066", "#4E2E8C", "#A3488C"] },
} as const;
export const HAIR = { dark: "#3B3150", brown: "#6B4430", blonde: "#E9C46A", orange: "#E9823A", silver: "#D9D6E6", pink: "#F2A2C4", blue: "#6C8FE6", purple: "#8E6CC9", red: "#C2473F" } as const;
export const IRIS = { amber: "#E0A030", blue: "#4A8FE0", green: "#4FB27A", violet: "#9B6BE0", red: "#D9465A", brown: "#7A4A2A", grey: "#8A8FA0" } as const;
export const SKIN = { porcelain: "#FBE3D6", light: "#F3CDB4", warm: "#E3AE8A", tan: "#C68B63", brown: "#8D5A3C", deep: "#5E3A26" } as const;
export const OUTFIT = { lilac: "#CDA4E8", mint: "#8FD8CC", peach: "#F7B288", navy: "#3E4A7A", cream: "#F4E9D8", charcoal: "#3A3340" } as const;

export type Kind = (typeof KINDS)[number];
export type Mood3D = (typeof MOODS)[number];
export type Activity = (typeof ACTIVITIES)[number];

export interface Look {
  name: string;
  kind: Kind;
  style: (typeof STYLES)[number];
  palette: keyof typeof PALETTES;
  pattern: (typeof PATTERNS)[number];
  ears: (typeof EARS)[number];
  wear: (typeof WEAR)[number][];
  hair: keyof typeof HAIR;
  hairStyle: (typeof HAIR_STYLES)[number];
  ahoge: boolean;
  eyesC: keyof typeof IRIS;
  skin: keyof typeof SKIN;
  outfit: keyof typeof OUTFIT;
  outfitStyle: (typeof OUTFIT_STYLES)[number];
  mood: Mood3D;
  activity: Activity;
  beanie: (typeof BEANIES)[number];
}

export const DEFAULT_LOOK: Look = {
  name: "Pip", kind: "blob", style: "glossy", palette: "pip", pattern: "plain", ears: "none", wear: [], hair: "dark", hairStyle: "long",
  ahoge: false, eyesC: "amber", skin: "light", outfit: "lilac", outfitStyle: "hoodie", mood: "listening", activity: "none", beanie: "#E3A91C",
};
/** A new character starts as an anime chibi with no name. */
export const NEW_CHARACTER: Look = { ...DEFAULT_LOOK, name: "", kind: "chibi", mood: "happy" };

const pick = <T extends string>(list: readonly T[], v: unknown, d: T): T => (list.includes(v as T) ? (v as T) : d);
const pickKey = <T extends object>(map: T, v: unknown, d: keyof T): keyof T => (typeof v === "string" && v in map ? (v as keyof T) : d);

/** Anything saved or received, made into a whole Look (unknown values fall back to the default). */
export function normaliseLook(raw: unknown, base: Look = DEFAULT_LOOK): Look {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    name: typeof r.name === "string" ? r.name.slice(0, 20) : base.name,
    kind: pick(KINDS, r.kind, base.kind),
    style: pick(STYLES, r.style, base.style),
    palette: pickKey(PALETTES, r.palette, base.palette),
    pattern: pick(PATTERNS, r.pattern, base.pattern),
    ears: pick(EARS, r.ears, base.ears),
    wear: Array.isArray(r.wear) ? [...new Set(r.wear.filter((w): w is Look["wear"][number] => (WEAR as readonly string[]).includes(w as string)))] : base.wear,
    hair: pickKey(HAIR, r.hair, base.hair),
    hairStyle: pick(HAIR_STYLES, r.hairStyle, base.hairStyle),
    ahoge: typeof r.ahoge === "boolean" ? r.ahoge : base.ahoge,
    eyesC: pickKey(IRIS, r.eyesC, base.eyesC),
    skin: pickKey(SKIN, r.skin, base.skin),
    outfit: pickKey(OUTFIT, r.outfit, base.outfit),
    outfitStyle: pick(OUTFIT_STYLES, r.outfitStyle, base.outfitStyle),
    mood: pick(MOODS, r.mood, base.mood),
    activity: pick(ACTIVITIES, r.activity, base.activity),
    beanie: pick(BEANIES, typeof r.beanie === "string" ? r.beanie.toUpperCase() : r.beanie, base.beanie),
  };
}

/** A short line under the name, like "Anime chibi · dark long hair · wolf ears and tail". */
export function describeLook(l: Look): string {
  const wear = l.wear.length ? ` · ${l.wear.join(", ")}` : "";
  if (l.kind === "chibi") {
    const hair = l.hairStyle === "twin" ? "twin tails" : l.hairStyle === "curly" ? "curly hair" : `${l.hairStyle} hair`;
    return `Anime chibi · ${l.hair} ${hair} · ${l.ears === "none" ? "human" : `${l.ears} ears and tail`} · ${l.eyesC} eyes${wear}`;
  }
  const finish = { glossy: "Glossy toy", clay: "Soft clay", plush: "Plush" }[l.style];
  const colour = l.pattern === "galaxy" ? "galaxy" : PALETTES[l.palette].name.toLowerCase() + (l.pattern === "plain" ? "" : ` ${l.pattern}`);
  return `${finish} · ${colour} · ${l.ears === "none" ? "no ears" : `${l.ears} ears`}${wear}`;
}

/** A guess at the species line for a character sheet, from the look. */
export function speciesGuess(l: Look): string {
  if (l.kind === "chibi") return l.ears === "none" ? "human" : `${l.ears} ${l.ears === "bear" ? "cub" : "kemonomimi"}`;
  return `${l.ears === "none" ? "" : `${l.ears}-eared `}blob creature`;
}

/** Mixes a random look, for "Surprise me". */
export function surpriseLook(base: Look, rnd: () => number = Math.random): Look {
  const any = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const wear = any([...WEAR, null]);
  return {
    ...base,
    kind: any(KINDS), style: any(STYLES), palette: any(Object.keys(PALETTES) as Look["palette"][]), pattern: any(["plain", "plain", "galaxy", "spots", "stripes"] as const),
    ears: any(EARS), hair: any(Object.keys(HAIR) as Look["hair"][]), hairStyle: any(HAIR_STYLES), activity: any(["none", "none", "study", "art", "writing", "cocoa"] as const),
    ahoge: rnd() < 0.3, eyesC: any(Object.keys(IRIS) as Look["eyesC"][]), outfit: any(Object.keys(OUTFIT) as Look["outfit"][]), outfitStyle: any(OUTFIT_STYLES),
    skin: any(Object.keys(SKIN) as Look["skin"][]), wear: wear ? [wear] : [], mood: "happy", beanie: any(BEANIES),
  };
}
