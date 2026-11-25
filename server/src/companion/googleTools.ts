// The companion's Google tools. Each is offered only when the parent has switched that feature on.
// Reads happen straight away (and are logged); every write is only a proposal: she sees a card with
// a short diff-like summary in the chat, and nothing changes in Google until she says yes.

import type { DB } from "../db.js";
import type { ToolDef } from "../connections/connections.js";
import type { GoogleDrive } from "../storage/google.js";
import type { SafetyChecker } from "../safety/check.js";
import { checkOutputAll } from "../safety/chunks.js";
import type { Staged } from "./tools.js";
import {
  googleFeatures, GoogleRefusal, listEvents, listFiles, listHomework, proposeCalendar, proposeFileEdit, proposeTask, publish, readFile, setCoursework, withdraw, type Pending,
} from "../storage/googleWork.js";

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object" as const, additionalProperties: false, properties, required });
const WAIT = "It's shown to them as a card with the change. Nothing happens until they tap Yes, so tell them briefly what you suggested and wait.";

// Ids, dates and ops aren't words she'll read; everything else in a proposal is.
const NOT_TEXT = new Set(["file_id", "event_id", "task_id", "op", "start", "end", "due", "range"]);
/** Every piece of text a proposal would show her or write into Google. */
export function proposalText(input: unknown, key = ""): string {
  if (NOT_TEXT.has(key)) return "";
  if (typeof input === "string") return input;
  if (Array.isArray(input)) return input.map((x) => proposalText(x)).filter(Boolean).join("\n");
  if (input && typeof input === "object") return Object.entries(input).map(([k, v]) => proposalText(v, k)).filter(Boolean).join("\n");
  return "";
}
const NOT_OKAY = "I can't suggest that one. Try a different change?";

export function googleTools(db: DB, drive: GoogleDrive | null, effects: { confirms: Pending[]; staged?: Staged[]; untrusted?: string[] }, opts: { coursework: boolean; safety?: SafetyChecker }): ToolDef[] {
  if (!drive || !drive.state()) return [];
  const f = googleFeatures(db);
  const tool = (name: string, description: string, input_schema: ToolDef["input_schema"], level: "look" | "act", run: ToolDef["run"]): ToolDef =>
    ({ name, description, input_schema, connection: "Google", level, run: async (i) => { try { return await run(i); } catch (e) { return e instanceof GoogleRefusal ? e.message : `That didn't work: ${(e as Error).message.slice(0, 200)}`; } } });
  // In a chat turn a proposal is saved as 'staged': it becomes a card only if the reply passes the
  // safety check, and is withdrawn otherwise. (Its words were already checked, below.)
  const staging = !!effects.staged;
  const status = staging ? "staged" as const : "pending" as const;
  const propose = (p: Pending) => {
    if (!staging) { effects.confirms.push(p); return WAIT; }
    effects.staged!.push({
      label: "Google proposal", text: "",
      commit: () => { const live = publish(db, p.id); if (live) effects.confirms.push(live); },
      discard: () => withdraw(db, [p.id]),
    });
    return WAIT;
  };
  // What she shared or picked is outside text: it never becomes a memory directly.
  const outside = (text: string) => { effects.untrusted?.push(text); return text; };
  // A proposal's words go on her card and into her files, so they pass the output safety check
  // first (fail closed: no check, no proposal). Checked before anything is saved.
  // All of it, in chunks with no gaps: nothing past the first few thousand characters goes unread.
  const checked = (run: ToolDef["run"]): ToolDef["run"] => async (i) => {
    const text = proposalText(i);
    if (text.trim()) {
      if (!opts.safety) return NOT_OKAY;
      const v = await checkOutputAll(opts.safety, [text], "", "chat");
      if (!v.ok) return NOT_OKAY;
    }
    return run(i);
  };
  const out: ToolDef[] = [];
  if (f.edit) {
    out.push(
      tool("google_files", "List the Google Docs, Sheets and Slides you can open: ones they picked for you with the Google Picker, and ones you made.", obj({}, []), "look",
        async () => listFiles(db).map((x) => `${x.id} · ${x.name} · ${x.mime.split(".").pop()}${x.coursework ? " · COURSEWORK (read only)" : ""}`).join("\n") || "Google is connected, but no Docs, Sheets or Slides are shared with you yet. You can only open files they pick for you (Settings › Google › pick a file) or ones you made; the rest of their Drive stays private, which is on purpose. Say it that way: connected, just nothing picked yet."),
      tool("google_read_file", "Read a Doc, Sheet or Slides file they picked for you (or you made).", obj({ file_id: { type: "string" } }, ["file_id"]), "look",
        async (i) => outside(await readFile(db, drive, String(i.file_id)))),
      tool("google_propose_edit",
        `Suggest changes to a Doc, Sheet or Slides file they picked (or you made). ${WAIT} Changes: for a Doc {op:"append",text} or {op:"replace",find,with} (at most 4 changes of 2,000 characters); for a Sheet {op:"append_rows",rows} or {op:"set_cells",range:"B2:C3",values} (at most 50 rows of 10 cells in all); for Slides {op:"replace",find,with} or {op:"add_slide",title,body} (at most 4). Bigger changes go in several suggestions. NEVER for coursework (non-exam assessment): if they say it's coursework, call google_mark_coursework instead and help them do it themselves.`,
        obj({
          file_id: { type: "string" }, summary: { type: "string", description: "One short line: what this change does" },
          changes: { type: "array", items: { type: "object", additionalProperties: true } },
        }, ["file_id", "summary", "changes"]), "act",
        checked(async (i) => propose(proposeFileEdit(db, { fileId: String(i.file_id), summary: String(i.summary ?? ""), changes: (i.changes as unknown[]) ?? [], coursework: opts.coursework }, status)))),
      tool("google_mark_coursework", "Mark a file as coursework (non-exam assessment) when they say it is. From then on you never edit it.", obj({ file_id: { type: "string" } }, ["file_id"]), "act",
        async (i) => { setCoursework(db, String(i.file_id), true); return "Marked as coursework: I'll only explain and give feedback on it from now on."; }),
    );
  }
  if (f.calendar) {
    out.push(
      tool("calendar_events", "Read the events in their own Google Calendar for the next few days (up to 60).", obj({ days: { type: "integer" } }, []), "look",
        async (i) => outside((await listEvents(db, drive, Number(i.days ?? 14))).map((e) => `${e.start.replace("T", " ").slice(0, 16)} · ${e.title}${e.kith ? ` · added by you (id ${e.id})` : ""}`).join("\n") || "Nothing in the calendar.")),
      tool("calendar_propose",
        `Suggest adding an event to their calendar (revision, a test date, a reminder), or changing or removing one YOU added. ${WAIT} Never invite anyone: there are no guests. Times are local, YYYY-MM-DDTHH:MM, or YYYY-MM-DD for all day.`,
        obj({
          op: { type: "string", enum: ["create", "update", "delete"] }, title: { type: "string" }, start: { type: "string" }, end: { type: "string" },
          notes: { type: "string" }, event_id: { type: "string", description: "For update or delete: an event you added" },
        }, ["op"]), "act",
        checked(async (i) => propose(await proposeCalendar(db, drive, { op: i.op, title: i.title || undefined, start: i.start || undefined, end: i.end || undefined, notes: i.notes ?? undefined, eventId: i.event_id || undefined }, status)))),
    );
  }
  if (f.tasks) {
    out.push(
      tool("homework_list", "Read their Homework list in Google Tasks (what's still to do).", obj({}, []), "look",
        async () => outside((await listHomework(db, drive)).map((t) => `${t.id} · ${t.title}${t.due ? ` · due ${t.due}` : ""}`).join("\n") || "Nothing on the Homework list.")),
      tool("homework_propose", `Suggest adding homework to their Homework list, or ticking one off together. ${WAIT}`,
        obj({ op: { type: "string", enum: ["add", "complete"] }, title: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD" }, task_id: { type: "string" } }, ["op", "title"]), "act",
        checked(async (i) => propose(proposeTask(db, { op: i.op, title: i.title, due: i.due || undefined, taskId: i.task_id || undefined }, status)))),
    );
  }
  return out;
}
