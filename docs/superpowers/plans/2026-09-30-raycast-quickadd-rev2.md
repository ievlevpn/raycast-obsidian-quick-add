# Raycast QuickAdd — Rev 2 Implementation Plan (interactive CLI + basic fallback)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run any QuickAdd choice from Raycast and answer whatever QuickAdd asks in Raycast through QuickAdd's `quickadd:interactive` CLI (full mode), falling back to the existing URI path (basic mode) when the Obsidian CLI is missing or off.

**Architecture:** New Raycast-free modules — `cli.ts` (find/run/classify the CLI), `mode.ts` (full vs basic), `replies.ts` (QuickAdd prompt ⇄ Raycast form specs and reply values), `session.ts` (HTTP long-poll client for QuickAdd's interactive server), `ensureVault.ts` (make sure the command reaches the right vault), `open.ts` (macOS `open`) — are unit-tested with vitest, including an in-process fake QuickAdd server and fake CLI scripts. Thin Raycast views (`RunSession.tsx`, `prompts/*.tsx`) render one prompt at a time. Basic mode is the rev-1 code with the reviewer's generic fixes.

**Tech Stack:** TypeScript, React, `@raycast/api` ^2.5.3, `@raycast/utils` ^2.3.2, vitest ^3.2.6, Node ≥ 22 (global `fetch`), ESLint 9 + `@raycast/eslint-config`, Prettier 3.

**Spec:** `docs/superpowers/specs/2026-09-30-raycast-quickadd-design.md` (rev 2). Evidence: `docs/superpowers/notes/2026-09-30-cli-spike.md`, `docs/superpowers/notes/2026-09-30-uri-spike.md`.

**Starting point:** branch `feat/quickadd-extension`; rev-1 plan Tasks 1–5 are done (list, quicklinks, basic URI mode, 29 tests). Rev-1 Task 6 (E2E) is superseded by Task 8 here.

## Global Constraints

- Generic: nothing in `src/` may reference a particular user's choices, vault, or paths.
- The extension never writes vault files; QuickAdd does all writing.
- CLI call shape: `execFile(cli, ["vault=<vaultName>", "quickadd:<cmd>", ...args])`. The CLI exits 0 on failure — always classify stdout.
- Interactive server: `http://127.0.0.1:<port>/{poll,reply,abort}?session=<id>&token=<token>`; the client keeps polling for the whole session (server watchdog 75 s).
- Reply values: form → `{[fieldId]: string | string[]}`; input → string; suggester → item `value` or custom text; multiselect/checkbox → string[]; date → `"@date:<ISO>"`; confirm → boolean; info → `true`.
- Full-mode HUD: `created` → "Created <file>", `changed` → "Added to <file>", else "Ran <choice>". Basic-mode HUD stays "Sent to QuickAdd: <choice>".
- Basic-mode reasons (verbatim):
  - `no-cli`: "Update Obsidian to 1.12 or later for full QuickAdd support."
  - `cli-disabled`: "Turn on Settings → General → Advanced → Command line interface in Obsidian, then restart Obsidian."
  - `quickadd-old`: "Update the QuickAdd plugin to 2.27 or later for full support."
- `@raycast/api` 2.x: if a prop fails to type-check, adapt using `node_modules/@raycast/api/types/index.d.ts`; don't downgrade.
- Tests never touch `/Users/ievlevpn/main-vault`. Only Task 8 uses a real vault — the repo's `e2e-vault/`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **User takes longer than 75 s on a prompt** — the poll loop must keep running independently of the UI so QuickAdd doesn't end the session. Pinned by Task 4's "keeps polling through idle events and still accepts a late reply" test.
2. **Raycast view closed or popped mid-run** — the session must be aborted, not left hanging in Obsidian. Pinned by Task 4's abort tests; checked manually in Task 8.
3. **Vault not open / Obsidian not running** — the run must land in the requested vault or fail clearly, never in another vault. Pinned by Task 5's tests.
4. **CLI switched on in settings but Obsidian not restarted** (`not enabled` at run time) — the run must fall back to basic mode, not error. Pinned by Task 2's classification test and Task 4's `startSession` test; checked in Task 8.
5. **Prompt or field types a newer QuickAdd adds** — unknown field types render as text fields; unknown prompt types show an "unsupported" view with Cancel. Pinned by Task 3's tests.

---

## File Structure

```
src/types.ts           + Choice.openFile, Choice.promptsInObsidian
src/parse.ts           token grammar fixes, isLoneValue
src/config.ts          robustness + more "prompts in Obsidian" cases, openFile
src/uri.ts             + runsInBackground, buildOpenUri
src/open.ts            NEW  openUri(uri, background) via macOS `open`
src/run.ts             uses open.ts + runsInBackground
src/ChoiceForm.tsx     isLoneValue, optional `notice`
src/cli.ts             NEW  findCli, readRegistry, normalizePath, classifyCliOutput, runCli
src/mode.ts            NEW  detectMode, REASON_TEXT
src/replies.ts         NEW  QuickAdd prompt types, FieldSpec, specs/reply builders, view text helpers
src/session.ts         NEW  InteractiveSession, startSession, doneMessage
src/ensureVault.ts     NEW  ensureVaultReady, choiceIds, realVaultDeps
src/prompts/CancelAction.tsx, FormPrompt.tsx, SuggesterPrompt.tsx, MessagePrompt.tsx   NEW
src/RunSession.tsx     NEW  full-mode run view (+ basic fallback)
src/quickadd.tsx       mode banner, full/basic routing, cliPath preference
package.json           + cliPath preference
tests/parse.test.ts, tests/config.test.ts, tests/uri.test.ts   extended
tests/cli.test.ts, tests/mode.test.ts, tests/replies.test.ts, tests/session.test.ts, tests/ensureVault.test.ts   NEW
tests/helpers/fakeCli.ts, tests/helpers/fakeQuickAdd.ts   NEW
e2e-vault/…            NEW  fixture vault (Task 7)
scripts/setup-e2e-vault.sh   NEW
README.md              modes, CLI setup
```

---

### Task 1: Basic-mode fixes (generic QuickAdd grammar and robustness)

**Files:**
- Modify: `src/types.ts`, `src/parse.ts`, `src/config.ts`, `src/uri.ts`, `src/run.ts`, `src/ChoiceForm.tsx`
- Create: `src/open.ts`
- Test: `tests/parse.test.ts`, `tests/config.test.ts`, `tests/uri.test.ts`

**Interfaces:**
- Produces: `Choice` gains `openFile: boolean`, `promptsInObsidian: boolean`; `isLoneValue(fields: Field[]): boolean` (parse.ts); `runsInBackground(choice: Choice): boolean`, `buildOpenUri(vaultName: string, file?: string): string` (uri.ts); `openUri(uri: string, background?: boolean): Promise<void>` (open.ts).

- [ ] **Step 1: Write the failing tests** — append to the existing files.

Append to `tests/parse.test.ts`:

```ts
import { isLoneValue } from "../src/parse";

describe("QuickAdd token grammar", () => {
  it("reads modifiers on plain value tokens", () => {
    const [f] = parseFields(["{{VALUE|label:Note|default:hi}}"]).fields;
    expect(f).toMatchObject({ key: "value", label: "Note", defaultValue: "hi" });
    expect(parseFields(["{{NAME|optional}}"]).fields[0]).toMatchObject({ key: "value", optional: true });
  });

  it("does not treat {{NAME:…}} as a value token", () => {
    expect(keys(["{{NAME:foo}}"])).toEqual([]);
  });

  it("uses |name: as the variable key", () => {
    expect(parseFields(["{{VALUE:red,green|name:colour}}"]).fields[0]).toMatchObject({
      key: "colour",
      rawKey: "colour",
      label: "colour",
      options: ["red", "green"],
    });
  });

  it("leaves |custom and |multi option lists to Obsidian", () => {
    for (const token of ["{{VALUE:a,b|custom}}", "{{VALUE:a,b|multi}}"]) {
      const parsed = parseFields([token]);
      expect(parsed.fields).toEqual([]);
      expect(parsed.hasObsidianPrompts).toBe(true);
    }
  });

  it("dedupes keys case-insensitively and ignores tokens spanning lines", () => {
    expect(keys(["{{VALUE:Title}} {{value:title}}"])).toEqual(["Title"]);
    expect(keys(["{{VALUE:line\nbreak}}"])).toEqual([]);
  });

  it("flags more tokens that prompt in Obsidian", () => {
    for (const text of ["{{FILE:notes}}", "{{MVALUE}}", "{{TEMPLATE:t.md}}", "<% tp.system.multi_suggester(a, b) %>"]) {
      expect(parseFields([text]).hasObsidianPrompts).toBe(true);
    }
  });
});

describe("isLoneValue", () => {
  it("is true only for a single plain value field with the default label", () => {
    expect(isLoneValue(parseFields(["{{VALUE}}"]).fields)).toBe(true);
    expect(isLoneValue([{ key: "value", rawKey: "value", label: "File name", optional: false }])).toBe(false);
    expect(isLoneValue(parseFields(["{{VALUE}} {{VALUE:x}}"]).fields)).toBe(false);
  });
});
```

Append to `tests/uri.test.ts`:

```ts
import { buildOpenUri, runsInBackground } from "../src/uri";
import { Choice } from "../src/types";

const choice = (over: Partial<Choice>): Choice => ({
  id: "i",
  name: "n",
  title: "n",
  type: "Capture",
  fields: [],
  notes: [],
  openFile: false,
  promptsInObsidian: false,
  ...over,
});

describe("runsInBackground", () => {
  it("runs quiet captures in the background and everything else in front", () => {
    expect(runsInBackground(choice({}))).toBe(true);
    expect(runsInBackground(choice({ promptsInObsidian: true }))).toBe(false);
    expect(runsInBackground(choice({ type: "Template" }))).toBe(false);
  });
});

describe("buildOpenUri", () => {
  it("opens a vault, or a file in it", () => {
    expect(buildOpenUri("my vault")).toBe("obsidian://open?vault=my%20vault");
    expect(buildOpenUri("v", "People/A & B.md")).toBe("obsidian://open?vault=v&file=People%2FA%20%26%20B.md");
  });
});
```

Append to `tests/config.test.ts` (reuses `makeVault`, `capture`, `template`, `write` already in the file; add `chmodSync` and `mkdirSync` to the `fs` import):

```ts
describe("loadChoices robustness", () => {
  it("treats a template path that is a folder as missing", () => {
    const vault = makeVault([template({ templatePath: "Templates" })]);
    mkdirSync(join(vault, "Templates"), { recursive: true });
    const [t] = loadChoices(vault);
    expect(t.notes.join(" ")).toMatch(/Template file not found/);
  });

  it("ignores non-string config values", () => {
    const [c] = loadChoices(makeVault([capture({ captureTo: 42, format: { enabled: true, format: 7 } })]));
    expect(c.fields.map((f) => f.key)).toEqual(["value"]);
  });

  it("keeps the list when one choice cannot be read", () => {
    const vault = makeVault([template(), capture({ id: "c2" })], { "Templates/math_idea.md": "{{VALUE:x}}" });
    chmodSync(join(vault, "Templates/math_idea.md"), 0o000);
    const choices = loadChoices(vault);
    expect(choices.map((c) => c.id)).toEqual(["t1", "c2"]);
    expect(choices[0].notes.join(" ")).toMatch(/Could not read this choice's settings/);
    expect(choices[0].promptsInObsidian).toBe(true);
  });
});

describe("loadChoices prompts in Obsidian", () => {
  const prompts = (choices: unknown[], files: Record<string, string> = {}) => loadChoices(makeVault(choices, files))[0];

  it("is false for a plain capture and true for pickers", () => {
    expect(prompts([capture()]).promptsInObsidian).toBe(false);
    expect(prompts([capture({ captureTo: "" })]).promptsInObsidian).toBe(true);
    expect(prompts([capture({ captureTo: "property:type=draft" })]).promptsInObsidian).toBe(true);
    expect(prompts([capture({ createFileIfItDoesntExist: { enabled: true, createWithTemplate: true, template: "T.md" } })]).promptsInObsidian).toBe(true);
    expect(prompts([template({ folder: { enabled: true, folders: [] } })], { "Templates/math_idea.md": "" }).promptsInObsidian).toBe(true);
  });

  it("detects a capture target that is an existing folder", () => {
    const vault = makeVault([capture({ captureTo: "Inbox" })]);
    mkdirSync(join(vault, "Inbox"));
    expect(loadChoices(vault)[0].notes).toContain(OBSIDIAN_PROMPTS_NOTE);
  });

  it("reads openFile", () => {
    expect(prompts([template({ openFile: true })], { "Templates/math_idea.md": "" }).openFile).toBe(true);
    expect(prompts([capture()]).openFile).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `isLoneValue`, `runsInBackground`, `buildOpenUri` not exported; the new config assertions fail (`promptsInObsidian` undefined, `EISDIR`/`EACCES` thrown).

- [ ] **Step 3: Implement**

`src/types.ts` — add to `Choice`:

```ts
  /** QuickAdd opens the resulting note (the choice's `openFile` setting). */
  openFile: boolean;
  /** Basic mode: QuickAdd will still ask something inside Obsidian. */
  promptsInObsidian: boolean;
```

`src/parse.ts` — replace the whole file:

```ts
import { Field } from "./types";

// {{VALUE}} / {{NAME}} with optional |modifiers → group 1; {{VALUE:spec}} → group 2.
const VALUE_TOKEN = /\{\{(?:(?:VALUE|NAME)(?:\|([^\n\r{}]*))?|VALUE:([^\n\r{}]*))\}\}/gi;
const OBSIDIAN_PROMPT =
  /tp\.system\.(?:prompt|suggester|multi_suggester)|\{\{(?:VDATE|FIELD|MACRO|FILE|TEMPLATE):|\{\{MVALUE\}\}/i;

interface Modifiers {
  label?: string;
  defaultValue?: string;
  name?: string;
  optional: boolean;
  custom: boolean;
  multi: boolean;
}

function parseModifiers(parts: string[]): Modifiers {
  const mods: Modifiers = { optional: false, custom: false, multi: false };
  for (const raw of parts) {
    const part = raw.trim();
    const colon = part.indexOf(":");
    const name = (colon === -1 ? part : part.slice(0, colon)).trim().toLowerCase();
    const value = colon === -1 ? "" : part.slice(colon + 1).trim();
    if (name === "label") mods.label = value || undefined;
    else if (name === "default") mods.defaultValue = value;
    else if (name === "name") mods.name = value || undefined;
    else if (name === "optional") mods.optional = true;
    else if (name === "custom") mods.custom = true;
    else if (name === "multi") mods.multi = true;
  }
  return mods;
}

function applyModifiers(field: Field, mods: Modifiers): Field {
  if (mods.label) field.label = mods.label;
  if (mods.defaultValue !== undefined) field.defaultValue = mods.defaultValue;
  if (mods.optional) field.optional = true;
  return field;
}

const plain = (): Field => ({ key: "value", rawKey: "value", label: "Value", optional: false });

function tokenField(spec: string): { field: Field; obsidianOnly: boolean } {
  const [first = "", ...rest] = spec.split("|");
  const mods = parseModifiers(rest);
  const key = first.trim();
  if (key === "") return { field: applyModifiers(plain(), mods), obsidianOnly: false };

  const field: Field = { key, rawKey: first, label: key, optional: false };
  if (key.includes(",")) {
    field.options = key
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean);
  }
  if (mods.name) {
    field.key = mods.name;
    field.rawKey = mods.name;
    field.label = mods.name;
  }
  return { field: applyModifiers(field, mods), obsidianOnly: Boolean(field.options) && (mods.custom || mods.multi) };
}

/** Field for `{{VALUE:<spec>}}`. */
export function parseToken(spec: string | undefined): Field {
  return tokenField(spec ?? "").field;
}

export function parseFields(texts: string[]): { fields: Field[]; hasObsidianPrompts: boolean } {
  const byKey = new Map<string, Field>();
  let hasObsidianPrompts = texts.some((text) => OBSIDIAN_PROMPT.test(text));
  for (const text of texts) {
    for (const match of text.matchAll(VALUE_TOKEN)) {
      const { field, obsidianOnly } =
        match[2] !== undefined
          ? tokenField(match[2])
          : { field: applyModifiers(plain(), parseModifiers(match[1] ? match[1].split("|") : [])), obsidianOnly: false };
      if (obsidianOnly) {
        hasObsidianPrompts = true;
        continue;
      }
      const id = field.key.toLowerCase();
      if (!byKey.has(id)) byKey.set(id, field);
    }
  }
  return { fields: [...byKey.values()], hasObsidianPrompts };
}

/** A single plain `{{VALUE}}` with its default label — shown as one text area. */
export function isLoneValue(fields: Field[]): boolean {
  return fields.length === 1 && fields[0].key === "value" && fields[0].label === "Value" && !fields[0].options;
}
```

`src/config.ts` — replace `RawChoice`, `flatten`, `buildChoice`, `readTemplate` (keep the exports above them and `noteDuplicateNames`); change the `fs` import to `import { existsSync, readFileSync, statSync } from "fs";`:

```ts
interface RawChoice {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  choices?: unknown;
  format?: { enabled?: unknown; format?: unknown };
  captureTo?: unknown;
  captureToActiveFile?: unknown;
  createFileIfItDoesntExist?: { enabled?: unknown; createWithTemplate?: unknown };
  fileNameFormat?: { enabled?: unknown; format?: unknown };
  templatePath?: unknown;
  folder?: { enabled?: unknown; folders?: unknown; chooseWhenCreatingNote?: unknown; chooseFromSubfolders?: unknown };
  openFile?: unknown;
}

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

function flatten(raws: unknown[], parentTitle: string | undefined, vaultPath: string, out: Choice[]) {
  for (const raw of raws as RawChoice[]) {
    if (typeof raw?.id !== "string" || typeof raw.name !== "string") continue;
    const title = parentTitle ? `${parentTitle} › ${raw.name}` : raw.name;
    if (raw.type === "Multi") {
      flatten(Array.isArray(raw.choices) ? raw.choices : [], title, vaultPath, out);
      continue;
    }
    try {
      out.push(buildChoice(raw as RawChoice & { id: string; name: string }, title, vaultPath));
    } catch (error) {
      out.push({
        id: raw.id,
        name: raw.name,
        title,
        type: str(raw.type) ?? "Unknown",
        fields: [],
        notes: [`Could not read this choice's settings: ${(error as Error).message}`, OBSIDIAN_PROMPTS_NOTE],
        openFile: false,
        promptsInObsidian: true,
      });
    }
  }
}

function buildChoice(raw: RawChoice & { id: string; name: string }, title: string, vaultPath: string): Choice {
  const type = str(raw.type) ?? "Unknown";
  const texts: string[] = [];
  const notes: string[] = [];
  let obsidianPrompts = false;
  let fileNameFromValue = false;

  if (type === "Capture") {
    const format = raw.format?.enabled === true ? str(raw.format.format) : undefined;
    texts.push(format || "{{value}}");
    if (raw.captureToActiveFile !== true) {
      const target = str(raw.captureTo)?.trim() ?? "";
      if (target) texts.push(target);
      if (captureTargetPicks(vaultPath, target)) obsidianPrompts = true;
    }
    const create = raw.createFileIfItDoesntExist;
    if (create?.enabled === true && create.createWithTemplate === true) obsidianPrompts = true;
  } else if (type === "Template") {
    const format = raw.fileNameFormat?.enabled === true ? str(raw.fileNameFormat.format) : undefined;
    if (format) {
      texts.push(format);
    } else {
      texts.push("{{value}}");
      fileNameFromValue = true;
    }
    const templatePath = str(raw.templatePath);
    if (templatePath) {
      const body = readTemplate(vaultPath, templatePath);
      if (body === undefined) {
        notes.push(`Template file not found: ${templatePath}. Only the file name fields are asked here.`);
      } else {
        texts.push(body);
      }
    }
    const folder = raw.folder;
    if (folder?.enabled === true) {
      const folders = Array.isArray(folder.folders) ? folder.folders : [];
      if (folder.chooseWhenCreatingNote === true || folder.chooseFromSubfolders === true || folders.length !== 1) {
        obsidianPrompts = true;
      }
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
  const promptsInObsidian = obsidianPrompts || parsed.hasObsidianPrompts;
  if (promptsInObsidian) notes.push(OBSIDIAN_PROMPTS_NOTE);

  return {
    id: raw.id,
    name: raw.name,
    title,
    type,
    fields: parsed.fields,
    notes,
    openFile: raw.openFile === true,
    promptsInObsidian,
  };
}

/** QuickAdd shows a file picker for empty, #tag, property:, folder/ and existing-folder targets. */
function captureTargetPicks(vaultPath: string, target: string): boolean {
  if (target === "") return true;
  if (target.startsWith("#") || target.endsWith("/") || /^property:/i.test(target)) return true;
  if (target.includes("{{")) return false;
  return isDirectory(join(vaultPath, target));
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readTemplate(vaultPath: string, templatePath: string): string | undefined {
  for (const candidate of [templatePath, `${templatePath}.md`]) {
    const full = join(vaultPath, candidate);
    if (isFile(full)) return readFileSync(full, "utf8");
  }
  return undefined;
}
```

If `existsSync` is now unused except in `findQuickAddVaults`/`loadChoices`, keep it (both still use it).

`src/open.ts`:

```ts
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Open a URI with macOS `open`; `background` keeps the target app behind the current one. */
export async function openUri(uri: string, background = false): Promise<void> {
  await execFileAsync("open", background ? ["-g", uri] : [uri]);
}
```

`src/uri.ts` — add (and `import { Choice, Field } from "./types";`):

```ts
/** Basic mode: quiet captures stay in the background; anything that may prompt in Obsidian comes forward. */
export function runsInBackground(choice: Choice): boolean {
  return choice.type === "Capture" && !choice.promptsInObsidian;
}

export function buildOpenUri(vaultName: string, file?: string): string {
  const params = [`vault=${encodeURIComponent(vaultName)}`];
  if (file) params.push(`file=${encodeURIComponent(file)}`);
  return `obsidian://open?${params.join("&")}`;
}
```

`src/run.ts` — replace the whole file:

```ts
import { showHUD, showToast, Toast } from "@raycast/api";
import { openUri } from "./open";
import { Choice } from "./types";
import { buildQuickAddUri, collectVars, runsInBackground } from "./uri";

/** Basic mode: run a choice through the obsidian://quickadd URI. */
export async function runChoice(vaultName: string, choice: Choice, values: string[]): Promise<void> {
  const uri = buildQuickAddUri(vaultName, choice.name, collectVars(choice.fields, values));
  const background = runsInBackground(choice);
  try {
    await openUri(uri, background);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    await showToast({ style: Toast.Style.Failure, title: "Could not open Obsidian", message: stderr || String(error) });
    return;
  }
  await showHUD(background ? `Sent to QuickAdd: ${choice.name}` : `Opening in Obsidian: ${choice.name}`);
}
```

`src/ChoiceForm.tsx` — (a) signature `({ vaultName, choice, notice }: { vaultName: string; choice: Choice; notice?: string })`; (b) replace the `loneValue` line with `const loneValue = isLoneValue(choice.fields);` and add `import { isLoneValue } from "./parse";`; (c) as the first child of `<Form>` add:

```tsx
      {notice ? <Form.Description key="notice" title="Basic Mode" text={notice} /> : null}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass (29 earlier + the new ones); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "fix: follow QuickAdd's token grammar and harden basic mode"
```

---

### Task 2: CLI discovery, invocation and mode detection

**Files:**
- Create: `src/cli.ts`, `src/mode.ts`, `tests/helpers/fakeCli.ts`, `tests/cli.test.ts`, `tests/mode.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_OBSIDIAN_JSON` (config.ts).
- Produces:
  - cli.ts: `CLI_CANDIDATES: string[]`, `findCli(preferred?: string, candidates?: string[]): string | undefined`, `interface ObsidianRegistry { cli: boolean; openVaults: string[] }`, `readRegistry(path?: string): ObsidianRegistry`, `normalizePath(path: string): string`, `type CliFailure = "cli-disabled" | "not-running" | "quickadd-old" | "vault-not-found" | "unknown"`, `type CliResult = { kind: "json"; data: Record<string, unknown> } | { kind: "failure"; reason: CliFailure; message: string }`, `classifyCliOutput(stdout: string): CliResult`, `runCli(cli: string, vaultName: string, command: string, args?: string[]): Promise<CliResult>`.
  - mode.ts: `type BasicReason = "no-cli" | "cli-disabled" | "quickadd-old"`, `REASON_TEXT: Record<BasicReason, string>`, `type Mode = { mode: "full"; cli: string } | { mode: "basic"; reason: BasicReason }`, `detectMode(cli: string | undefined, registry: ObsidianRegistry): Mode`, `isBasicReason(reason: string): reason is BasicReason`.
  - tests/helpers/fakeCli.ts: `fakeCli(script: string): string` (writes an executable `sh` script, returns its path).

- [ ] **Step 1: Write the failing tests**

`tests/helpers/fakeCli.ts`:

```ts
import { chmodSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/** Write an executable shell script standing in for obsidian-cli; returns its path. */
export function fakeCli(script: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "qa-cli-")), "obsidian-cli");
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** Shell-quote a string for use inside a fake CLI script. */
export const sq = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;
```

`tests/cli.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { classifyCliOutput, findCli, readRegistry, runCli } from "../src/cli";
import { fakeCli, sq } from "./helpers/fakeCli";

describe("classifyCliOutput", () => {
  it("parses QuickAdd JSON", () => {
    expect(classifyCliOutput('\n{"command":"quickadd:list","ok":true,"count":0,"choices":[]}\n')).toEqual({
      kind: "json",
      data: { command: "quickadd:list", ok: true, count: 0, choices: [] },
    });
  });

  it.each([
    ["Command line interface is not enabled. Please turn it on in Settings > General > Advanced.", "cli-disabled"],
    ["The CLI is unable to find Obsidian. Please make sure Obsidian is running and try again.", "not-running"],
    ['Error: Command "quickadd:interactive" not found. It may require a plugin to be enabled.', "quickadd-old"],
    ["Vault not found.", "vault-not-found"],
    ["something else entirely", "unknown"],
    ["{broken json", "unknown"],
  ])("classifies %j as %s", (stdout, reason) => {
    expect(classifyCliOutput(stdout)).toEqual({ kind: "failure", reason, message: stdout.trim() });
  });
});

describe("findCli", () => {
  it("prefers the configured path when it exists", () => {
    const cli = fakeCli("true");
    expect(findCli(cli, [])).toBe(cli);
    expect(findCli("/nonexistent/obsidian-cli", [cli])).toBeUndefined();
  });

  it("falls back to the first existing candidate", () => {
    const cli = fakeCli("true");
    expect(findCli(undefined, ["/nonexistent/a", cli])).toBe(cli);
    expect(findCli(undefined, ["/nonexistent/a"])).toBeUndefined();
  });
});

describe("readRegistry", () => {
  it("reads the cli flag and open vaults", () => {
    const path = join(mkdtempSync(join(tmpdir(), "qa-reg-")), "obsidian.json");
    writeFileSync(
      path,
      JSON.stringify({ cli: true, vaults: { a: { path: "/v/one/", open: true }, b: { path: "/v/two" } } }),
    );
    expect(readRegistry(path)).toEqual({ cli: true, openVaults: ["/v/one"] });
  });

  it("defaults to CLI off and nothing open", () => {
    expect(readRegistry("/nonexistent/obsidian.json")).toEqual({ cli: false, openVaults: [] });
  });
});

describe("runCli", () => {
  it("passes vault= first, then the command and its args", async () => {
    const cli = fakeCli(`printf '{"args":"%s"}' "$*"`);
    expect(await runCli(cli, "my-vault", "quickadd:check", ["choice=A B"])).toEqual({
      kind: "json",
      data: { args: "vault=my-vault quickadd:check choice=A B" },
    });
  });

  it("classifies failure text printed with exit code 0", async () => {
    const cli = fakeCli(`printf '%s' ${sq("Command line interface is not enabled.")}`);
    expect(await runCli(cli, "v", "quickadd:list")).toMatchObject({ kind: "failure", reason: "cli-disabled" });
  });

  it("reports a crashing or missing binary as unknown", async () => {
    expect(await runCli(fakeCli("exit 3"), "v", "quickadd:list")).toMatchObject({ kind: "failure", reason: "unknown" });
    expect(await runCli("/nonexistent/obsidian-cli", "v", "quickadd:list")).toMatchObject({
      kind: "failure",
      reason: "unknown",
    });
  });
});
```

`tests/mode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectMode, isBasicReason, REASON_TEXT } from "../src/mode";

describe("detectMode", () => {
  it("needs a CLI binary", () => {
    expect(detectMode(undefined, { cli: true, openVaults: [] })).toEqual({ mode: "basic", reason: "no-cli" });
  });

  it("needs the CLI switched on", () => {
    expect(detectMode("/x/obsidian-cli", { cli: false, openVaults: [] })).toEqual({
      mode: "basic",
      reason: "cli-disabled",
    });
  });

  it("is full otherwise", () => {
    expect(detectMode("/x/obsidian-cli", { cli: true, openVaults: [] })).toEqual({ mode: "full", cli: "/x/obsidian-cli" });
  });

  it("has user-facing text for every reason", () => {
    expect(REASON_TEXT["cli-disabled"]).toBe(
      "Turn on Settings → General → Advanced → Command line interface in Obsidian, then restart Obsidian.",
    );
    expect(isBasicReason("quickadd-old")).toBe(true);
    expect(isBasicReason("timeout")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli.test.ts tests/mode.test.ts`
Expected: FAIL — cannot resolve `../src/cli` / `../src/mode`.

- [ ] **Step 3: Implement**

`src/cli.ts`:

```ts
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
  | { kind: "json"; data: Record<string, unknown> }
  | { kind: "failure"; reason: CliFailure; message: string };

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
```

`src/mode.ts`:

```ts
import { ObsidianRegistry } from "./cli";

export type BasicReason = "no-cli" | "cli-disabled" | "quickadd-old";

export const REASON_TEXT: Record<BasicReason, string> = {
  "no-cli": "Update Obsidian to 1.12 or later for full QuickAdd support.",
  "cli-disabled": "Turn on Settings → General → Advanced → Command line interface in Obsidian, then restart Obsidian.",
  "quickadd-old": "Update the QuickAdd plugin to 2.27 or later for full support.",
};

export type Mode = { mode: "full"; cli: string } | { mode: "basic"; reason: BasicReason };

export function detectMode(cli: string | undefined, registry: ObsidianRegistry): Mode {
  if (!cli) return { mode: "basic", reason: "no-cli" };
  if (!registry.cli) return { mode: "basic", reason: "cli-disabled" };
  return { mode: "full", cli };
}

export function isBasicReason(reason: string): reason is BasicReason {
  return reason in REASON_TEXT;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/mode.ts tests/helpers/fakeCli.ts tests/cli.test.ts tests/mode.test.ts
git commit -m "feat: find, run and classify obsidian-cli; detect full vs basic mode"
```

---

### Task 3: Prompt ⇄ form mapping and reply values

**Files:**
- Create: `src/replies.ts`, `tests/replies.test.ts`

**Interfaces:**
- Produces (all from `src/replies.ts`):
  - Types: `QaItem { title: string; value: string; checked?: boolean }`, `QaField { id; label?; type?; placeholder?; defaultValue?: string; description?; options?: string[]; displayOptions?: string[]; optional?: boolean; suggesterConfig?: { allowCustomInput?: boolean; multiSelect?: boolean } }`, `QaPrompt { type: string; header?; placeholder?; defaultValue?: string; multiline?: boolean; withTime?: boolean; text?: string | string[]; items?: QaItem[]; preselected?: string[]; allowCustomInput?: boolean; fields?: QaField[] }`, `FieldKind`, `FieldOption { value; title }`, `FieldSpec { id; label; kind: FieldKind; placeholder?; info?; defaultValue?: string | string[] | boolean; options?: FieldOption[]; allowCustom?: boolean; optional: boolean; withTime?: boolean }`, `FormValues = Record<string, unknown>` (Raycast form values keyed `f<i>` and `f<i>-custom`).
  - Functions: `specsFromQuickAddFields(fields: QaField[]): FieldSpec[]`, `specsForPrompt(prompt: QaPrompt): FieldSpec[] | undefined`, `fieldValue(spec, values, index): string | string[]`, `validateForm(specs, values): Record<number, string>`, `replyForForm(prompt, specs, values): unknown`, `dateReply(date: Date, withTime: boolean): string`, `dropdownDefault(spec: FieldSpec): string | undefined`, `dateDefault(value: unknown): Date | undefined`, `promptTitle(prompt: QaPrompt, fallback: string): string`, `messageMarkdown(prompt: QaPrompt): string`, `unsupportedMarkdown(type: string): string`.

- [ ] **Step 1: Write the failing tests**

`tests/replies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  dateDefault,
  dateReply,
  dropdownDefault,
  FieldSpec,
  fieldValue,
  messageMarkdown,
  promptTitle,
  QaField,
  replyForForm,
  specsForPrompt,
  specsFromQuickAddFields,
  unsupportedMarkdown,
  validateForm,
} from "../src/replies";

// Shape recorded in the CLI spike: a capture with a text input and a capture-target picker.
const pickerForm: QaField[] = [
  { id: "Note", label: "Note", type: "text", optional: false },
  {
    id: "__qa.captureTargetFilePath.abc",
    label: "Select capture target file",
    type: "dropdown",
    options: ["A/one.md", "two.md"],
    displayOptions: ["one", "two"],
  },
];

describe("specsFromQuickAddFields", () => {
  it("maps text and dropdown fields", () => {
    expect(specsFromQuickAddFields(pickerForm)).toEqual([
      { id: "Note", label: "Note", kind: "text", optional: false },
      {
        id: "__qa.captureTargetFilePath.abc",
        label: "Select capture target file",
        kind: "dropdown",
        options: [
          { value: "A/one.md", title: "one" },
          { value: "two.md", title: "two" },
        ],
        allowCustom: false,
        optional: false,
      },
    ]);
  });

  it.each([
    [{ id: "a", type: "textarea" }, "textarea"],
    [{ id: "a", type: "suggester" }, "text"],
    [{ id: "a", type: "suggester", options: ["x"] }, "dropdown"],
    [{ id: "a", type: "field-suggest", options: ["x"], suggesterConfig: { multiSelect: true } }, "tags"],
    [{ id: "a", type: "date" }, "date"],
    [{ id: "a", type: "number" }, "number"],
    [{ id: "a", type: "slider" }, "number"],
    [{ id: "a", type: "checkbox" }, "checkbox"],
    [{ id: "a", type: "some-future-type" }, "text"],
    [{ id: "a" }, "text"],
  ])("maps %j to %s", (field, kind) => {
    expect(specsFromQuickAddFields([field as QaField])[0].kind).toBe(kind);
  });

  it("keeps labels, defaults and custom input", () => {
    const [spec] = specsFromQuickAddFields([
      { id: "c", type: "suggester", options: ["x"], defaultValue: "x", suggesterConfig: { allowCustomInput: true } },
    ]);
    expect(spec).toMatchObject({ label: "c", defaultValue: "x", allowCustom: true });
  });
});

describe("specsForPrompt", () => {
  it("turns single prompts into one-field forms", () => {
    expect(specsForPrompt({ type: "input", header: "Title", multiline: true })).toEqual([
      { id: "value", label: "Title", kind: "textarea", optional: true },
    ]);
    expect(specsForPrompt({ type: "date", header: "When", withTime: true })).toEqual([
      { id: "value", label: "When", kind: "date", withTime: true, optional: true },
    ]);
    expect(
      specsForPrompt({ type: "checkbox", items: [{ title: "One", value: "1", checked: true }, { title: "Two", value: "2" }] }),
    ).toEqual([
      { id: "1", label: "One", kind: "checkbox", defaultValue: true, optional: true },
      { id: "2", label: "Two", kind: "checkbox", defaultValue: false, optional: true },
    ]);
    expect(
      specsForPrompt({ type: "multiselect", items: [{ title: "A", value: "a" }], preselected: ["a"], allowCustomInput: true }),
    ).toEqual([
      {
        id: "value",
        label: "Select",
        kind: "tags",
        options: [{ value: "a", title: "A" }],
        defaultValue: ["a"],
        allowCustom: true,
        optional: true,
      },
    ]);
  });

  it("returns undefined for prompts that are not forms", () => {
    for (const type of ["suggester", "confirm", "info", "some-future-prompt"]) {
      expect(specsForPrompt({ type })).toBeUndefined();
    }
  });
});

describe("fieldValue and replyForForm", () => {
  const text: FieldSpec = { id: "t", label: "t", kind: "text", optional: false };
  const drop: FieldSpec = { id: "d", label: "d", kind: "dropdown", options: [{ value: "x", title: "X" }], allowCustom: true, optional: false };

  it("prefers a custom value over the dropdown", () => {
    expect(fieldValue(drop, { f0: "x", "f0-custom": "  mine " }, 0)).toBe("mine");
    expect(fieldValue(drop, { f0: "x", "f0-custom": "" }, 0)).toBe("x");
  });

  it("builds a form reply keyed by QuickAdd field ids", () => {
    const specs = specsFromQuickAddFields(pickerForm);
    expect(replyForForm({ type: "form", fields: pickerForm }, specs, { f0: "hello", f1: "two.md" })).toEqual({
      Note: "hello",
      "__qa.captureTargetFilePath.abc": "two.md",
    });
  });

  it("builds input, date, checkbox and multiselect replies", () => {
    expect(replyForForm({ type: "input" }, [text], { f0: "hi" })).toBe("hi");
    const date: FieldSpec = { id: "value", label: "d", kind: "date", optional: true };
    expect(replyForForm({ type: "date" }, [date], { f0: new Date(2026, 8, 30, 15, 0) })).toBe("@date:2026-09-30");
    const boxes = specsForPrompt({ type: "checkbox", items: [{ title: "1", value: "1" }, { title: "2", value: "2" }] })!;
    expect(replyForForm({ type: "checkbox" }, boxes, { f0: false, f1: true })).toEqual(["2"]);
    const tags = specsForPrompt({ type: "multiselect", items: [{ title: "A", value: "a" }], allowCustomInput: true })!;
    expect(replyForForm({ type: "multiselect" }, tags, { f0: ["a"], "f0-custom": "b, c" })).toEqual(["a", "b", "c"]);
  });

  it("sends checkbox form fields as true/false strings", () => {
    const [box] = specsFromQuickAddFields([{ id: "done", type: "checkbox" }]);
    expect(fieldValue(box, { f0: true }, 0)).toBe("true");
    expect(fieldValue(box, {}, 0)).toBe("false");
  });
});

describe("validateForm", () => {
  it("requires non-optional values and numeric numbers", () => {
    const specs: FieldSpec[] = [
      { id: "a", label: "a", kind: "text", optional: false },
      { id: "b", label: "b", kind: "text", optional: true },
      { id: "c", label: "c", kind: "number", optional: true },
      { id: "d", label: "d", kind: "checkbox", optional: false },
    ];
    expect(validateForm(specs, { f0: " ", f1: "", f2: "abc", f3: false })).toEqual({ 0: "Required", 2: "Must be a number" });
    expect(validateForm(specs, { f0: "x", f2: "4.5" })).toEqual({});
  });
});

describe("helpers", () => {
  it("formats dates for QuickAdd", () => {
    expect(dateReply(new Date(2026, 0, 5, 9, 30), false)).toBe("@date:2026-01-05");
    expect(dateReply(new Date(Date.UTC(2026, 0, 5, 9, 30)), true)).toBe("@date:2026-01-05T09:30:00.000Z");
  });

  it("picks dropdown and date defaults", () => {
    const opts = [{ value: "x", title: "X" }, { value: "y", title: "Y" }];
    expect(dropdownDefault({ id: "a", label: "a", kind: "dropdown", options: opts, defaultValue: "y", optional: false })).toBe("y");
    expect(dropdownDefault({ id: "a", label: "a", kind: "dropdown", options: opts, defaultValue: "z", optional: false })).toBe("x");
    expect(dateDefault("@date:2026-09-30")?.getTime()).toBe(Date.parse("2026-09-30"));
    expect(dateDefault("not a date")).toBeUndefined();
    expect(dateDefault(undefined)).toBeUndefined();
  });

  it("titles and describes prompts", () => {
    expect(promptTitle({ type: "input", header: " Title " }, "Choice")).toBe("Title");
    expect(promptTitle({ type: "suggester", placeholder: "Pick" }, "Choice")).toBe("Pick");
    expect(promptTitle({ type: "form" }, "Choice")).toBe("Choice");
    expect(messageMarkdown({ type: "info", header: "Heads up", text: ["one", "two"] })).toBe("## Heads up\n\none\n\ntwo");
    expect(messageMarkdown({ type: "confirm", text: "Sure?" })).toBe("Sure?");
    expect(unsupportedMarkdown("hologram")).toContain("`hologram`");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/replies.test.ts`
Expected: FAIL — cannot resolve `../src/replies`.

- [ ] **Step 3: Implement `src/replies.ts`**

```ts
/** Shapes of QuickAdd's interactive prompts (QuickAdd 2.27 `quickadd:interactive`). */
export interface QaItem {
  title: string;
  value: string;
  checked?: boolean;
}

export interface QaField {
  id: string;
  label?: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  description?: string;
  options?: string[];
  displayOptions?: string[];
  optional?: boolean;
  suggesterConfig?: { allowCustomInput?: boolean; multiSelect?: boolean };
}

export interface QaPrompt {
  type: string;
  header?: string;
  placeholder?: string;
  defaultValue?: string;
  multiline?: boolean;
  withTime?: boolean;
  text?: string | string[];
  items?: QaItem[];
  preselected?: string[];
  allowCustomInput?: boolean;
  fields?: QaField[];
}

export type FieldKind = "text" | "textarea" | "dropdown" | "tags" | "date" | "number" | "checkbox";

export interface FieldOption {
  value: string;
  title: string;
}

export interface FieldSpec {
  id: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  info?: string;
  defaultValue?: string | string[] | boolean;
  options?: FieldOption[];
  allowCustom?: boolean;
  optional: boolean;
  withTime?: boolean;
}

/** Raycast form values, keyed `f<index>` and `f<index>-custom`. */
export type FormValues = Record<string, unknown>;

function fieldSpec(field: QaField): FieldSpec {
  const options = (field.options ?? []).map((value, index) => ({ value, title: field.displayOptions?.[index] ?? value }));
  const allowCustom = field.suggesterConfig?.allowCustomInput === true;
  const base = {
    id: field.id,
    label: field.label ?? field.id,
    placeholder: field.placeholder,
    info: field.description,
    defaultValue: field.defaultValue,
    optional: field.optional === true,
  };
  switch (field.type) {
    case "textarea":
      return { ...base, kind: "textarea" };
    case "dropdown":
    case "suggester":
    case "field-suggest":
    case "file-picker":
      if (options.length === 0) return { ...base, kind: "text" };
      if (field.suggesterConfig?.multiSelect) {
        const defaults = field.defaultValue ? field.defaultValue.split(",").map((part) => part.trim()) : [];
        return { ...base, kind: "tags", options, allowCustom, defaultValue: defaults.filter(Boolean) };
      }
      return { ...base, kind: "dropdown", options, allowCustom };
    case "date":
      return { ...base, kind: "date" };
    case "number":
    case "slider":
      return { ...base, kind: "number" };
    case "checkbox":
      return { ...base, kind: "checkbox", defaultValue: field.defaultValue === "true", optional: true };
    default:
      return { ...base, kind: "text" };
  }
}

export function specsFromQuickAddFields(fields: QaField[]): FieldSpec[] {
  return fields.map(fieldSpec);
}

/** Form specs for prompts rendered as a Raycast form; undefined for suggester/confirm/info/unknown. */
export function specsForPrompt(prompt: QaPrompt): FieldSpec[] | undefined {
  switch (prompt.type) {
    case "form":
      return specsFromQuickAddFields(prompt.fields ?? []);
    case "input":
      return [
        {
          id: "value",
          label: prompt.header ?? "Value",
          kind: prompt.multiline ? "textarea" : "text",
          placeholder: prompt.placeholder,
          defaultValue: prompt.defaultValue,
          optional: true,
        },
      ];
    case "date":
      return [
        {
          id: "value",
          label: prompt.header ?? "Date",
          kind: "date",
          placeholder: prompt.placeholder,
          defaultValue: prompt.defaultValue,
          withTime: prompt.withTime === true,
          optional: true,
        },
      ];
    case "checkbox":
      return (prompt.items ?? []).map((item) => ({
        id: item.value,
        label: item.title,
        kind: "checkbox" as const,
        defaultValue: item.checked === true,
        optional: true,
      }));
    case "multiselect":
      return [
        {
          id: "value",
          label: prompt.placeholder ?? "Select",
          kind: "tags",
          options: (prompt.items ?? []).map((item) => ({ value: item.value, title: item.title })),
          defaultValue: prompt.preselected ?? [],
          allowCustom: prompt.allowCustomInput === true,
          optional: true,
        },
      ];
    default:
      return undefined;
  }
}

export function dateReply(date: Date, withTime: boolean): string {
  if (withTime) return `@date:${date.toISOString()}`;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `@date:${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fieldValue(spec: FieldSpec, values: FormValues, index: number): string | string[] {
  const raw = values[`f${index}`];
  const custom = values[`f${index}-custom`];
  const customText = typeof custom === "string" ? custom.trim() : "";
  switch (spec.kind) {
    case "date":
      return raw instanceof Date ? dateReply(raw, spec.withTime === true) : "";
    case "checkbox":
      return raw === true ? "true" : "false";
    case "tags": {
      const picked = Array.isArray(raw) ? raw.map(String) : [];
      const extra = customText
        ? customText
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
        : [];
      return [...picked, ...extra];
    }
    default:
      return customText || (typeof raw === "string" ? raw : "");
  }
}

export function validateForm(specs: FieldSpec[], values: FormValues): Record<number, string> {
  const errors: Record<number, string> = {};
  specs.forEach((spec, index) => {
    const value = fieldValue(spec, values, index);
    const empty = Array.isArray(value) ? value.length === 0 : value.trim() === "";
    if (spec.kind === "number" && !empty && Number.isNaN(Number(value))) errors[index] = "Must be a number";
    else if (empty && !spec.optional && spec.kind !== "checkbox") errors[index] = "Required";
  });
  return errors;
}

export function replyForForm(prompt: QaPrompt, specs: FieldSpec[], values: FormValues): unknown {
  switch (prompt.type) {
    case "form":
      return Object.fromEntries(specs.map((spec, index) => [spec.id, fieldValue(spec, values, index)]));
    case "checkbox":
      return specs.filter((_, index) => values[`f${index}`] === true).map((spec) => spec.id);
    default:
      return fieldValue(specs[0], values, 0);
  }
}

export function dropdownDefault(spec: FieldSpec): string | undefined {
  const wanted = typeof spec.defaultValue === "string" ? spec.defaultValue : undefined;
  return spec.options?.some((option) => option.value === wanted) ? wanted : spec.options?.[0]?.value;
}

export function dateDefault(value: unknown): Date | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  const time = Date.parse(value.replace(/^@date:/, ""));
  return Number.isNaN(time) ? undefined : new Date(time);
}

export function promptTitle(prompt: QaPrompt, fallback: string): string {
  return prompt.header?.trim() || prompt.placeholder?.trim() || fallback;
}

export function messageMarkdown(prompt: QaPrompt): string {
  const text = Array.isArray(prompt.text) ? prompt.text.join("\n\n") : (prompt.text ?? "");
  return prompt.header ? `## ${prompt.header}\n\n${text}`.trim() : text;
}

export function unsupportedMarkdown(type: string): string {
  return `# Unsupported prompt\n\nQuickAdd asked for a \`${type}\` prompt, which this extension doesn't support yet. Cancel the run and run the choice from Obsidian.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/replies.ts tests/replies.test.ts
git commit -m "feat: map QuickAdd interactive prompts to form specs and reply values"
```

---

### Task 4: Interactive session client

**Files:**
- Create: `src/session.ts`, `tests/helpers/fakeQuickAdd.ts`, `tests/session.test.ts`

**Interfaces:**
- Consumes: `runCli`, `CliFailure` (cli.ts); `QaPrompt` (replies.ts); `fakeCli`, `sq` (tests/helpers/fakeCli.ts).
- Produces: `interface SessionInfo { port: number; sessionId: string; token: string }`, `interface DoneResult { ok?: boolean; verified?: boolean; effect?: string; file?: string }`, `type PromptEvent = { kind: "prompt"; requestId: string; prompt: QaPrompt }`, `type SessionEvent = PromptEvent | { kind: "done"; result: DoneResult } | { kind: "error"; error: string }`, `class InteractiveSession { constructor(info: SessionInfo); pollLoop(onEvent: (event: SessionEvent) => void): Promise<void>; reply(requestId: string, value: unknown): Promise<void>; abort(): Promise<void>; readonly finished: boolean }`, `type StartResult = { ok: true; session: InteractiveSession } | { ok: false; reason: CliFailure | "quickadd-error"; message: string }`, `startSession(cli: string, vaultName: string, choiceId: string): Promise<StartResult>`, `doneMessage(choiceName: string, result: DoneResult): string`.

- [ ] **Step 1: Write the fake server and the failing tests**

`tests/helpers/fakeQuickAdd.ts`:

```ts
import { createServer, IncomingMessage } from "http";
import { AddressInfo } from "net";

export interface FakeQuickAdd {
  port: number;
  session: string;
  token: string;
  replies: unknown[];
  aborts: number;
  push(event: object): void;
  onReply?: (body: { requestId: string; value: unknown }) => void;
  failNextPoll?: { status: number; body: object };
  replyFailure?: { status: number; body: object };
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data;
}

/** In-process stand-in for QuickAdd's interactive server (protocol from the CLI spike). */
export async function startFakeQuickAdd(): Promise<FakeQuickAdd> {
  const queue: object[] = [];
  const fake = {
    port: 0,
    session: "s1",
    token: "t1",
    replies: [] as unknown[],
    aborts: 0,
    push: (event: object) => queue.push(event),
  } as FakeQuickAdd;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, body: object) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.searchParams.get("session") !== fake.session || url.searchParams.get("token") !== fake.token) {
      send(404, { ok: false, error: "Unknown session or token" });
      return;
    }
    if (req.method === "GET" && url.pathname === "/poll") {
      if (fake.failNextPoll) {
        const failure = fake.failNextPoll;
        fake.failNextPoll = undefined;
        send(failure.status, failure.body);
        return;
      }
      send(200, queue.shift() ?? { kind: "idle" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/reply") {
      const body = JSON.parse(await readBody(req));
      if (fake.replyFailure) {
        send(fake.replyFailure.status, fake.replyFailure.body);
        return;
      }
      fake.replies.push(body);
      fake.onReply?.(body);
      send(200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/abort") {
      await readBody(req);
      fake.aborts++;
      queue.push({ kind: "error", error: "Execution cancelled by user" });
      send(200, { ok: true, interrupted: 1 });
      return;
    }
    send(404, { ok: false, error: "Not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.port = (server.address() as AddressInfo).port;
  fake.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return fake;
}
```

`tests/session.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { doneMessage, InteractiveSession, SessionEvent, startSession } from "../src/session";
import { fakeCli, sq } from "./helpers/fakeCli";
import { FakeQuickAdd, startFakeQuickAdd } from "./helpers/fakeQuickAdd";

let fake: FakeQuickAdd | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

const info = (f: FakeQuickAdd) => ({ port: f.port, sessionId: f.session, token: f.token });
const prompt = { kind: "prompt", requestId: "r1", prompt: { type: "form", fields: [{ id: "value", type: "text" }] } };
const done = { kind: "done", result: { ok: true, verified: true, effect: "changed", file: "Inbox.md" } };

describe("InteractiveSession", () => {
  it("delivers a prompt, sends the reply, then delivers done and stops", async () => {
    fake = await startFakeQuickAdd();
    fake.push(prompt);
    fake.onReply = () => fake!.push(done);
    const session = new InteractiveSession(info(fake));
    const events: SessionEvent[] = [];
    await session.pollLoop((event) => {
      events.push(event);
      if (event.kind === "prompt") void session.reply(event.requestId, { value: "hi" });
    });
    expect(events.map((e) => e.kind)).toEqual(["prompt", "done"]);
    expect(fake.replies).toEqual([{ requestId: "r1", value: { value: "hi" } }]);
    expect(session.finished).toBe(true);
  });

  it("keeps polling through idle events and still accepts a late reply", async () => {
    fake = await startFakeQuickAdd();
    fake.push(prompt);
    fake.onReply = () => fake!.push(done);
    const session = new InteractiveSession(info(fake));
    const events: SessionEvent[] = [];
    await session.pollLoop((event) => {
      events.push(event);
      // Answer only after the loop has seen several idle polls.
      if (event.kind === "prompt") setTimeout(() => void session.reply(event.requestId, "late"), 150);
    });
    expect(events.map((e) => e.kind)).toEqual(["prompt", "done"]);
    expect(fake.replies).toEqual([{ requestId: "r1", value: "late" }]);
  });

  it("aborts: tells QuickAdd and stops without reporting the cancellation", async () => {
    fake = await startFakeQuickAdd();
    fake.push(prompt);
    const session = new InteractiveSession(info(fake));
    const events: SessionEvent[] = [];
    let aborting: Promise<void> | undefined;
    await session.pollLoop((event) => {
      events.push(event);
      if (event.kind === "prompt") aborting = session.abort();
    });
    await aborting;
    expect(events.map((e) => e.kind)).toEqual(["prompt"]);
    expect(fake.aborts).toBe(1);
    expect(session.finished).toBe(true);
  });

  it("does not abort a finished session", async () => {
    fake = await startFakeQuickAdd();
    fake.push(done);
    const session = new InteractiveSession(info(fake));
    await session.pollLoop(() => undefined);
    await session.abort();
    expect(fake.aborts).toBe(0);
  });

  it("reports server errors and QuickAdd errors as error events", async () => {
    fake = await startFakeQuickAdd();
    fake.failNextPoll = { status: 404, body: { ok: false, error: "Unknown session or token" } };
    const events: SessionEvent[] = [];
    await new InteractiveSession(info(fake)).pollLoop((event) => events.push(event));
    expect(events).toEqual([{ kind: "error", error: "Unknown session or token" }]);

    fake.push({ kind: "error", error: "Template not found" });
    const more: SessionEvent[] = [];
    await new InteractiveSession(info(fake)).pollLoop((event) => more.push(event));
    expect(more).toEqual([{ kind: "error", error: "Template not found" }]);
  });

  it("reports a lost connection", async () => {
    fake = await startFakeQuickAdd();
    const session = new InteractiveSession(info(fake));
    await fake.close();
    fake = undefined;
    const events: SessionEvent[] = [];
    await session.pollLoop((event) => events.push(event));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "error" });
    expect((events[0] as { error: string }).error).toMatch(/Lost connection to QuickAdd/);
  });

  it("throws when QuickAdd rejects a reply", async () => {
    fake = await startFakeQuickAdd();
    fake.replyFailure = { status: 409, body: { ok: false, error: "No pending prompt for that requestId" } };
    await expect(new InteractiveSession(info(fake)).reply("nope", 1)).rejects.toThrow("No pending prompt");
  });
});

describe("startSession", () => {
  it("starts from the CLI's JSON", async () => {
    fake = await startFakeQuickAdd();
    const json = JSON.stringify({ command: "quickadd:interactive", ok: true, port: fake.port, sessionId: "s1", token: "t1" });
    const result = await startSession(fakeCli(`printf '%s' ${sq(json)}`), "v", "id1");
    expect(result.ok).toBe(true);
    fake.push(done);
    const events: SessionEvent[] = [];
    if (result.ok) await result.session.pollLoop((event) => events.push(event));
    expect(events.map((e) => e.kind)).toEqual(["done"]);
  });

  it("passes the choice id", async () => {
    const result = await startSession(fakeCli(`printf '{"ok":false,"error":"%s"}' "$*"`), "v", "id1");
    expect(result).toEqual({ ok: false, reason: "quickadd-error", message: "vault=v quickadd:interactive id=id1" });
  });

  it("maps CLI failures", async () => {
    const result = await startSession(fakeCli(`printf '%s' ${sq("Command line interface is not enabled.")}`), "v", "id");
    expect(result).toMatchObject({ ok: false, reason: "cli-disabled" });
  });
});

describe("doneMessage", () => {
  it("describes the outcome", () => {
    expect(doneMessage("Thought", { effect: "changed", file: "Inbox.md" })).toBe("Added to Inbox.md");
    expect(doneMessage("Person", { effect: "created", file: "People/A.md" })).toBe("Created People/A.md");
    expect(doneMessage("Macro", { effect: "unknown" })).toBe("Ran Macro");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/session.test.ts`
Expected: FAIL — cannot resolve `../src/session`.

- [ ] **Step 3: Implement `src/session.ts`**

```ts
import { CliFailure, runCli } from "./cli";
import { QaPrompt } from "./replies";

export interface SessionInfo {
  port: number;
  sessionId: string;
  token: string;
}

export interface DoneResult {
  ok?: boolean;
  verified?: boolean;
  effect?: string;
  file?: string;
}

export type PromptEvent = { kind: "prompt"; requestId: string; prompt: QaPrompt };
export type SessionEvent = PromptEvent | { kind: "done"; result: DoneResult } | { kind: "error"; error: string };

/** Client for QuickAdd's interactive server: long-poll for events, reply to prompts, abort. */
export class InteractiveSession {
  private stopped = false;

  constructor(private readonly info: SessionInfo) {}

  get finished(): boolean {
    return this.stopped;
  }

  private url(path: string): string {
    const { port, sessionId, token } = this.info;
    return `http://127.0.0.1:${port}${path}?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
  }

  /** Polls until done/error/abort. Runs independently of the UI so QuickAdd's watchdog never fires. */
  async pollLoop(onEvent: (event: SessionEvent) => void): Promise<void> {
    while (!this.stopped) {
      let event: { kind?: unknown; error?: unknown };
      try {
        const response = await fetch(this.url("/poll"));
        event = (await response.json()) as typeof event;
      } catch (error) {
        if (this.stopped) return;
        this.stopped = true;
        onEvent({ kind: "error", error: `Lost connection to QuickAdd: ${(error as Error).message}` });
        return;
      }
      if (this.stopped) return;
      if (event.kind === "idle") continue;
      if (event.kind === "prompt") {
        onEvent(event as PromptEvent);
        continue;
      }
      this.stopped = true;
      if (event.kind === "done") {
        onEvent(event as SessionEvent);
        return;
      }
      const message = typeof event.error === "string" ? event.error : `Unexpected reply from QuickAdd: ${JSON.stringify(event)}`;
      onEvent({ kind: "error", error: message });
      return;
    }
  }

  async reply(requestId: string, value: unknown): Promise<void> {
    const response = await fetch(this.url("/reply"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId, value }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      throw new Error(typeof body.error === "string" ? body.error : `QuickAdd rejected the answer (HTTP ${response.status})`);
    }
  }

  async abort(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      await fetch(this.url("/abort"), { method: "POST" });
    } catch {
      // The session is already gone.
    }
  }
}

export type StartResult =
  | { ok: true; session: InteractiveSession }
  | { ok: false; reason: CliFailure | "quickadd-error"; message: string };

export async function startSession(cli: string, vaultName: string, choiceId: string): Promise<StartResult> {
  const result = await runCli(cli, vaultName, "quickadd:interactive", [`id=${choiceId}`]);
  if (result.kind === "failure") return { ok: false, reason: result.reason, message: result.message };
  const data = result.data as { ok?: unknown; error?: unknown; port?: unknown; sessionId?: unknown; token?: unknown };
  if (data.ok !== true || typeof data.port !== "number" || typeof data.sessionId !== "string" || typeof data.token !== "string") {
    const message = typeof data.error === "string" ? data.error : "QuickAdd did not start an interactive session.";
    return { ok: false, reason: "quickadd-error", message };
  }
  return { ok: true, session: new InteractiveSession({ port: data.port, sessionId: data.sessionId, token: data.token }) };
}

export function doneMessage(choiceName: string, result: DoneResult): string {
  if (result.file && result.effect === "created") return `Created ${result.file}`;
  if (result.file && result.effect === "changed") return `Added to ${result.file}`;
  return `Ran ${choiceName}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass; tsc clean. If "keeps polling…" is flaky, don't lengthen timeouts blindly — check that `pollLoop` doesn't await the reply.

- [ ] **Step 5: Commit**

```bash
git add src/session.ts tests/helpers/fakeQuickAdd.ts tests/session.test.ts
git commit -m "feat: QuickAdd interactive session client (poll, reply, abort)"
```

---

### Task 5: Make sure the run reaches the right vault

**Files:**
- Create: `src/ensureVault.ts`, `tests/ensureVault.test.ts`

**Interfaces:**
- Consumes: `CliFailure`, `CliResult`, `normalizePath`, `readRegistry`, `runCli` (cli.ts); `openUri` (open.ts); `buildOpenUri` (uri.ts).
- Produces: `interface VaultDeps { isOpen(): boolean; open(): Promise<void>; list(): Promise<CliResult>; sleep(ms: number): Promise<void>; now(): number }`, `type VaultReady = { ok: true } | { ok: false; reason: CliFailure | "timeout" | "choice-missing"; message: string }`, `ensureVaultReady(choiceId: string, deps: VaultDeps, timeoutMs?: number): Promise<VaultReady>`, `choiceIds(data: Record<string, unknown>): string[]`, `realVaultDeps(cli: string, vaultName: string, vaultPath: string): VaultDeps`.

- [ ] **Step 1: Write the failing tests**

`tests/ensureVault.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CliResult } from "../src/cli";
import { choiceIds, ensureVaultReady, VaultDeps } from "../src/ensureVault";

const list = (...ids: string[]): CliResult => ({ kind: "json", data: { ok: true, choices: ids.map((id) => ({ id })) } });
const failure = (reason: "cli-disabled" | "not-running"): CliResult => ({ kind: "failure", reason, message: reason });

function deps(open: boolean, responses: CliResult[]) {
  let clock = 0;
  const calls = { open: 0, list: 0 };
  const d: VaultDeps = {
    isOpen: () => open,
    open: async () => {
      calls.open++;
    },
    list: async () => {
      calls.list++;
      return responses[Math.min(calls.list - 1, responses.length - 1)];
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { d, calls };
}

describe("ensureVaultReady", () => {
  it("is ready at once when the vault is open and has the choice", async () => {
    const { d, calls } = deps(true, [list("a", "b")]);
    expect(await ensureVaultReady("b", d)).toEqual({ ok: true });
    expect(calls).toEqual({ open: 0, list: 1 });
  });

  it("opens a closed vault and waits until it answers with the choice", async () => {
    const { d, calls } = deps(false, [list("other"), list("other"), list("b")]);
    expect(await ensureVaultReady("b", d)).toEqual({ ok: true });
    expect(calls).toEqual({ open: 1, list: 3 });
  });

  it("launches Obsidian when it is not running", async () => {
    const { d, calls } = deps(true, [failure("not-running"), list("b")]);
    expect(await ensureVaultReady("b", d)).toEqual({ ok: true });
    expect(calls.open).toBe(1);
  });

  it("fails fast on other CLI failures", async () => {
    const { d } = deps(true, [failure("cli-disabled")]);
    expect(await ensureVaultReady("b", d)).toMatchObject({ ok: false, reason: "cli-disabled" });
  });

  it("fails fast when an open vault does not have the choice", async () => {
    const { d } = deps(true, [list("a")]);
    expect(await ensureVaultReady("b", d)).toMatchObject({ ok: false, reason: "choice-missing" });
  });

  it("times out when a vault it opened never shows the choice", async () => {
    const { d, calls } = deps(false, [list("a")]);
    expect(await ensureVaultReady("b", d, 2000)).toMatchObject({ ok: false, reason: "timeout" });
    expect(calls.list).toBe(5);
  });
});

describe("choiceIds", () => {
  it("includes nested choices", () => {
    expect(choiceIds({ choices: [{ id: "m", choices: [{ id: "c" }] }, { id: "x" }, { name: "no id" }] })).toEqual([
      "m",
      "c",
      "x",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/ensureVault.test.ts`
Expected: FAIL — cannot resolve `../src/ensureVault`.

- [ ] **Step 3: Implement `src/ensureVault.ts`**

```ts
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

export type VaultReady = { ok: true } | { ok: false; reason: CliFailure | "timeout" | "choice-missing"; message: string };

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
          message: "QuickAdd in this vault doesn't have this choice. Reload QuickAdd or restart Obsidian and try again.",
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
```

Timeout test arithmetic: deadline = 2000; list at t=0, 500, 1000, 1500, 2000 → 5 calls, then `now() >= deadline` → timeout.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/ensureVault.ts tests/ensureVault.test.ts
git commit -m "feat: make sure QuickAdd runs reach the requested vault"
```

---

### Task 6: Full-mode UI and wiring

No unit tests here: these are thin Raycast views over the tested modules. Verification is `tsc`, `build` and `lint`, then Task 8 by hand.

**Files:**
- Create: `src/prompts/CancelAction.tsx`, `src/prompts/FormPrompt.tsx`, `src/prompts/SuggesterPrompt.tsx`, `src/prompts/MessagePrompt.tsx`, `src/RunSession.tsx`
- Modify: `src/quickadd.tsx`, `package.json`, `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `RunSession({ cli, vaultPath, vaultName, choice })`; preference `cliPath`.

- [ ] **Step 1: Prompt views**

`src/prompts/CancelAction.tsx`:

```tsx
import { Action, Icon } from "@raycast/api";

export default function CancelAction({ onCancel }: { onCancel: () => void }) {
  return (
    <Action
      title="Cancel Run"
      icon={Icon.XMarkCircle}
      style={Action.Style.Destructive}
      shortcut={{ modifiers: ["cmd"], key: "." }}
      onAction={onCancel}
    />
  );
}
```

`src/prompts/FormPrompt.tsx`:

```tsx
import { Action, ActionPanel, Form, Icon } from "@raycast/api";
import { useState } from "react";
import { dateDefault, dropdownDefault, FieldSpec, FormValues, validateForm } from "../replies";
import CancelAction from "./CancelAction";

type Props = {
  title: string;
  specs: FieldSpec[];
  onSubmit: (values: FormValues) => void;
  onCancel: () => void;
};

export default function FormPrompt({ title, specs, onSubmit, onCancel }: Props) {
  const [errors, setErrors] = useState<Record<number, string>>({});

  function submit(values: FormValues) {
    const found = validateForm(specs, values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    onSubmit(values);
  }

  function clear(index: number) {
    if (!errors[index]) return;
    const next = { ...errors };
    delete next[index];
    setErrors(next);
  }

  return (
    <Form
      navigationTitle={title}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Continue" icon={Icon.Checkmark} onSubmit={submit} />
          <CancelAction onCancel={onCancel} />
        </ActionPanel>
      }
    >
      {specs.flatMap((spec, index) => renderField(spec, index, errors[index], () => clear(index)))}
    </Form>
  );
}

function renderField(spec: FieldSpec, index: number, error: string | undefined, onChange: () => void) {
  const id = `f${index}`;
  const common = { id, title: spec.label, info: spec.info, error, onChange };
  const text = typeof spec.defaultValue === "string" ? spec.defaultValue : undefined;
  const custom = (placeholder: string) =>
    spec.allowCustom ? [<Form.TextField key={`${id}-custom`} id={`${id}-custom`} title="" placeholder={placeholder} />] : [];

  switch (spec.kind) {
    case "textarea":
      return [
        <Form.TextArea key={id} {...common} placeholder={spec.placeholder} defaultValue={text} autoFocus={index === 0} />,
      ];
    case "dropdown":
      return [
        <Form.Dropdown key={id} {...common} defaultValue={dropdownDefault(spec)}>
          {(spec.options ?? []).map((option) => (
            <Form.Dropdown.Item key={option.value} value={option.value} title={option.title} />
          ))}
        </Form.Dropdown>,
        ...custom("Or type a custom value"),
      ];
    case "tags":
      return [
        <Form.TagPicker
          key={id}
          {...common}
          defaultValue={Array.isArray(spec.defaultValue) ? spec.defaultValue : []}
        >
          {(spec.options ?? []).map((option) => (
            <Form.TagPicker.Item key={option.value} value={option.value} title={option.title} />
          ))}
        </Form.TagPicker>,
        ...custom("Other values, comma-separated"),
      ];
    case "date":
      return [
        <Form.DatePicker
          key={id}
          {...common}
          type={spec.withTime ? Form.DatePicker.Type.DateTime : Form.DatePicker.Type.Date}
          defaultValue={dateDefault(spec.defaultValue)}
        />,
      ];
    case "checkbox":
      return [
        <Form.Checkbox
          key={id}
          id={id}
          label={spec.label}
          info={spec.info}
          error={error}
          onChange={onChange}
          defaultValue={spec.defaultValue === true}
        />,
      ];
    default:
      return [
        <Form.TextField
          key={id}
          {...common}
          placeholder={spec.placeholder ?? (spec.optional ? "Optional" : undefined)}
          defaultValue={text}
          autoFocus={index === 0}
        />,
      ];
  }
}
```

`src/prompts/SuggesterPrompt.tsx`:

```tsx
import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useState } from "react";
import { QaPrompt } from "../replies";
import CancelAction from "./CancelAction";

type Props = { title: string; prompt: QaPrompt; onPick: (value: string) => void; onCancel: () => void };

export default function SuggesterPrompt({ title, prompt, onPick, onCancel }: Props) {
  const [search, setSearch] = useState("");
  const customText = search.trim();
  return (
    <List
      navigationTitle={title}
      searchBarPlaceholder={prompt.placeholder ?? "Search"}
      onSearchTextChange={setSearch}
      filtering
    >
      {prompt.allowCustomInput && customText ? (
        <List.Item
          title={`Use “${customText}”`}
          icon={Icon.Plus}
          actions={
            <ActionPanel>
              <Action title="Use Custom Value" icon={Icon.Checkmark} onAction={() => onPick(customText)} />
              <CancelAction onCancel={onCancel} />
            </ActionPanel>
          }
        />
      ) : null}
      {(prompt.items ?? []).map((item, index) => (
        <List.Item
          key={`${index}`}
          title={item.title}
          actions={
            <ActionPanel>
              <Action title="Select" icon={Icon.Checkmark} onAction={() => onPick(item.value)} />
              <CancelAction onCancel={onCancel} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
```

`src/prompts/MessagePrompt.tsx`:

```tsx
import { Action, ActionPanel, Detail, Image } from "@raycast/api";
import CancelAction from "./CancelAction";

export type MessageChoice = { title: string; icon: Image.ImageLike; onAction: () => void };

type Props = { title: string; markdown: string; choices: MessageChoice[]; onCancel: () => void };

export default function MessagePrompt({ title, markdown, choices, onCancel }: Props) {
  return (
    <Detail
      navigationTitle={title}
      markdown={markdown}
      actions={
        <ActionPanel>
          {choices.map((choice) => (
            <Action key={choice.title} title={choice.title} icon={choice.icon} onAction={choice.onAction} />
          ))}
          <CancelAction onCancel={onCancel} />
        </ActionPanel>
      }
    />
  );
}
```

- [ ] **Step 2: `src/RunSession.tsx`**

```tsx
import { ActionPanel, Detail, Icon, popToRoot, showHUD, showToast, Toast } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import ChoiceForm from "./ChoiceForm";
import { ensureVaultReady, realVaultDeps } from "./ensureVault";
import { BasicReason, isBasicReason, REASON_TEXT } from "./mode";
import { openUri } from "./open";
import CancelAction from "./prompts/CancelAction";
import FormPrompt from "./prompts/FormPrompt";
import MessagePrompt from "./prompts/MessagePrompt";
import SuggesterPrompt from "./prompts/SuggesterPrompt";
import { messageMarkdown, promptTitle, replyForForm, specsForPrompt, unsupportedMarkdown } from "./replies";
import { runChoice } from "./run";
import { doneMessage, InteractiveSession, PromptEvent, SessionEvent, startSession } from "./session";
import { Choice } from "./types";
import { buildOpenUri } from "./uri";

type Phase =
  | { kind: "starting" }
  | { kind: "waiting" }
  | { kind: "failed"; message: string }
  | { kind: "basic"; reason: BasicReason };

type Props = { cli: string; vaultPath: string; vaultName: string; choice: Choice };

export default function RunSession({ cli, vaultPath, vaultName, choice }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [prompts, setPrompts] = useState<PromptEvent[]>([]);
  const session = useRef<InteractiveSession | undefined>(undefined);

  function fail(reason: string, message: string) {
    if (isBasicReason(reason)) {
      setPhase({ kind: "basic", reason });
      return;
    }
    setPhase({ kind: "failed", message });
    showToast({ style: Toast.Style.Failure, title: "QuickAdd run failed", message });
  }

  async function handle(event: SessionEvent) {
    if (event.kind === "prompt") {
      setPrompts((queue) => [...queue, event]);
      return;
    }
    if (event.kind === "done") {
      if (choice.openFile && event.result.file) await openUri(buildOpenUri(vaultName, event.result.file));
      await showHUD(doneMessage(choice.name, event.result));
      return;
    }
    if (/cancelled by user/i.test(event.error)) {
      await popToRoot();
      return;
    }
    fail("quickadd-error", event.error);
  }

  useEffect(() => {
    let unmounted = false;
    (async () => {
      const ready = await ensureVaultReady(choice.id, realVaultDeps(cli, vaultName, vaultPath));
      if (unmounted) return;
      if (!ready.ok) return fail(ready.reason, ready.message);
      const started = await startSession(cli, vaultName, choice.id);
      if (!started.ok) return fail(started.reason, started.message);
      session.current = started.session;
      if (unmounted) return started.session.abort();
      setPhase({ kind: "waiting" });
      await started.session.pollLoop((event) => {
        if (!unmounted) void handle(event);
      });
    })().catch((error) => fail("unknown", String(error)));
    return () => {
      unmounted = true;
      void session.current?.abort();
    };
  }, []);

  async function answer(event: PromptEvent, value: unknown) {
    setPrompts((queue) => queue.slice(1));
    try {
      await session.current?.reply(event.requestId, value);
    } catch (error) {
      fail("quickadd-error", (error as Error).message);
    }
  }

  async function cancel() {
    await session.current?.abort();
    await popToRoot();
  }

  if (phase.kind === "basic") return <BasicFallback vaultName={vaultName} choice={choice} reason={phase.reason} />;
  if (phase.kind === "failed") {
    return <Detail navigationTitle={choice.title} markdown={`# QuickAdd run failed\n\n${phase.message}`} />;
  }

  const current = prompts[0];
  if (!current) {
    return (
      <Detail
        isLoading
        navigationTitle={choice.title}
        markdown={phase.kind === "starting" ? "Starting QuickAdd…" : "Waiting for QuickAdd…"}
        actions={
          <ActionPanel>
            <CancelAction onCancel={cancel} />
          </ActionPanel>
        }
      />
    );
  }

  const prompt = current.prompt;
  const title = promptTitle(prompt, choice.title);
  if (prompt.type === "suggester") {
    return (
      <SuggesterPrompt
        key={current.requestId}
        title={title}
        prompt={prompt}
        onPick={(value) => answer(current, value)}
        onCancel={cancel}
      />
    );
  }
  if (prompt.type === "confirm" || prompt.type === "info") {
    const choices =
      prompt.type === "confirm"
        ? [
            { title: "Yes", icon: Icon.Checkmark, onAction: () => answer(current, true) },
            { title: "No", icon: Icon.XMarkCircle, onAction: () => answer(current, false) },
          ]
        : [{ title: "Continue", icon: Icon.ArrowRight, onAction: () => answer(current, true) }];
    return (
      <MessagePrompt
        key={current.requestId}
        title={title}
        markdown={messageMarkdown(prompt)}
        choices={choices}
        onCancel={cancel}
      />
    );
  }
  const specs = specsForPrompt(prompt);
  if (specs) {
    return (
      <FormPrompt
        key={current.requestId}
        title={title}
        specs={specs}
        onSubmit={(values) => answer(current, replyForForm(prompt, specs, values))}
        onCancel={cancel}
      />
    );
  }
  return (
    <Detail
      navigationTitle={title}
      markdown={unsupportedMarkdown(prompt.type)}
      actions={
        <ActionPanel>
          <CancelAction onCancel={cancel} />
        </ActionPanel>
      }
    />
  );
}

function BasicFallback({ vaultName, choice, reason }: { vaultName: string; choice: Choice; reason: BasicReason }) {
  useEffect(() => {
    showToast({ style: Toast.Style.Failure, title: "Full QuickAdd support is off", message: REASON_TEXT[reason] });
    if (choice.fields.length === 0) void runChoice(vaultName, choice, []);
  }, []);
  if (choice.fields.length > 0) return <ChoiceForm vaultName={vaultName} choice={choice} notice={REASON_TEXT[reason]} />;
  return <Detail isLoading navigationTitle={choice.title} markdown="Sending to QuickAdd…" />;
}
```

- [ ] **Step 3: Wire `src/quickadd.tsx`**

Make these changes:
- Imports: add `useState` from react; `findCli, readRegistry` from `./cli`; `detectMode, REASON_TEXT` from `./mode`; `RunSession` from `./RunSession`.
- `Command`: read `cliPath` alongside `vaultPath` from `getPreferenceValues<Preferences>()`. Pass `cliPath={cliPath}` to every `<Choices …/>` (both the direct `target` render and the vault-picker `Action.Push`).
- Replace `Choices` with:

```tsx
function Choices({ vaultPath, choiceId, cliPath }: { vaultPath: string; choiceId?: string; cliPath?: string }) {
  const [checks, setChecks] = useState(0);
  const mode = useMemo(() => detectMode(findCli(cliPath || undefined), readRegistry()), [cliPath, checks]);
  const loaded = useMemo((): { choices: Choice[]; error?: string } => {
    try {
      return { choices: loadChoices(vaultPath) };
    } catch (error) {
      return { choices: [], error: error instanceof ConfigError ? error.message : String(error) };
    }
  }, [vaultPath]);
  const { data: sorted, visitItem } = useFrecencySorting(loaded.choices, { key: (c) => c.id, namespace: vaultPath });
  const name = vaultName(vaultPath);
  const direct = choiceId ? loaded.choices.find((c) => c.id === choiceId) : undefined;

  useEffect(() => {
    if (!choiceId || loaded.error) return;
    if (!direct) showToast({ style: Toast.Style.Failure, title: "Choice no longer exists" });
    else if (mode.mode === "basic" && direct.fields.length === 0) runChoice(name, direct, []);
  }, []);

  if (loaded.error) return <ErrorView message={loaded.error} />;
  if (direct) {
    if (mode.mode === "full") return <RunSession cli={mode.cli} vaultPath={vaultPath} vaultName={name} choice={direct} />;
    if (direct.fields.length > 0) return <ChoiceForm vaultName={name} choice={direct} />;
    return <List isLoading />;
  }

  const primaryAction = (choice: Choice) => {
    if (mode.mode === "full") {
      return (
        <Action.Push
          title="Run"
          icon={Icon.Play}
          target={<RunSession cli={mode.cli} vaultPath={vaultPath} vaultName={name} choice={choice} />}
          onPush={() => visitItem(choice)}
        />
      );
    }
    if (choice.fields.length > 0) {
      return (
        <Action.Push
          title="Fill in"
          icon={Icon.Pencil}
          target={<ChoiceForm vaultName={name} choice={choice} />}
          onPush={() => visitItem(choice)}
        />
      );
    }
    return (
      <Action
        title="Run"
        icon={Icon.Play}
        onAction={() => {
          visitItem(choice);
          runChoice(name, choice, []);
        }}
      />
    );
  };

  return (
    <List searchBarPlaceholder="Search QuickAdd choices">
      {mode.mode === "basic" ? (
        <List.Section title="Basic Mode">
          <List.Item
            title="Full QuickAdd support is off"
            subtitle={REASON_TEXT[mode.reason]}
            icon={Icon.Warning}
            actions={
              <ActionPanel>
                <Action title="Check Again" icon={Icon.ArrowClockwise} onAction={() => setChecks((n) => n + 1)} />
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}
      <List.Section title="Choices">
        {sorted.map((choice) => (
          <List.Item
            key={choice.id}
            title={choice.title}
            icon={choice.type === "Capture" ? Icon.Plus : Icon.Document}
            accessories={[{ tag: choice.type }]}
            actions={
              <ActionPanel>
                {primaryAction(choice)}
                <Action.CreateQuicklink
                  title="Create Quicklink"
                  shortcut={{ modifiers: ["cmd", "shift"], key: "q" }}
                  quicklink={{
                    name: `QuickAdd: ${choice.name}`,
                    link: createDeeplink({ command: "quickadd", context: { vaultPath, choiceId: choice.id } }),
                  }}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
```

`package.json` — append to `preferences`:

```json
    {
      "name": "cliPath",
      "title": "Obsidian CLI",
      "description": "Path to obsidian-cli. Leave empty to use the one inside the Obsidian app.",
      "type": "file",
      "required": false
    }
```

- [ ] **Step 4: README** — replace the text between the intro bullets and "## Hotkeys and aliases" with:

```markdown
## Full and basic mode

**Full mode** (recommended) runs choices through QuickAdd's interactive command-line interface. Everything QuickAdd asks — text, one-page forms, suggesters and file pickers, multi-selects, checkboxes, dates, confirmations — is answered in Raycast. It needs:

- Obsidian 1.12 or later, with **Settings → General → Advanced → Command line interface** turned on (restart Obsidian afterwards).
- QuickAdd 2.27 or later.

If any of these is missing, the extension uses **basic mode**: it fills `{{VALUE}}` placeholders from the choice's format, file name and template in a Raycast form and sends them through QuickAdd's `obsidian://quickadd` link. Anything else QuickAdd asks then appears in Obsidian. The choice list says why basic mode is on.

## Requirements

- Obsidian with the QuickAdd plugin. Obsidian is started if it isn't running.

## Setup

The vault is detected automatically when exactly one vault has QuickAdd. Otherwise set **Vault Folder** in the extension preferences, or pick the vault from the list.
```

and replace the "Limitations" list with:

```markdown
- Templater's own prompts (`tp.system.prompt` and similar) always appear in Obsidian.
- `{{selected}}` and `{{linkcurrent}}` come from Obsidian's active editor, not from Raycast.
- In basic mode, Raycast can't see whether QuickAdd succeeded; errors appear in Obsidian.
```

- [ ] **Step 5: Verify**

Run: `npm run build && npx tsc --noEmit && npx vitest run && npm run lint`
Expected: build succeeds (it regenerates `raycast-env.d.ts` with the new `cliPath` preference — run it before `tsc`), tsc clean, all tests pass. Lint: only the known `author` 404 error; fix anything else (`npm run fix-lint` for formatting and title case). If a Raycast 2.x prop doesn't type-check (e.g. `Form.DatePicker.Type`, `info`), adapt it per Global Constraints and record a Ruling.

- [ ] **Step 6: Commit**

```bash
git add src package.json README.md
git commit -m "feat: full mode — answer QuickAdd's interactive prompts in Raycast"
```

---

### Task 7: E2E fixture vault

**Files:**
- Create: `e2e-vault/.obsidian/community-plugins.json`, `e2e-vault/.obsidian/plugins/quickadd/data.json`, `e2e-vault/Templates/labeled.md`, `e2e-vault/Templates/blank.md`, `e2e-vault/scripts/all-prompts.js`, `e2e-vault/Inbox.md`, `e2e-vault/Targets/Target A.md`, `e2e-vault/Targets/Target B.md`, `e2e-vault/Notes/.gitkeep`, `scripts/setup-e2e-vault.sh`, `.prettierignore`
- Modify: `.gitignore`, `eslint.config.js`

- [ ] **Step 1: Write the fixture**

`e2e-vault/.obsidian/community-plugins.json`:

```json
["quickadd"]
```

`e2e-vault/Inbox.md`:

```markdown
# Inbox
```

`e2e-vault/Targets/Target A.md` and `Target B.md` (same content apart from the heading):

```markdown
---
tags: [e2e/target]
---
# Target A
```

`e2e-vault/Templates/labeled.md`:

```markdown
Where: {{VALUE:Where?|default:Home}}
Notes: {{VALUE:Notes|optional}}
```

`e2e-vault/Templates/blank.md`:

```markdown
Created {{DATE}}
```

`e2e-vault/scripts/all-prompts.js`:

```js
// Exercises every QuickAdd API prompt; appends what it got to "Macro results.md".
module.exports = async (params) => {
  const { quickAddApi: qa, app } = params;
  const text = await qa.inputPrompt("Short text", "type something", "hello");
  const long = await qa.wideInputPrompt("Long text");
  const fruit = await qa.suggester(["Apple", "Banana", "Cherry"], ["apple", "banana", "cherry"], "Pick a fruit", true);
  const boxes = await qa.checkboxPrompt(["one", "two", "three"], ["two"]);
  const date = await qa.datePrompt("Pick a date");
  const write = await qa.yesNoPrompt("Write the results?", "Appends a line to Macro results.md");
  await qa.infoDialog("Almost done", ["Line one", "Line two"]);
  if (!write) return;
  const line = `- ${JSON.stringify({ text, long, fruit, boxes, date })}\n`;
  const file = "Macro results.md";
  if (await app.vault.adapter.exists(file)) await app.vault.adapter.append(file, line);
  else await app.vault.create(file, line);
};
```

`e2e-vault/.obsidian/plugins/quickadd/data.json`:

```json
{
  "choices": [
    {
      "id": "e2e-text-capture",
      "name": "Text capture",
      "type": "Capture",
      "command": false,
      "appendLink": false,
      "captureTo": "Inbox.md",
      "captureToActiveFile": false,
      "createFileIfItDoesntExist": { "enabled": false, "createWithTemplate": false, "template": "" },
      "format": { "enabled": true, "format": "- text: {{VALUE}}\n" },
      "insertAfter": { "enabled": false, "after": "", "insertAtEnd": false, "considerSubsections": false, "createIfNotFound": false, "createIfNotFoundLocation": "top" },
      "prepend": false,
      "task": false,
      "openFile": false,
      "openFileInMode": "default",
      "fileOpening": { "location": "tab", "direction": "vertical", "focus": true, "mode": "default" }
    },
    {
      "id": "e2e-pick-option",
      "name": "Pick option",
      "type": "Capture",
      "command": false,
      "appendLink": false,
      "captureTo": "Inbox.md",
      "captureToActiveFile": false,
      "createFileIfItDoesntExist": { "enabled": false, "createWithTemplate": false, "template": "" },
      "format": { "enabled": true, "format": "- colour: {{VALUE:red,green,blue}}\n" },
      "insertAfter": { "enabled": false, "after": "", "insertAtEnd": false, "considerSubsections": false, "createIfNotFound": false, "createIfNotFoundLocation": "top" },
      "prepend": false,
      "task": false,
      "openFile": false,
      "openFileInMode": "default",
      "fileOpening": { "location": "tab", "direction": "vertical", "focus": true, "mode": "default" }
    },
    {
      "id": "e2e-multi-pick",
      "name": "Multi pick",
      "type": "Capture",
      "command": false,
      "appendLink": false,
      "captureTo": "Inbox.md",
      "captureToActiveFile": false,
      "createFileIfItDoesntExist": { "enabled": false, "createWithTemplate": false, "template": "" },
      "format": { "enabled": true, "format": "- tags: {{VALUE:alpha,beta,gamma|multi}}\n" },
      "insertAfter": { "enabled": false, "after": "", "insertAtEnd": false, "considerSubsections": false, "createIfNotFound": false, "createIfNotFoundLocation": "top" },
      "prepend": false,
      "task": false,
      "openFile": false,
      "openFileInMode": "default",
      "fileOpening": { "location": "tab", "direction": "vertical", "focus": true, "mode": "default" }
    },
    {
      "id": "e2e-due-date",
      "name": "Due date",
      "type": "Capture",
      "command": false,
      "appendLink": false,
      "captureTo": "Inbox.md",
      "captureToActiveFile": false,
      "createFileIfItDoesntExist": { "enabled": false, "createWithTemplate": false, "template": "" },
      "format": { "enabled": true, "format": "- due: {{VDATE:due,YYYY-MM-DD}}\n" },
      "insertAfter": { "enabled": false, "after": "", "insertAtEnd": false, "considerSubsections": false, "createIfNotFound": false, "createIfNotFoundLocation": "top" },
      "prepend": false,
      "task": false,
      "openFile": false,
      "openFileInMode": "default",
      "fileOpening": { "location": "tab", "direction": "vertical", "focus": true, "mode": "default" }
    },
    {
      "id": "e2e-capture-to-tag",
      "name": "Capture to tag",
      "type": "Capture",
      "command": false,
      "appendLink": false,
      "captureTo": "#e2e/target",
      "captureToActiveFile": false,
      "createFileIfItDoesntExist": { "enabled": false, "createWithTemplate": false, "template": "" },
      "format": { "enabled": true, "format": "- tagged: {{VALUE}}\n" },
      "insertAfter": { "enabled": false, "after": "", "insertAtEnd": false, "considerSubsections": false, "createIfNotFound": false, "createIfNotFoundLocation": "top" },
      "prepend": false,
      "task": false,
      "openFile": false,
      "openFileInMode": "default",
      "fileOpening": { "location": "tab", "direction": "vertical", "focus": true, "mode": "default" }
    },
    {
      "id": "e2e-labeled-note",
      "name": "Labeled note",
      "type": "Template",
      "command": false,
      "templatePath": "Templates/labeled.md",
      "fileNameFormat": { "enabled": true, "format": "{{VALUE:Title}}" },
      "folder": { "enabled": true, "folders": ["Notes"], "chooseWhenCreatingNote": false, "createInSameFolderAsActiveFile": false, "chooseFromSubfolders": false },
      "appendLink": false,
      "openFile": true,
      "openFileInMode": "default",
      "fileOpening": { "location": "tab", "direction": "vertical", "focus": true, "mode": "default" },
      "fileExistsBehavior": { "kind": "prompt" }
    },
    {
      "id": "e2e-file-name-only",
      "name": "File name only",
      "type": "Template",
      "command": false,
      "templatePath": "Templates/blank.md",
      "fileNameFormat": { "enabled": false, "format": "" },
      "folder": { "enabled": true, "folders": ["Notes"], "chooseWhenCreatingNote": false, "createInSameFolderAsActiveFile": false, "chooseFromSubfolders": false },
      "appendLink": false,
      "openFile": false,
      "openFileInMode": "default",
      "fileOpening": { "location": "tab", "direction": "vertical", "focus": true, "mode": "default" },
      "fileExistsBehavior": { "kind": "prompt" }
    },
    {
      "id": "e2e-all-prompts",
      "name": "All prompts macro",
      "type": "Macro",
      "command": false,
      "runOnStartup": false,
      "macro": {
        "id": "e2e-all-prompts-macro",
        "name": "All prompts macro",
        "commands": [{ "id": "e2e-all-prompts-script", "name": "all-prompts", "type": "UserScript", "path": "scripts/all-prompts.js", "settings": {} }]
      }
    },
    {
      "id": "e2e-group",
      "name": "Group",
      "type": "Multi",
      "command": false,
      "collapsed": false,
      "choices": [
        {
          "id": "e2e-nested-capture",
          "name": "Nested capture",
          "type": "Capture",
          "command": false,
          "appendLink": false,
          "captureTo": "Inbox.md",
          "captureToActiveFile": false,
          "createFileIfItDoesntExist": { "enabled": false, "createWithTemplate": false, "template": "" },
          "format": { "enabled": true, "format": "- nested: {{VALUE}}\n" },
          "insertAfter": { "enabled": false, "after": "", "insertAtEnd": false, "considerSubsections": false, "createIfNotFound": false, "createIfNotFoundLocation": "top" },
          "prepend": false,
          "task": false,
          "openFile": false,
          "openFileInMode": "default",
          "fileOpening": { "location": "tab", "direction": "vertical", "focus": true, "mode": "default" }
        }
      ]
    }
  ],
  "macros": [],
  "version": "2.27.0",
  "devMode": false,
  "templateFolderPaths": ["Templates"],
  "onePageInputEnabled": false,
  "disableOnlineFeatures": true,
  "announceUpdates": "none",
  "migrations": {
    "migrateToMacroIDFromEmbeddedMacro": true,
    "useQuickAddTemplateFolder": true,
    "incrementFileNameSettingMoveToDefaultBehavior": true,
    "mutualExclusionInsertAfterAndWriteToBottomOfFile": true,
    "setVersionAfterUpdateModalRelease": true,
    "addDefaultAIProviders": true,
    "removeMacroIndirection": true,
    "migrateFileOpeningSettings": true,
    "setProviderModelDiscoveryMode": true,
    "backfillFileOpeningDefaults": true,
    "migrateProviderApiKeysToSecretStorage": true,
    "consolidateFileExistsBehavior": true,
    "repairTemplateFileExistsBehavior": true,
    "migrateToMultipleTemplateFolders": true,
    "refreshStaleDefaultModelSeeds": true,
    "pinAiModelRefs": true
  }
}
```

`e2e-vault/Notes/.gitkeep`: empty.

`scripts/setup-e2e-vault.sh` (mode 755):

```sh
#!/bin/sh
# Copy an installed QuickAdd plugin into the e2e fixture vault (plugin code is not committed).
set -eu
src="${1:?usage: scripts/setup-e2e-vault.sh <path to .obsidian/plugins/quickadd of a vault that has QuickAdd>}"
dest="$(cd "$(dirname "$0")/.." && pwd)/e2e-vault/.obsidian/plugins/quickadd"
for f in main.js manifest.json styles.css; do
  if [ -f "$src/$f" ]; then cp "$src/$f" "$dest/$f"; fi
done
echo "QuickAdd copied into $dest"
```

`.gitignore` — append:

```
# e2e fixture vault: keep only the fixture, not Obsidian's state or plugin code
e2e-vault/.obsidian/*
!e2e-vault/.obsidian/community-plugins.json
!e2e-vault/.obsidian/plugins/
e2e-vault/.obsidian/plugins/*
!e2e-vault/.obsidian/plugins/quickadd/
e2e-vault/.obsidian/plugins/quickadd/*
!e2e-vault/.obsidian/plugins/quickadd/data.json
```

`.prettierignore`:

```
e2e-vault
```

`eslint.config.js` — ignore the fixture:

```js
const { defineConfig } = require("eslint/config");
const raycastConfig = require("@raycast/eslint-config");

module.exports = defineConfig([{ ignores: ["e2e-vault/**"] }, ...raycastConfig]);
```

- [ ] **Step 2: Check the fixture loads with the extension's own reader**

Run:
```bash
npx tsx -e 'import { loadChoices } from "./src/config"; for (const c of loadChoices("e2e-vault")) console.log(c.type.padEnd(8), c.title.padEnd(22), JSON.stringify(c.fields.map(f => f.label)), c.promptsInObsidian ? "OBSIDIAN" : "")'
```
Expected: 9 lines:
- Text capture `["Value"]`
- Pick option `["red,green,blue"]`
- Multi pick `[]` OBSIDIAN
- Due date `[]` OBSIDIAN (only a `{{VDATE}}` token)
- Capture to tag `["Value"]` OBSIDIAN
- Labeled note `["Title","Where?","Notes"]`
- File name only `["File name"]`
- All prompts macro `[]` OBSIDIAN
- Group › Nested capture `["Value"]`

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run && npm run lint 2>&1 | grep -E "error|warning" || true`
Expected: tests pass; lint shows only the author error.

```bash
chmod 755 scripts/setup-e2e-vault.sh
git add e2e-vault scripts/setup-e2e-vault.sh .gitignore .prettierignore eslint.config.js
git commit -m "test: e2e fixture vault covering every QuickAdd prompt kind"
```

---

### Task 8: End-to-end check with the user

This needs the user: opening a vault in Obsidian, the Raycast UI, toggling the CLI. The executor drives the steps, verifies files where possible, and asks the user to confirm what they see. Nothing here touches the user's own vaults.

- [ ] **Step 1: Prepare** — run `scripts/setup-e2e-vault.sh ~/main-vault/.obsidian/plugins/quickadd` (copies plugin code only; reads the user's vault, writes nothing there). Ask the user to open `e2e-vault/` in Obsidian (Open folder as vault → trust the author and enable plugins), then confirm `obsidian-cli vault=e2e-vault quickadd:list` returns 9+ choices. Start `npm run dev` in the background.

- [ ] **Step 2: Full mode, each prompt kind** — for each choice the user runs it from Raycast (picking the `e2e-vault` in the vault picker) and reports what Raycast showed; the executor checks `e2e-vault` files:
  - Text capture → one-field form → `Inbox.md` has `- text: …`; HUD "Added to Inbox.md"; Obsidian stays behind.
  - Pick option → dropdown → `- colour: …`.
  - Multi pick → tag picker → `- tags: …`.
  - Due date → date picker → `- due: YYYY-MM-DD`.
  - Capture to tag → form with a dropdown of `Target A`/`Target B` → line in the chosen file.
  - Labeled note → form (Title, Where? prefilled "Home", optional Notes) → `Notes/<Title>.md`; Obsidian comes forward on that note.
  - File name only → "Note title" input → `Notes/<name>.md`.
  - All prompts macro → input, text area, suggester (try a custom value), checkboxes, date, Yes/No, info → `Macro results.md` line matching the answers.
  - Group › Nested capture → `- nested: …`.
  - Special characters: Text capture with `a+b & c=d #x 100% привет 🙂` arrives verbatim.

- [ ] **Step 3: Cancel and slow answers** — start Labeled note, press Esc on the form → no note created, and the QuickAdd run is gone (Obsidian shows no pending modal). Start Text capture, wait 90 s before submitting → still succeeds (poll loop keeps the session alive).

- [ ] **Step 4: Quicklink + hotkey** — create a quicklink for "Capture to tag", assign a hotkey, press it → the form opens directly.

- [ ] **Step 5: Vault closed / Obsidian closed** — user closes the e2e-vault window, runs Text capture → the vault reopens in the background and the capture lands in `e2e-vault/Inbox.md` (and nowhere else: `git -C ~/main-vault status` is not applicable — check `grep -r "<marker>" ~/main-vault --include='*.md'` finds nothing). Then quit Obsidian and repeat.

- [ ] **Step 6: Basic mode** — user turns the CLI off (and restarts Obsidian). Raycast list shows the "Full QuickAdd support is off" item with the cli-disabled text. Run Text capture (form, background) and Capture to tag (form shows the Obsidian-prompts note; Obsidian comes forward for the picker). Then turn the CLI on without restarting → a run falls back to basic with the toast; after a restart, full mode returns ("Check Again").

- [ ] **Step 7: Clean up and record**

```bash
git checkout -- e2e-vault && git clean -fd e2e-vault && git status --short
```
Expected: clean (ignored plugin files and Obsidian state stay). Ask the user whether to remove the e2e-vault from Obsidian's vault list. Record any deviations as Rulings; if a finding needs code, fix it TDD-first in its own commit.
