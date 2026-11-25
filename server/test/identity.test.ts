import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { openDb } from "../src/db.js";
import { takeTurn } from "../src/companion/chat.js";
import { companionFiles, safeguardsDoc } from "../src/companion/files.js";
import { Safety } from "../src/safety/check.js";
import { Studio } from "../src/desk/studio.js";
import type { CallOpts, LLM } from "../src/llm.js";
import { CompanionProfile, loadParentSettings, saveParentSettings, saveProfile } from "../src/settings.js";

class Scripted implements LLM {
  available = true;
  calls: CallOpts[] = [];
  async call(opts: CallOpts): Promise<Anthropic.Message> {
    this.calls.push(opts);
    const sys = JSON.stringify(opts.params.system);
    const text = sys.includes("Decide whether their grown-up") ? JSON.stringify({ level: "none", categories: [], parent_summary: "", steer: "" })
      : sys.includes("draft reply") ? JSON.stringify({ ok: true, categories: [], reason: "" }) : "Hi!";
    return { id: "m", type: "message", role: "assistant", model: opts.params.model, stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text, citations: null }] } as unknown as Anthropic.Message;
  }
}

describe("soul, identity and the safeguards", () => {
  it("puts the safeguards first, with the family's additions, and the child's soul after them", async () => {
    const db = openDb(":memory:");
    saveProfile(db, CompanionProfile.parse({ setupDone: true, soul: "I'm a moth-loving night owl.", identityNotes: "Says 'brilliant!' a lot." }));
    const s = loadParentSettings(db);
    s.safeguards = "- No horror stories after 8pm.";
    saveParentSettings(db, s);
    const llm = new Scripted();
    const safety = new Safety(llm);
    await takeTurn({ db, llm, safety, reporters: [], studio: new Studio(db, llm, safety), childName: "Sam" }, { text: "hi", mode: "chat" });
    const system = llm.calls.find((c) => c.kind === "chat")!.params.system as { text: string }[];
    expect(system[0].text.startsWith("SAFEGUARDS")).toBe(true);
    expect(system[0].text).toContain("No horror stories after 8pm.");
    expect(system[0].text).toContain("No romance or flirting");
    expect(system[0].text).not.toContain("moth-loving");
    expect(system[1].text).toContain("moth-loving night owl");
    expect(system[1].text).toContain("Says 'brilliant!' a lot.");
  });

  it("the child's files hold no safeguards; the parent can see them", () => {
    const db = openDb(":memory:");
    saveProfile(db, CompanionProfile.parse({ setupDone: true }));
    const f = JSON.stringify(companionFiles(db, "Sam"));
    expect(f).not.toMatch(/SAFEGUARDS|No romance or flirting|Keeping safe/);
    expect(safeguardsDoc(db, "Sam").builtIn).toContain("No romance or flirting");
  });
});
