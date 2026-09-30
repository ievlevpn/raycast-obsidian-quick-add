import { readdirSync, statSync } from "fs";
import { join } from "path";

export interface Note {
  /** Vault-relative path, e.g. "Projects/Plan.md". */
  path: string;
  name: string;
  /** Vault-relative folder, "" for the vault root. */
  folder: string;
  /** Text for `[[…]]`: the note name, or its path (without .md) when another note has the same name. */
  link: string;
}

/**
 * Where a `[[` was just typed: compares the field's previous and next value and returns the index of
 * that `[[` in `next`, or undefined when the edit didn't end in a new `[[`.
 */
export function linkTriggerAt(prev: string, next: string): number | undefined {
  if (next.length <= prev.length) return undefined;
  let start = 0;
  while (start < prev.length && prev[start] === next[start]) start++;
  let tail = 0;
  while (tail < prev.length - start && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  const end = next.length - tail;
  return end >= 2 && next.slice(end - 2, end) === "[[" ? end - 2 : undefined;
}

/** Replace the `[[` at `start` with a finished `[[link]]`. */
export function insertLink(value: string, start: number, link: string): string {
  return `${value.slice(0, start)}[[${link}]]${value.slice(start + 2)}`;
}

/** Markdown notes in the vault, most recently modified first (hidden folders such as .obsidian are skipped). */
export function listNotes(vaultPath: string): Note[] {
  const found: { path: string; mtime: number }[] = [];
  const walk = (relative: string) => {
    let entries;
    try {
      entries = readdirSync(join(vaultPath, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        found.push({ path, mtime: statSync(join(vaultPath, path)).mtimeMs });
      }
    }
  };
  walk("");

  const nameCounts = new Map<string, number>();
  const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1, -".md".length);
  for (const { path } of found) nameCounts.set(nameOf(path), (nameCounts.get(nameOf(path)) ?? 0) + 1);

  return found
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ path }) => {
      const name = nameOf(path);
      const slash = path.lastIndexOf("/");
      return {
        path,
        name,
        folder: slash === -1 ? "" : path.slice(0, slash),
        link: (nameCounts.get(name) ?? 0) > 1 ? path.slice(0, -".md".length) : name,
      };
    });
}
