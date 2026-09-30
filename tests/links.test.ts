import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";
import { insertLink, linkTriggerAt, listNotes } from "../src/links";

describe("linkTriggerAt", () => {
  it("finds a [[ just typed at the end", () => {
    expect(linkTriggerAt("see [", "see [[")).toBe(4);
    expect(linkTriggerAt("", "[[")).toBe(0);
  });

  it("finds a [[ just typed in the middle", () => {
    expect(linkTriggerAt("a[b", "a[[b")).toBe(1);
    expect(linkTriggerAt("one  two", "one [[ two")).toBe(4);
  });

  it("ignores other edits", () => {
    expect(linkTriggerAt("see [[", "see [[x")).toBeUndefined();
    expect(linkTriggerAt("see [[x", "see [[")).toBeUndefined();
    expect(linkTriggerAt("see", "see [[Note]]")).toBeUndefined();
    expect(linkTriggerAt("abc", "abc")).toBeUndefined();
    expect(linkTriggerAt("a", "a[")).toBeUndefined();
  });
});

describe("insertLink", () => {
  it("replaces the [[ with a finished link", () => {
    expect(insertLink("see [[", 4, "Note")).toBe("see [[Note]]");
    expect(insertLink("a[[b", 1, "Note")).toBe("a[[Note]]b");
  });
});

describe("listNotes", () => {
  function vault(files: Record<string, number>): string {
    const root = mkdtempSync(join(tmpdir(), "qa-links-"));
    for (const [path, mtime] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, "");
      utimesSync(full, mtime, mtime);
    }
    return root;
  }

  it("lists markdown notes, newest first, skipping hidden folders and other files", () => {
    const root = vault({
      "Old.md": 1000,
      "Projects/New.md": 3000,
      "Middle.md": 2000,
      "picture.png": 4000,
      ".obsidian/workspace.md": 5000,
      ".trash/Gone.md": 5000,
    });
    expect(listNotes(root)).toEqual([
      { path: "Projects/New.md", name: "New", folder: "Projects", link: "New" },
      { path: "Middle.md", name: "Middle", folder: "", link: "Middle" },
      { path: "Old.md", name: "Old", folder: "", link: "Old" },
    ]);
  });

  it("links by path when two notes share a name", () => {
    const root = vault({ "Ideas.md": 2000, "Archive/Ideas.md": 1000, "Solo.md": 500 });
    expect(listNotes(root).map((note) => note.link)).toEqual(["Ideas", "Archive/Ideas", "Solo"]);
  });

  it("returns nothing for a missing vault", () => {
    expect(listNotes("/nonexistent/vault")).toEqual([]);
  });
});
