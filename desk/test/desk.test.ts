import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanItem } from "../src/scan.js";
import { DeskStore } from "../src/store.js";

describe("desk scan", () => {
  const html = (body: string) => `<!doctype html><html><body>${body}</body></html>`;
  it("keeps a self-contained quiz", () => {
    expect(scanItem("html", html("<button onclick='mark()'>Check</button><script>let score=0;function mark(){score++}</script>")).ok).toBe(true);
  });
  it.each([
    ["<script src='https://cdn.example.com/x.js'></script>", "loads something from the internet"],
    ["<img src='//tracker.example/p.gif'>", "loads something from the internet"],
    ["<style>@import url(x.css)</style>", "imports from the internet"],
    ["<script>fetch('/api/me')</script>", "uses the network"],
    ["<script>new WebSocket('ws://x')</script>", "uses the network"],
    ["<script>localStorage.setItem('a',1)</script>", "uses storage"],
    ["<script>document.cookie</script>", "uses storage"],
    ["<script>window.parent.postMessage(1,'*')</script>", "opens windows or leaves the page"],
    ["<iframe src='x'></iframe>", "uses frames or embeds"],
    ["<script>navigator.mediaDevices.getUserMedia({video:true})</script>", "asks for the camera, microphone or location"],
  ])("refuses %s", (body, why) => {
    const r = scanItem("html", html(body));
    expect(r.ok).toBe(false);
    expect(r.problems).toContain(why);
  });
  it("doesn't mind the word 'fetch' in a story", () => {
    expect(scanItem("html", html("<p>The dog went to fetch the ball.</p>")).ok).toBe(true);
  });
  it("refuses scripts in drawings", () => {
    expect(scanItem("svg", "<svg><script>alert(1)</script></svg>").ok).toBe(false);
    expect(scanItem("svg", '<svg><rect onload="x()"/></svg>').ok).toBe(false);
    expect(scanItem("svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4"/></svg>').ok).toBe(true);
  });
  it("Markdown is just text", () => {
    expect(scanItem("md", "# A story\nfetch(x) is just words here").ok).toBe(true);
  });
});

describe("desk store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desk-"));
  const store = new DeskStore(dir);
  it("keeps versions, favourites and a bin", () => {
    const a = store.write({ kind: "story", title: "The Dragon Who Was Scared of Heights", format: "md", content: "Chapter 1" });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = store.write({ id: a.meta.id, kind: "story", title: a.meta.title, format: "md", content: "Chapter 1\n\nChapter 2" });
    expect(b.ok && b.meta.version).toBe(2);
    expect(store.read(a.meta.id)!.versions).toEqual([1, 2]);
    expect(store.read(a.meta.id, 1)!.content).toBe("Chapter 1");
    expect(store.setFavourite(a.meta.id, true)!.favourite).toBe(true);
    expect(store.list()).toHaveLength(1);
    expect(store.remove(a.meta.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
    expect(fs.readdirSync(path.join(dir, "trash"))).toHaveLength(1);
  });
  it("won't save something that fails the scan", () => {
    const r = store.write({ kind: "game", title: "Bad", format: "html", content: "<script>fetch('x')</script>" });
    expect(r.ok).toBe(false);
  });
  it("rejects path tricks in ids", () => {
    expect(() => store.read("../../etc")).not.toThrow();
    expect(store.read("../../etc")).toBeNull();
  });
});
