import { Field } from "./types";

/** Query parameter naming the vault; confirmed by the URI spike (docs/superpowers/notes). */
export const VAULT_PARAM = "vault";

export function collectVars(fields: Field[], values: string[]): Record<string, string> {
  const vars: Record<string, string> = {};
  fields.forEach((field, index) => {
    const value = values[index] ?? "";
    vars[field.key] = value;
    if (field.rawKey !== field.key) vars[field.rawKey] = value;
  });
  return vars;
}

export function buildQuickAddUri(vaultName: string, choiceName: string, vars: Record<string, string>): string {
  const params = [`${VAULT_PARAM}=${encodeURIComponent(vaultName)}`, `choice=${encodeURIComponent(choiceName)}`];
  for (const [key, value] of Object.entries(vars)) {
    params.push(`value-${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return `obsidian://quickadd?${params.join("&")}`;
}
