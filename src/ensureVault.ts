import { CliFailure, CliResult, normalizePath, readRegistry, runCli } from "./cli";
import { openUri } from "./open";
import { buildOpenUri } from "./uri";

export interface VaultDeps {
  isOpen(): boolean;
  open(): Promise<void>;
  list(): Promise<CliResult>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export type VaultReady =
  { ok: true } | { ok: false; reason: CliFailure | "timeout" | "choice-missing"; message: string };

export function choiceIds(data: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const walk = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value as { id?: unknown; choices?: unknown }[]) {
      if (typeof item?.id === "string") ids.push(item.id);
      walk(item?.choices);
    }
  };
  walk(data.choices);
  return ids;
}

/**
 * A `vault=` command for a vault that isn't open makes Obsidian open it, and a command sent while it
 * loads can run in another window. Only report ready once that vault's QuickAdd lists the choice.
 */
export async function ensureVaultReady(choiceId: string, deps: VaultDeps, timeoutMs = 20000): Promise<VaultReady> {
  let opened = false;
  if (!deps.isOpen()) {
    await deps.open();
    opened = true;
  }
  const deadline = deps.now() + timeoutMs;
  for (;;) {
    const result = await deps.list();
    if (result.kind === "json") {
      if (choiceIds(result.data).includes(choiceId)) return { ok: true };
      if (!opened) {
        return {
          ok: false,
          reason: "choice-missing",
          message:
            "QuickAdd in this vault doesn't have this choice. Reload QuickAdd or restart Obsidian and try again.",
        };
      }
    } else if (result.reason === "not-running") {
      if (!opened) {
        await deps.open();
        opened = true;
      }
    } else {
      return { ok: false, reason: result.reason, message: result.message };
    }
    if (deps.now() >= deadline) {
      return {
        ok: false,
        reason: "timeout",
        message: "The vault didn't answer in time. Is it open in Obsidian with QuickAdd enabled?",
      };
    }
    await deps.sleep(500);
  }
}

export function realVaultDeps(cli: string, vaultName: string, vaultPath: string): VaultDeps {
  return {
    isOpen: () => readRegistry().openVaults.includes(normalizePath(vaultPath)),
    open: () => openUri(buildOpenUri(vaultName), true),
    list: () => runCli(cli, vaultName, "quickadd:list"),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}
