// When something typed outside chat (a desk request, a memory, a note, a schedule, flashcards,
// practice, a language question, a story idea…) sounds like a worry, the server tells the grown-up
// and answers 422 with code "told-grown-up" instead of doing it. The api() layer turns that into an
// event, and <WorrySheet> shows Pip's kind words, the helplines and a way back to chat, rather than
// a red error. (An older client just shows `error`, which holds the same words.)

export const WORRY_EVENT = "kith-told-grown-up";

export interface ToldGrownUp {
  message: string;
  level: "fyi" | "today" | "now";
  childNotice: string;
  helplines: { name: string; number: string }[];
  openChat: boolean;
}

/** The told-grown-up answer in a failed response, or null if it isn't one. */
export function parseToldGrownUp(status: number, body: unknown): ToldGrownUp | null {
  const b = body as Record<string, unknown> | null;
  if (status !== 422 || !b || b.code !== "told-grown-up") return null;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const level = b.level === "now" || b.level === "today" ? b.level : "fyi";
  const helplines = Array.isArray(b.helplines)
    ? b.helplines.filter((h): h is { name: string; number: string } => Boolean(h) && typeof h.name === "string" && typeof h.number === "string")
    : [];
  return { message: text(b.message) || text(b.error), level, childNotice: text(b.childNotice), helplines, openChat: b.openChat !== false };
}

let sheets = 0;
/** <WorrySheet> says it's there, so the words aren't also shown again where the request was made. */
export function sheetMounted(): () => void { sheets++; return () => { sheets--; }; }

/**
 * Tells the app to show the sheet. Returns the words the caller's own error should carry: none when
 * the sheet shows them (so a screen that prints errors inline shows nothing extra), else all of them.
 */
export function announceToldGrownUp(t: ToldGrownUp): string {
  if (typeof window === "undefined" || sheets === 0) return t.message;
  window.dispatchEvent(new CustomEvent(WORRY_EVENT, { detail: t }));
  return "";
}

/** True for the error api() throws after showing the sheet: callers needn't show anything else. */
export function isToldGrownUp(e: unknown): boolean {
  return (e as { code?: string })?.code === "told-grown-up";
}

/** A phone number as a tel: link. */
export const telHref = (n: string) => `tel:${n.replace(/[^\d+]/g, "")}`;

/** What the child sees for a report's status in "What … sees". */
export function reportStatusWords(status: string, companion: string): string {
  switch (status) {
    case "awaiting_reply": case "pending": case "queued": return "waiting to be sent";
    case "sending": return "being sent";
    case "delivered": case "sent": return "sent";
    case "child_not_told": return `sent — ${companion} may not have told you first, sorry`;
    case "failed": return "couldn’t be sent yet";
    default: return status.replace(/_/g, " ");
  }
}

/** The same statuses in the parent's report list. */
export function parentStatusWords(status: string): string {
  switch (status) {
    case "awaiting_reply": return "waiting (telling your child first)";
    case "pending": case "queued": return "waiting";
    case "sending": return "sending";
    case "delivered": case "sent": return "sent";
    case "child_not_told": return "sent (your child may not have been told first)";
    case "failed": return "not sent yet";
    default: return status.replace(/_/g, " ");
  }
}
