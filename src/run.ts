import { showHUD, showToast, Toast } from "@raycast/api";
import { execFile } from "child_process";
import { promisify } from "util";
import { Choice } from "./types";
import { buildQuickAddUri, collectVars } from "./uri";

const execFileAsync = promisify(execFile);

export async function runChoice(vaultName: string, choice: Choice, values: string[]): Promise<void> {
  const uri = buildQuickAddUri(vaultName, choice.name, collectVars(choice.fields, values));
  const background = choice.type === "Capture";
  try {
    await execFileAsync("open", background ? ["-g", uri] : [uri]);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    await showToast({ style: Toast.Style.Failure, title: "Could not open Obsidian", message: stderr || String(error) });
    return;
  }
  await showHUD(background ? `Sent to QuickAdd: ${choice.name}` : `Opening in Obsidian: ${choice.name}`);
}
