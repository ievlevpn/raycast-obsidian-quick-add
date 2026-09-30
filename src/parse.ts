import { Field } from "./types";

const VALUE_TOKEN = /\{\{\s*(?:value|name)\s*(?::([^}]*))?\}\}/gi;
const OBSIDIAN_PROMPT = /tp\.system\.(?:prompt|suggester)|\{\{\s*(?:vdate|field|macro)\s*:/i;

export function parseToken(spec: string | undefined): Field {
  const [first = "", ...modifiers] = (spec ?? "").split("|");
  const key = first.trim();
  if (key === "") return { key: "value", rawKey: "value", label: "Value", optional: false };

  const field: Field = { key, rawKey: first, label: key, optional: false };
  if (key.includes(",")) {
    field.options = key
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean);
  }
  for (const raw of modifiers) {
    const modifier = raw.trim();
    const lower = modifier.toLowerCase();
    if (lower.startsWith("label:")) field.label = modifier.slice("label:".length).trim() || key;
    else if (lower.startsWith("default:")) field.defaultValue = modifier.slice("default:".length).trim();
    else if (lower === "optional") field.optional = true;
  }
  return field;
}

export function parseFields(texts: string[]): { fields: Field[]; hasObsidianPrompts: boolean } {
  const byKey = new Map<string, Field>();
  for (const text of texts) {
    for (const match of text.matchAll(VALUE_TOKEN)) {
      const field = parseToken(match[1]);
      if (!byKey.has(field.key)) byKey.set(field.key, field);
    }
  }
  return { fields: [...byKey.values()], hasObsidianPrompts: texts.some((text) => OBSIDIAN_PROMPT.test(text)) };
}
