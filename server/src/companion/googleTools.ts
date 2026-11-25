// The companion's Google tools. Each is offered only when the parent has switched that feature on.
// Reads happen straight away (and are logged); every write is only a proposal: she sees a card with
// a short diff-like summary in the chat, and nothing changes in Google until she says yes.

import type { DB } from "../db.js";
import type { ToolDef } from "../connections/connections.js";
import type { GoogleDrive } from "../storage/google.js";
import {
  googleFeatures, GoogleRefusal, listEvents, listFiles, listHomework, proposeCalendar, proposeFileEdit, proposeTask, readFile, setCoursework, type Pending,
} from "../storage/googleWork.js";

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object" as const, additionalProperties: false, properties, required });
const WAIT = "It's shown to them as a card with the change. Nothing happens until they tap Yes, so tell them briefly what you suggested and wait.";

export function googleTools(db: DB, drive: GoogleDrive | null, effects: { confirms: Pending[] }, opts: { coursework: boolean }): ToolDef[] {
  if (!drive || !drive.state()) return [];
  const f = googleFeatures(db);
  const tool = (name: string, description: string, input_schema: ToolDef["input_schema"], level: "look" | "act", run: ToolDef["run"]): ToolDef =>
    ({ name, description, input_schema, connection: "Google", level, run: async (i) => { try { return await run(i); } catch (e) { return e instanceof GoogleRefusal ? e.message : `That didn't work: ${(e as Error).message.slice(0, 200)}`; } } });
  const propose = (p: Pending) => { effects.confirms.push(p); return WAIT; };
  const out: ToolDef[] = [];
  if (f.edit) {
    out.push(
      tool("google_files", "List the Google Docs, Sheets and Slides you can open: ones they picked for you with the Google Picker, and ones you made.", obj({}, []), "look",
        async () => listFiles(db).map((x) => `${x.id} · ${x.name} · ${x.mime.split(".").pop()}${x.coursework ? " · COURSEWORK (read only)" : ""}`).join("\n") || "None yet. They can pick one on the Google screen (Settings › Google)."),
      tool("google_read_file", "Read a Doc, Sheet or Slides file they picked for you (or you made).", obj({ file_id: { type: "string" } }, ["file_id"]), "look",
        async (i) => readFile(db, drive, String(i.file_id))),
      tool("google_propose_edit",
        `Suggest changes to a Doc, Sheet or Slides file they picked (or you made). ${WAIT} Changes: for a Doc {op:"append",text} or {op:"replace",find,with}; for a Sheet {op:"append_rows",rows} or {op:"set_cells",range:"B2:C3",values}; for Slides {op:"replace",find,with} or {op:"add_slide",title,body}. NEVER for coursework (non-exam assessment): if they say it's coursework, call google_mark_coursework instead and help them do it themselves.`,
        obj({
          file_id: { type: "string" }, summary: { type: "string", description: "One short line: what this change does" },
          changes: { type: "array", items: { type: "object", additionalProperties: true } },
        }, ["file_id", "summary", "changes"]), "act",
        async (i) => propose(proposeFileEdit(db, { fileId: String(i.file_id), summary: String(i.summary ?? ""), changes: (i.changes as unknown[]) ?? [], coursework: opts.coursework }))),
      tool("google_mark_coursework", "Mark a file as coursework (non-exam assessment) when they say it is. From then on you never edit it.", obj({ file_id: { type: "string" } }, ["file_id"]), "act",
        async (i) => { setCoursework(db, String(i.file_id), true); return "Marked as coursework: I'll only explain and give feedback on it from now on."; }),
    );
  }
  if (f.calendar) {
    out.push(
      tool("calendar_events", "Read the events in their own Google Calendar for the next few days (up to 60).", obj({ days: { type: "integer" } }, []), "look",
        async (i) => (await listEvents(db, drive, Number(i.days ?? 14))).map((e) => `${e.start.replace("T", " ").slice(0, 16)} · ${e.title}${e.kith ? ` · added by you (id ${e.id})` : ""}`).join("\n") || "Nothing in the calendar."),
      tool("calendar_propose",
        `Suggest adding an event to their calendar (revision, a test date, a reminder), or changing or removing one YOU added. ${WAIT} Never invite anyone: there are no guests. Times are local, YYYY-MM-DDTHH:MM, or YYYY-MM-DD for all day.`,
        obj({
          op: { type: "string", enum: ["create", "update", "delete"] }, title: { type: "string" }, start: { type: "string" }, end: { type: "string" },
          notes: { type: "string" }, event_id: { type: "string", description: "For update or delete: an event you added" },
        }, ["op"]), "act",
        async (i) => propose(await proposeCalendar(db, drive, { op: i.op, title: i.title || undefined, start: i.start || undefined, end: i.end || undefined, notes: i.notes ?? undefined, eventId: i.event_id || undefined }))),
    );
  }
  if (f.tasks) {
    out.push(
      tool("homework_list", "Read their Homework list in Google Tasks (what's still to do).", obj({}, []), "look",
        async () => (await listHomework(db, drive)).map((t) => `${t.id} · ${t.title}${t.due ? ` · due ${t.due}` : ""}`).join("\n") || "Nothing on the Homework list."),
      tool("homework_propose", `Suggest adding homework to their Homework list, or ticking one off together. ${WAIT}`,
        obj({ op: { type: "string", enum: ["add", "complete"] }, title: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD" }, task_id: { type: "string" } }, ["op", "title"]), "act",
        async (i) => propose(proposeTask(db, { op: i.op, title: i.title, due: i.due || undefined, taskId: i.task_id || undefined }))),
    );
  }
  return out;
}
