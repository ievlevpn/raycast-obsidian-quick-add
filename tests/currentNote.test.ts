import { describe, expect, it } from "vitest";
import { closeTempTab, openTempTab, parseActivePath, parseTabs, Tab, TabDeps } from "../src/currentNote";

describe("parsing Obsidian CLI output", () => {
  it("reads `tabs ids`", () => {
    expect(parseTabs("[markdown] Garden plan\tca23\n[empty] New tab\td358\n[file-explorer] Files\t8c7c\n")).toEqual([
      { kind: "markdown", title: "Garden plan", id: "ca23" },
      { kind: "empty", title: "New tab", id: "d358" },
      { kind: "file-explorer", title: "Files", id: "8c7c" },
    ]);
  });

  it("reads the active file from `file`", () => {
    expect(parseActivePath("path\tProjects/Garden plan.md\nname\tGarden plan\n")).toBe("Projects/Garden plan.md");
    expect(parseActivePath("Error: No active file. Use file=<name> or path=<path> to specify a file.")).toBeNull();
  });
});

/** A fake Obsidian window: a list of tabs plus the active tab's file. */
function obsidian(initial: Tab[], active: string | null) {
  let tabs = [...initial];
  let activePath = active;
  let nextId = 1;
  const calls: string[] = [];
  const deps: TabDeps = {
    tabs: async () => tabs.map((t) => ({ ...t })),
    open: async (note) => {
      calls.push(`open ${note ?? "empty"}`);
      const reusable = tabs.find((t) => t.kind === "empty");
      const tab = {
        kind: note ? "markdown" : "empty",
        title: note ? note.replace(/^.*\//, "").replace(/\.md$/, "") : "New tab",
        id: "",
      };
      if (reusable) Object.assign(reusable, { kind: tab.kind, title: tab.title });
      else tabs.push({ ...tab, id: `t${nextId++}` });
      activePath = note;
    },
    activePath: async () => activePath,
    closeActive: async () => {
      calls.push("close");
    },
  };
  return {
    deps,
    calls,
    /** What the choice does in Obsidian while it runs. */
    change: (fn: (tabs: Tab[]) => Tab[], newActive: string | null) => {
      tabs = fn(tabs);
      activePath = newActive;
    },
  };
}

const garden: Tab = { kind: "markdown", title: "Garden plan", id: "g" };

describe("temporary tab for the current note", () => {
  it("opens an empty tab for 'no current note' and closes it afterwards", async () => {
    const o = obsidian([{ ...garden }], "Projects/Garden plan.md");
    const tab = await openTempTab(o.deps, null);
    expect(tab).toEqual({ id: "t1", note: null });
    expect(await closeTempTab(o.deps, tab)).toBe("closed");
    expect(o.calls).toEqual(["open empty", "close"]);
  });

  it("finds and closes a reused empty tab", async () => {
    const o = obsidian([{ kind: "empty", title: "New tab", id: "e" }], null);
    const tab = await openTempTab(o.deps, "Projects/Trip.md");
    expect(tab).toEqual({ id: "e", note: "Projects/Trip.md" });
    expect(await closeTempTab(o.deps, tab)).toBe("closed");
  });

  it("closes a chosen note's tab while it still shows that note and is active", async () => {
    const o = obsidian([{ ...garden }], "Projects/Garden plan.md");
    const tab = await openTempTab(o.deps, "Projects/Trip.md");
    expect(await closeTempTab(o.deps, tab)).toBe("closed");
  });

  it("keeps the tab when the choice opened its new note in it", async () => {
    const o = obsidian([{ ...garden }], "Projects/Garden plan.md");
    const tab = await openTempTab(o.deps, null);
    o.change(
      (tabs) => tabs.map((t) => (t.id === "t1" ? { ...t, kind: "markdown", title: "2026-10-01 Meeting" } : t)),
      "Meetings/2026-10-01 Meeting.md",
    );
    expect(await closeTempTab(o.deps, tab)).toBe("kept");
    expect(o.calls).toEqual(["open empty"]);
  });

  it("keeps the tab when it isn't the active one any more", async () => {
    const o = obsidian([{ ...garden }], "Projects/Garden plan.md");
    const tab = await openTempTab(o.deps, "Projects/Trip.md");
    o.change((tabs) => [...tabs, { kind: "markdown", title: "New note", id: "n" }], "New note.md");
    expect(await closeTempTab(o.deps, tab)).toBe("kept");
  });

  it("does nothing when the tab is gone or was never found", async () => {
    const o = obsidian([{ ...garden }], "Projects/Garden plan.md");
    const tab = await openTempTab(o.deps, null);
    o.change(() => [{ ...garden }], "Projects/Garden plan.md");
    expect(await closeTempTab(o.deps, tab)).toBe("kept");
    expect(await closeTempTab(o.deps, undefined)).toBe("kept");
  });
});
