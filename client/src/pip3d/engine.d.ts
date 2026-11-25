import type { Activity, Look, Mood3D } from "./look";

export type Framing = "portrait" | "full";

export interface StageOptions {
  /** No movement at all (reduced motion, or "Still Pip"). */
  still?: boolean;
  /** Start with this mood or activity instead of the look's own. */
  mood?: Mood3D;
  activity?: Activity;
  /** False draws one frame and then waits (a preview that isn't on screen). Default true. */
  active?: boolean;
  /** "portrait" frames the live view on the head and shoulders (small previews). Default: the whole stage. */
  framing?: "portrait";
}

export interface PipStage {
  setLook(look: Look): void;
  setMood(mood: Mood3D): void;
  setActivity(activity: Activity): void;
  setStill(still: boolean): void;
  setActive(active: boolean): void;
  /** A picture of the character: "portrait" is square on the head and shoulders, "full" is 4:5. */
  snapshot(framing?: Framing, px?: number, clear?: boolean): HTMLCanvasElement;
  /** A still head-and-shoulders PNG (data URL) for each mood, posed with no movement. */
  moodPictures<M extends Mood3D>(moods: readonly M[], px?: number): Record<M, string>;
  /** Frees every GL resource and stops listening. The stage can't be used afterwards. */
  dispose(): void;
}

/** Throws when WebGL can't be started. */
export function createPipStage(canvas: HTMLCanvasElement, look?: Look, opts?: StageOptions): PipStage;
export function webglAvailable(): boolean;
