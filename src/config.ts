import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import { parseFields } from "./parse";
import { Choice } from "./types";

export const DEFAULT_OBSIDIAN_JSON = join(homedir(), "Library/Application Support/obsidian/obsidian.json");
export const QUICKADD_DATA = ".obsidian/plugins/quickadd/data.json";
export const OBSIDIAN_PROMPTS_NOTE = "Some prompts will appear in Obsidian.";

export class ConfigError extends Error {}

interface RawChoice {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  choices?: unknown;
  format?: { enabled?: boolean; format?: string };
  captureTo?: string;
  captureToActiveFile?: boolean;
  fileNameFormat?: { enabled?: boolean; format?: string };
  templatePath?: string;
  folder?: { enabled?: boolean; folders?: string[]; chooseWhenCreatingNote?: boolean; chooseFromSubfolders?: boolean };
}

export function findQuickAddVaults(obsidianJsonPath = DEFAULT_OBSIDIAN_JSON): string[] {
  let registry: { vaults?: Record<string, { path?: unknown }> };
  try {
    registry = JSON.parse(readFileSync(obsidianJsonPath, "utf8"));
  } catch {
    return [];
  }
  return Object.values(registry.vaults ?? {})
    .map((vault) => vault.path)
    .filter((path): path is string => typeof path === "string" && existsSync(join(path, QUICKADD_DATA)));
}

export function vaultName(vaultPath: string): string {
  return basename(vaultPath.replace(/\/+$/, ""));
}

export function loadChoices(vaultPath: string): Choice[] {
  const dataPath = join(vaultPath, QUICKADD_DATA);
  if (!existsSync(dataPath)) {
    throw new ConfigError(`QuickAdd settings not found at ${dataPath}. Is QuickAdd installed in this vault?`);
  }
  let data: { choices?: unknown };
  try {
    data = JSON.parse(readFileSync(dataPath, "utf8"));
  } catch (error) {
    throw new ConfigError(`Could not read QuickAdd settings (${dataPath}): ${(error as Error).message}`);
  }
  if (!Array.isArray(data.choices)) throw new ConfigError(`QuickAdd settings have no choices list (${dataPath}).`);

  const choices: Choice[] = [];
  flatten(data.choices, undefined, vaultPath, choices);
  noteDuplicateNames(choices);
  return choices;
}

function flatten(raws: unknown[], parentTitle: string | undefined, vaultPath: string, out: Choice[]) {
  for (const raw of raws as RawChoice[]) {
    if (typeof raw?.id !== "string" || typeof raw.name !== "string") continue;
    const title = parentTitle ? `${parentTitle} › ${raw.name}` : raw.name;
    if (raw.type === "Multi") {
      flatten(Array.isArray(raw.choices) ? raw.choices : [], title, vaultPath, out);
    } else {
      out.push(buildChoice(raw as RawChoice & { id: string; name: string }, title, vaultPath));
    }
  }
}

function buildChoice(raw: RawChoice & { id: string; name: string }, title: string, vaultPath: string): Choice {
  const type = typeof raw.type === "string" ? raw.type : "Unknown";
  const texts: string[] = [];
  const notes: string[] = [];
  let obsidianPrompts = false;
  let fileNameFromValue = false;

  if (type === "Capture") {
    texts.push(raw.format?.enabled && raw.format.format ? raw.format.format : "{{value}}");
    if (!raw.captureToActiveFile && raw.captureTo) {
      texts.push(raw.captureTo);
      if (raw.captureTo.startsWith("#") || raw.captureTo.endsWith("/")) obsidianPrompts = true;
    }
  } else if (type === "Template") {
    if (raw.fileNameFormat?.enabled && raw.fileNameFormat.format) {
      texts.push(raw.fileNameFormat.format);
    } else {
      texts.push("{{value}}");
      fileNameFromValue = true;
    }
    if (raw.templatePath) {
      const body = readTemplate(vaultPath, raw.templatePath);
      if (body === undefined) {
        notes.push(`Template file not found: ${raw.templatePath}. Only the file name fields are asked here.`);
      } else {
        texts.push(body);
      }
    }
    const folder = raw.folder;
    if (
      folder?.enabled &&
      (folder.chooseWhenCreatingNote || folder.chooseFromSubfolders || (folder.folders?.length ?? 0) > 1)
    ) {
      obsidianPrompts = true;
    }
  } else {
    obsidianPrompts = true;
  }

  const parsed =
    type === "Capture" || type === "Template" ? parseFields(texts) : { fields: [], hasObsidianPrompts: false };
  if (fileNameFromValue) {
    const valueField = parsed.fields.find((field) => field.key === "value");
    if (valueField) valueField.label = "File name";
  }
  if (obsidianPrompts || parsed.hasObsidianPrompts) notes.push(OBSIDIAN_PROMPTS_NOTE);

  return { id: raw.id, name: raw.name, title, type, fields: parsed.fields, notes };
}

function readTemplate(vaultPath: string, templatePath: string): string | undefined {
  for (const candidate of [templatePath, `${templatePath}.md`]) {
    const full = join(vaultPath, candidate);
    if (existsSync(full)) return readFileSync(full, "utf8");
  }
  return undefined;
}

function noteDuplicateNames(choices: Choice[]) {
  const counts = new Map<string, number>();
  for (const choice of choices) counts.set(choice.name, (counts.get(choice.name) ?? 0) + 1);
  for (const choice of choices) {
    if ((counts.get(choice.name) ?? 0) > 1) {
      choice.notes.push(
        `Another choice is also named "${choice.name}". QuickAdd runs choices by name, so it may run the other one.`,
      );
    }
  }
}
