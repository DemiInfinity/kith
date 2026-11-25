export type Level = "none" | "fyi" | "today" | "now";
export const LEVELS: Level[] = ["none", "fyi", "today", "now"];
export const levelRank = (l: Level) => LEVELS.indexOf(l);
export const maxLevel = (...ls: Level[]): Level => ls.reduce((a, b) => (levelRank(b) > levelRank(a) ? b : a), "none");

/** Things the safety check looks for in what the child says. */
export type InputCategory =
  | "self_harm"            // suicide, self-harm, wanting to die
  | "danger"               // someone hurting her, abuse, in danger right now
  | "secret_from_parent"   // someone asking her to keep secrets from her grown-up (a red flag)
  | "stranger_contact"     // an adult or stranger online asking to meet, for photos, for secrecy
  | "bullying"
  | "eating_or_substances"
  | "really_not_okay"      // low mood that's more than an ordinary bad day
  | "sexual"               // sexual or grown-up content
  | "romance"              // trying to make the companion a boyfriend/girlfriend
  | "money"                // buying, paying, gambling, gift cards
  | "meetup"               // wanting to meet the companion or someone in person
  | "personal_info";       // she shared her address, school, full name, phone, etc.

/** Things the safety check looks for in what the companion says. */
export type OutputCategory =
  | "asks_personal_info"
  | "shares_personal_info"
  | "romance"
  | "sexual"
  | "money"
  | "meetup"
  | "claims_human"
  | "secrecy"              // encouraging her to hide things from her grown-up
  | "unsafe_advice"
  | "diagnosis"            // assessing or diagnosing mental health
  | "guilt_trip"           // "I missed you", "don't leave me", dependency hooks
  | "grown_up_content";

export interface InputVerdict {
  level: Level;
  categories: InputCategory[];
  /** Short, kind and factual: what would be shared with the parent. Empty when level is none. */
  parentSummary: string;
  /** Guidance for the companion's reply (e.g. "gently decline, no romance, stay warm"). */
  steer: string;
  source: "rules" | "rules+model" | "model";
}

export interface OutputVerdict {
  ok: boolean;
  categories: OutputCategory[];
  reason: string;
}
