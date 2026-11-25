import { describe, expect, it } from "vitest";
import { hasKana, parseLesson, rows, toKatakana, toRomaji } from "../src/lib/kana";

describe("kana", () => {
  it("has all 46 of each script", () => {
    expect(rows("hiragana").flatMap((r) => r.kana)).toHaveLength(46);
    expect(rows("katakana")[1].kana.join("")).toBe("カキクケコ");
    expect(toKatakana("ねこ")).toBe("ネコ");
  });
  it("turns readings into romaji", () => {
    expect(toRomaji("ねこ")).toBe("neko");
    expect(toRomaji("がっこう")).toBe("gakkou");
    expect(toRomaji("ありがとう")).toBe("arigatou");
    expect(toRomaji("きょう")).toBe("kyou");
    expect(toRomaji("しゃしん")).toBe("shashin");
    expect(toRomaji("らーめん")).toBe("raamen");
    expect(toRomaji("アニメ")).toBe("anime");
    expect(toRomaji("こんにちは")).toBe("konnichiwa");
    expect(hasKana("hola")).toBe(false);
    expect(hasKana("ねこ")).toBe(true);
  });
});

describe("practice-chat replies", () => {
  it("split into text, hints, one correction and phrases to save", () => {
    const p = parseLesson("¡Muy bien! ((Very good!)) [[fix: yo voy al cine → voy al cine | no need for yo]] ¿Qué película? [[save: ¡qué guay! | how cool!]] [[save: el cine | the cinema]]");
    expect(p.map((x) => x.t)).toEqual(["text", "hint", "text", "fix", "text", "save", "text", "save"]);
    expect(p[3]).toEqual({ t: "fix", wrote: "yo voy al cine", better: "voy al cine", why: "no need for yo" });
    expect(p[5]).toEqual({ t: "save", front: "¡qué guay!", back: "how cool!", reading: "" });
  });
  it("read Japanese saves with a reading, and leave plain text alone", () => {
    expect(parseLesson("[[save: 猫 | cat | ねこ]]")[0]).toEqual({ t: "save", front: "猫", back: "cat", reading: "ねこ" });
    expect(parseLesson("Just chatting.")).toEqual([{ t: "text", text: "Just chatting." }]);
    expect(parseLesson("[[save: only a front]]")).toEqual([]);
  });
});
