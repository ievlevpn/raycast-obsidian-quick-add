import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { DEFAULT_OBSIDIAN_JSON } from "./config";

export const CLI_CANDIDATES = [
  "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli",
  join(homedir(), "Applications/Obsidian.app/Contents/MacOS/obsidian-cli"),
];

export function findCli(preferred?: string, candidates = CLI_CANDIDATES): string | undefined {
  if (preferred) return existsSync(preferred) ? preferred : undefined;
  return candidates.find((path) => existsSync(path));
}

export interface ObsidianRegistry {
  cli: boolean;
  openVaults: string[];
}

export const normalizePath = (path: string) => path.replace(/\/+$/, "");

export function readRegistry(path = DEFAULT_OBSIDIAN_JSON): ObsidianRegistry {
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      cli?: unknown;
      vaults?: Record<string, { path?: unknown; open?: unknown }>;
    };
    const openVaults = Object.values(data.vaults ?? {})
      .filter((vault) => vault.open === true && typeof vault.path === "string")
      .map((vault) => normalizePath(vault.path as string));
    return { cli: data.cli === true, openVaults };
  } catch {
    return { cli: false, openVaults: [] };
  }
}

export type CliFailure = "cli-disabled" | "not-running" | "quickadd-old" | "vault-not-found" | "unknown";
export type CliResult =
  { kind: "json"; data: Record<string, unknown> } | { kind: "failure"; reason: CliFailure; message: string };

/** obsidian-cli exits 0 even when it fails, so the outcome is read from stdout. */
export function classifyCliOutput(stdout: string): CliResult {
  const text = stdout.trim();
  if (text.startsWith("{")) {
    try {
      const data = JSON.parse(text);
      if (data && typeof data === "object" && !Array.isArray(data)) return { kind: "json", data };
    } catch {
      // not JSON after all; classified below
    }
  }
  const failure = (reason: CliFailure): CliResult => ({ kind: "failure", reason, message: text });
  if (/not enabled/i.test(text)) return failure("cli-disabled");
  if (/unable to find Obsidian/i.test(text)) return failure("not-running");
  if (/Command "quickadd:[^"]*" not found/i.test(text)) return failure("quickadd-old");
  if (/^Vault not found/im.test(text)) return failure("vault-not-found");
  return failure("unknown");
}

export function runCli(cli: string, vaultName: string, command: string, args: string[] = []): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(cli, [`vault=${vaultName}`, command, ...args], { timeout: 15000 }, (error, stdout, stderr) => {
      const output = `${stdout ?? ""}`.trim() ? `${stdout}` : `${stderr ?? ""}`;
      if (error && !output.trim()) {
        resolve({ kind: "failure", reason: "unknown", message: error.message });
        return;
      }
      resolve(classifyCliOutput(output));
    });
  });
}
