import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { deleteSkill, EXAMPLES, listSkills, saveSkill, skillForCommand, skillsNote, skillText } from "../src/companion/skills.js";

describe("skills the parent writes", () => {
  it("saves, lists and deletes, with the short list going in the prompt", () => {
    const db = openDb(":memory:");
    expect(skillsNote(db)).toBe("");
    const r = saveSkill(db, EXAMPLES[1]);
    expect(r.ok).toBe(true);
    expect(skillsNote(db)).toContain("Quick quiz (/quiz): When they want testing");
    expect(skillsNote(db)).not.toContain("Ask what topic"); // the full text only loads when used
    if (r.ok) deleteSkill(db, r.skill.id);
    expect(listSkills(db)).toHaveLength(0);
  });
  it("finds the skill a /command asks for, only when it's switched on", () => {
    const db = openDb(":memory:");
    const r = saveSkill(db, EXAMPLES[1]);
    expect(skillForCommand(db, "/quiz the Tudors")?.name).toBe("Quick quiz");
    expect(skillForCommand(db, "quiz me")).toBeNull();
    if (r.ok) saveSkill(db, { ...EXAMPLES[1], enabled: false }, r.skill.id);
    expect(skillForCommand(db, "/quiz")).toBeNull();
  });
  it("keeps commands unique and checks the shape", () => {
    const db = openDb(":memory:");
    saveSkill(db, EXAMPLES[1]);
    const clash = saveSkill(db, { ...EXAMPLES[0], command: "quiz" });
    expect(clash.ok).toBe(false);
    expect(saveSkill(db, { ...EXAMPLES[0], command: "no spaces" }).ok).toBe(false);
    expect(saveSkill(db, { ...EXAMPLES[0], command: "" }).ok).toBe(true);
    expect(saveSkill(db, { ...EXAMPLES[0], name: "Usage", command: "usage" }).ok).toBe(false);
  });
  it("always tells the model the safety rules come first", () => {
    const db = openDb(":memory:");
    const r = saveSkill(db, EXAMPLES[0]);
    if (r.ok) expect(skillText(r.skill, "Mum")).toMatch(/safety rules at the top always come first/);
  });
});
