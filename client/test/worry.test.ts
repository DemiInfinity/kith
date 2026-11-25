import { afterEach, describe, expect, it, vi } from "vitest";
import { announceToldGrownUp, isToldGrownUp, parentStatusWords, parseToldGrownUp, reportStatusWords, sheetMounted, telHref, WORRY_EVENT, type ToldGrownUp } from "../src/lib/worry";

const body = {
  code: "told-grown-up", error: "That sounds really hard. I’m letting Mum know.", message: "That sounds really hard. I’m letting Mum know.",
  level: "now", childNotice: "I’m letting Mum know: “…” You’re not in trouble.",
  helplines: [{ name: "Childline", number: "0800 1111" }, { name: "Emergency", number: "999" }, { bad: true }], openChat: true,
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("a worry typed outside chat (422 told-grown-up)", () => {
  it("is read from the response, and only from a 422 with that code", () => {
    const t = parseToldGrownUp(422, body)!;
    expect(t.level).toBe("now");
    expect(t.message).toMatch(/really hard/);
    expect(t.helplines).toEqual([{ name: "Childline", number: "0800 1111" }, { name: "Emergency", number: "999" }]);
    expect(t.openChat).toBe(true);
    expect(parseToldGrownUp(422, { error: "Not allowed." })).toBeNull(); // a plain 422 is still "not allowed"
    expect(parseToldGrownUp(503, { ...body, code: "safety-unavailable" })).toBeNull();
    expect(parseToldGrownUp(400, body)).toBeNull();
    expect(parseToldGrownUp(422, { ...body, level: "weird", message: undefined }).level).toBe("fyi");
    expect(parseToldGrownUp(422, { ...body, message: undefined })!.message).toBe(body.error);
  });
  it("shows the sheet when it's there, and leaves the words to the caller when it isn't", () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    const t = parseToldGrownUp(422, body)!;
    // No sheet mounted (the parent's app, say): the caller's error carries all the words.
    expect(announceToldGrownUp(t)).toBe(t.message);
    const seen: ToldGrownUp[] = [];
    win.addEventListener(WORRY_EVENT, (e) => seen.push((e as CustomEvent<ToldGrownUp>).detail));
    const off = sheetMounted();
    expect(announceToldGrownUp(t)).toBe("");
    expect(seen).toEqual([t]);
    off();
  });
  it("comes out of api() as a quiet error, after the sheet is told", async () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status: 422, headers: { "content-type": "application/json" } }));
    const seen: ToldGrownUp[] = [];
    win.addEventListener(WORRY_EVENT, (e) => seen.push((e as CustomEvent<ToldGrownUp>).detail));
    const off = sheetMounted();
    const { api } = await import("../src/api");
    const err = await api("/api/memories", { body: { text: "x" } }).catch((e) => e);
    off();
    expect(isToldGrownUp(err)).toBe(true);
    expect(err.status).toBe(422);
    expect(err.message).toBe(""); // the sheet shows the words; screens that print errors show nothing extra
    expect(seen).toHaveLength(1);
    expect(seen[0].helplines[0].number).toBe("0800 1111");
  });
  it("doesn't become a toast from action()", async () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    const toasts: string[] = [];
    win.addEventListener("kith-toast", (e) => toasts.push((e as CustomEvent<string>).detail));
    const { action } = await import("../src/lib/action");
    const { ApiError } = await import("../src/api");
    action(async () => { throw new ApiError("", 422, "told-grown-up"); })();
    action(async () => { throw new ApiError("Nope.", 400); }, "save that")();
    await new Promise((r) => setTimeout(r, 0));
    expect(toasts).toEqual(["Couldn’t save that. Nope."]);
  });
  it("makes helplines tappable", () => {
    expect(telHref("0800 1111")).toBe("tel:08001111");
    expect(telHref("+44 (0)20 7946 0000")).toBe("tel:+4402079460000");
  });
});

describe("report statuses in “What … sees”", () => {
  it("have friendly words for the child, including the new ones", () => {
    expect(reportStatusWords("awaiting_reply", "Pip")).toBe("waiting to be sent");
    expect(reportStatusWords("sending", "Pip")).toBe("being sent");
    expect(reportStatusWords("delivered", "Pip")).toBe("sent");
    expect(reportStatusWords("child_not_told", "Pip")).toBe("sent — Pip may not have told you first, sorry");
    expect(reportStatusWords("something_new", "Pip")).toBe("something new");
  });
  it("and for the parent", () => {
    expect(parentStatusWords("child_not_told")).toMatch(/may not have been told first/);
    expect(parentStatusWords("awaiting_reply")).toMatch(/telling your child first/);
    expect(parentStatusWords("sending")).toBe("sending");
  });
});

describe("Google proposal cards", () => {
  it("show every line, in a box that scrolls, keeping line breaks", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync(new URL("../src/theme.css", import.meta.url), "utf8");
    const rule = /\.difflines \{([^}]*)\}/.exec(css)![1];
    expect(rule).toContain("overflow-y: auto");
    expect(rule).toMatch(/max-height/);
    expect(/\.difflines \.dl \{[^}]*white-space: pre-wrap/.test(css)).toBe(true);
    const card = fs.readFileSync(new URL("../src/components/ConfirmCard.tsx", import.meta.url), "utf8");
    expect(card).toContain("p.lines.map(");
    expect(card).not.toMatch(/lines\.slice|more lines/);
  });
});
