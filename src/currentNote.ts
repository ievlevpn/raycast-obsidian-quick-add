import { runCliText } from "./cli";

/**
 * QuickAdd reads the "current note" from Obsidian's active tab. To control it during a run, a temporary tab is
 * opened (empty for "no current note", or showing the chosen note) and closed afterwards — but only while it
 * is still untouched and active, so a note the choice opened in it (or anything else) is never closed.
 */

export interface Tab {
  kind: string;
  title: string;
  id: string;
}

export interface TabDeps {
  tabs(): Promise<Tab[]>;
  /** Open a new tab, empty or showing `note` (a vault path), and make it active. */
  open(note: string | null): Promise<void>;
  activePath(): Promise<string | null>;
  closeActive(): Promise<void>;
}

export interface TempTab {
  id: string;
  note: string | null;
}

/** `obsidian-cli tabs ids` prints `[kind] title<TAB>id` lines. */
export function parseTabs(text: string): Tab[] {
  return text
    .split("\n")
    .map((line) => /^\[([^\]]+)\] (.*)\t(\S+)$/.exec(line.replace(/\r$/, "")))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, kind, title, id]) => ({ kind, title, id }));
}

/** `obsidian-cli file` prints `path<TAB>…` for the active file, or an error when there is none. */
export function parseActivePath(text: string): string | null {
  const match = /^path\t(.+)$/m.exec(text);
  return match ? match[1].replace(/\r$/, "") : null;
}

const noteTitle = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/i, "");

export async function openTempTab(deps: TabDeps, note: string | null): Promise<TempTab | undefined> {
  const before = await deps.tabs();
  await deps.open(note);
  const after = await deps.tabs();
  const added = after.find((tab) => !before.some((old) => old.id === tab.id));
  const changed = after.find((tab) => {
    const old = before.find((candidate) => candidate.id === tab.id);
    return old !== undefined && (old.kind !== tab.kind || old.title !== tab.title);
  });
  // Obsidian reuses an existing empty tab, which then looks unchanged when we asked for an empty one.
  const reusedEmpty = note === null ? after.find((tab) => tab.kind === "empty") : undefined;
  const ours = added ?? changed ?? reusedEmpty;
  return ours ? { id: ours.id, note } : undefined;
}

export async function closeTempTab(deps: TabDeps, temp: TempTab | undefined): Promise<"closed" | "kept"> {
  if (!temp) return "kept";
  const tab = (await deps.tabs()).find((candidate) => candidate.id === temp.id);
  if (!tab) return "kept";
  const untouched = temp.note ? tab.kind === "markdown" && tab.title === noteTitle(temp.note) : tab.kind === "empty";
  if (!untouched) return "kept";
  const active = await deps.activePath();
  if (active !== temp.note) return "kept";
  await deps.closeActive();
  return "closed";
}

export function realTabDeps(cli: string, vaultName: string): TabDeps {
  const run = (command: string, args: string[] = []) => runCliText(cli, vaultName, command, args);
  return {
    tabs: async () => {
      const result = await run("tabs", ["ids"]);
      return result.kind === "text" ? parseTabs(result.text) : [];
    },
    open: async (note) => {
      await run("tab:open", note ? [`file=${note}`] : []);
    },
    activePath: async () => {
      const result = await run("file");
      return result.kind === "text" ? parseActivePath(result.text) : null;
    },
    closeActive: async () => {
      await run("command", ["id=workspace:close"]);
    },
  };
}
