# Raycast QuickAdd Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Raycast extension that lists the QuickAdd choices of an Obsidian vault, collects every `{{value…}}` input in a Raycast form, and runs the choice through QuickAdd's `obsidian://quickadd` URI; individual choices can be bound to hotkeys/aliases via Raycast quicklinks.

**Architecture:** Pure modules (`parse.ts` token parsing, `uri.ts` URI building, `config.ts` reading `obsidian.json` / QuickAdd `data.json` / template files) are unit-tested with vitest. Thin Raycast UI (`quickadd.tsx`, `ChoiceForm.tsx`) and an effectful runner (`run.ts`, shells out to macOS `open`) sit on top. QuickAdd does all writing; the extension never writes vault files.

**Tech Stack:** TypeScript, React, `@raycast/api` ^2.5.3, `@raycast/utils` ^2.3.2, vitest ^3.2.6, ESLint 9 + `@raycast/eslint-config` ^2.2.0, Prettier 3, Node ≥ 22.22.2 (installed: 26.8.2).

**Spec:** `docs/superpowers/specs/2026-09-30-raycast-quickadd-design.md`

## Global Constraints

- Standalone: no dependency on the Raycast Obsidian extension; only on the QuickAdd Obsidian plugin (tested against 2.27.0).
- The extension never writes vault files; QuickAdd does all formatting/writing.
- URI selects a choice **by name** (`choice=<name>`); values are passed as `value-<key>=<text>`; all components encoded with `encodeURIComponent` (never `URLSearchParams`, which turns spaces into `+`).
- Variable key = part of the token spec before the first `|`, trimmed; plain `{{value}}` / `{{name}}` → key `value`.
- HUD wording is "Sent to QuickAdd: <choice>" for captures — never "Saved".
- Store-publishable: no user-specific defaults, MIT licence, README, CHANGELOG, 512×512 `assets/extension-icon.png`, `npm run lint` clean. `author` in `package.json` is `ievlevpn` — **confirm the user's Raycast Store username before any publish** (not part of this plan).
- `@raycast/api` 2.x is recent (first 2.0 release 2026-08-19). If a component/prop used below fails to type-check, look up the current signature in `node_modules/@raycast/api/types/index.d.ts` (and `node_modules/@raycast/utils/dist/*.d.ts`) and adapt; do not downgrade to 1.x.
- Real user vault: `/Users/ievlevpn/main-vault` (vault name `main-vault`). Only Task 1 and Task 6 touch it, and every artefact they create is removed at the end of the step that created it.

## Review Focus

1. **Special characters in inputs** (`&`, `=`, `#`, `%`, `+`, `?`, newlines, Cyrillic, emoji) must reach the note verbatim — covered by the round-trip test in Task 3 and the spike in Task 1.
2. **Obsidian not running** when a capture is fired — the URI must still launch Obsidian and complete the capture (manual check in Task 6, step 5).
3. **Template choice with file-name format disabled** (Person) — QuickAdd then asks for the file name via `{{value}}`; it must appear in the Raycast form as "File name" — test in Task 4.
4. **Duplicate choice names** — URI runs by name, so QuickAdd may run the other one; the form must warn — test in Task 4.
5. **Choices that still prompt inside Obsidian** (Templater `tp.system.prompt`, `{{VDATE:}}`, `{{field:}}`, macros, capture to a `#tag` or folder, template folder picker) — the form must say "Some prompts will appear in Obsidian." — tests in Tasks 2 and 4.

---

## File Structure

```
package.json            Raycast manifest + npm scripts + deps
tsconfig.json           Raycast standard TS config
eslint.config.js        Raycast ESLint flat config
.prettierrc             Raycast Prettier settings
.gitignore
vitest.config.ts        test include pattern
LICENSE                 MIT
README.md               usage, quicklink/hotkey how-to, limitations
CHANGELOG.md
assets/extension-icon.png   512×512 icon
src/types.ts            Field, Choice types (no Raycast imports)
src/parse.ts            pure: texts → fields + "prompts in Obsidian" flag
src/uri.ts              pure: collectVars, buildQuickAddUri, VAULT_PARAM
src/config.ts           fs: findQuickAddVaults, vaultName, loadChoices, ConfigError
src/run.ts              effect: open URI, HUD/toast
src/ChoiceForm.tsx      form for one choice
src/quickadd.tsx        the command: vault resolution, list, launch-context routing
tests/parse.test.ts
tests/uri.test.ts
tests/config.test.ts
docs/superpowers/notes/2026-09-30-uri-spike.md   spike findings (Task 1)
```

---

### Task 1: URI spike against the real vault

Answers three questions before code depends on them: (a) is the vault query param `vault` or `vaultName`; (b) does `open -g` keep Obsidian in the background; (c) do `value-<trimmed key>` params fill template-body variables with no Obsidian prompt, and do special characters survive. No code is kept; findings go into a notes file.

**Files:**
- Create: `docs/superpowers/notes/2026-09-30-uri-spike.md`

**Interfaces:**
- Produces: the recorded values `VAULT_PARAM` (`vault` or `vaultName`), `FOCUS_STEAL` (`yes`/`no`), `TRIMMED_KEYS_WORK` (`yes`/`no`), `ENCODING_OK` (`yes`/`no`), consumed by Tasks 3 and 5.

- [ ] **Step 1: Make sure Obsidian is running with main-vault open**

Run: `pgrep -x Obsidian >/dev/null && echo running || (open -a Obsidian && echo started)`
Then wait until the vault is loaded:
Run: `for i in $(seq 50); do pgrep -x Obsidian >/dev/null && break; /bin/sleep 0.2; done; /bin/sleep 3; echo ok`
Expected: `ok`

- [ ] **Step 2: Capture via `vault=` with `open -g`, from a non-Obsidian frontmost app**

```bash
V="/Users/ievlevpn/main-vault"; F="$V/Quick thoughts.md"
osascript -e 'tell application "Finder" to activate'; /bin/sleep 0.5
open -g "obsidian://quickadd?vault=main-vault&choice=Thought&value-value=RAYCAST-SPIKE-A"
for i in $(seq 25); do grep -q RAYCAST-SPIKE-A "$F" && break; /bin/sleep 0.2; done
grep -c RAYCAST-SPIKE-A "$F"
/bin/sleep 1
osascript -e 'tell application "System Events" to get bundle identifier of first application process whose frontmost is true'
```

Expected: count `1` (→ `VAULT_PARAM=vault`). Frontmost `com.apple.finder` → `FOCUS_STEAL=no`; `md.obsidian` → `FOCUS_STEAL=yes`.
If the count is `0`, repeat the block with `vaultName=main-vault` and marker `RAYCAST-SPIKE-B`; if that gives `1`, `VAULT_PARAM=vaultName`. If neither works, stop and report to the user.

- [ ] **Step 3: Encoding round trip**

```bash
V="/Users/ievlevpn/main-vault"; F="$V/Quick thoughts.md"
VAL=$(node -e 'process.stdout.write(encodeURIComponent("RAYCAST-SPIKE-C a+b & c=d #x 100% ?q привет 🙂"))')
open -g "obsidian://quickadd?vault=main-vault&choice=Thought&value-value=$VAL"
for i in $(seq 25); do grep -q RAYCAST-SPIKE-C "$F" && break; /bin/sleep 0.2; done
grep RAYCAST-SPIKE-C "$F"
```

(Use `vaultName=` instead if Step 2 said so.)
Expected: the line ends with exactly `RAYCAST-SPIKE-C a+b & c=d #x 100% ?q привет 🙂` → `ENCODING_OK=yes`. Anything else → `ENCODING_OK=no`, record the exact output.

- [ ] **Step 4: Template-body variable with a leading-space key (Math idea)**

`Math idea` has filename `{{DATE:…}} {{value:Title}}` and template body `{{value: Source?}}`.

```bash
V="/Users/ievlevpn/main-vault"
open "obsidian://quickadd?vault=main-vault&choice=Math%20idea&value-Title=RAYCAST-SPIKE-D&value-Source%3F=spike-source-D"
for i in $(seq 40); do ls "$V/Math ideas/"*RAYCAST-SPIKE-D* >/dev/null 2>&1 && break; /bin/sleep 0.2; done
ls "$V/Math ideas/"*RAYCAST-SPIKE-D*; grep -c spike-source-D "$V/Math ideas/"*RAYCAST-SPIKE-D*
```

Expected: the file exists within ~8 s (meaning no prompt blocked it) and the count is `1` → `TRIMMED_KEYS_WORK=yes`. If the file doesn't appear, Obsidian is showing a prompt: ask the user what it asks for, have them cancel it, then retry with `value-%20Source%3F=` in place of `value-Source%3F=`. If that works, `TRIMMED_KEYS_WORK=no (raw key needed)`.

- [ ] **Step 5: Remove every spike artefact**

```bash
V="/Users/ievlevpn/main-vault"; F="$V/Quick thoughts.md"
sed -i '' '/RAYCAST-SPIKE-/d' "$F"
for f in "$V/Math ideas/"*RAYCAST-SPIKE-D*; do [ -e "$f" ] && mv "$f" ~/.Trash/; done
grep -rl RAYCAST-SPIKE- "$V" --include='*.md' || echo clean
```

Expected: `clean`. Obsidian will also have opened the Math idea note in a tab; it closes automatically once the file is gone.

- [ ] **Step 6: Record findings**

Write `docs/superpowers/notes/2026-09-30-uri-spike.md`:

```markdown
# URI spike — 2026-09-30

QuickAdd 2.27.0, Obsidian running, vault main-vault.

- VAULT_PARAM: <vault|vaultName>
- FOCUS_STEAL (open -g, Finder frontmost before): <yes|no> — frontmost after: <bundle id>
- ENCODING_OK: <yes|no> — captured text: `<exact line>`
- TRIMMED_KEYS_WORK: <yes|no (raw key needed)>
- Artefacts removed: yes
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/notes/2026-09-30-uri-spike.md
git commit -m "docs: record QuickAdd URI spike findings"
```

---

### Task 2: Project setup, types, and placeholder parsing

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `.gitignore`, `vitest.config.ts`, `src/types.ts`, `src/parse.ts`, `tests/parse.test.ts`

**Interfaces:**
- Produces:
  - `src/types.ts`: `interface Field { key: string; rawKey: string; label: string; options?: string[]; defaultValue?: string; optional: boolean }`, `interface Choice { id: string; name: string; title: string; type: string; fields: Field[]; notes: string[] }`
  - `src/parse.ts`: `parseToken(spec: string | undefined): Field`, `parseFields(texts: string[]): { fields: Field[]; hasObsidianPrompts: boolean }`

- [ ] **Step 1: Write project files**

`package.json`:

```json
{
  "$schema": "https://www.raycast.com/schemas/extension.json",
  "name": "obsidian-quickadd",
  "title": "Obsidian QuickAdd",
  "description": "Run Obsidian QuickAdd choices from Raycast, filling their prompts in Raycast",
  "icon": "extension-icon.png",
  "author": "ievlevpn",
  "categories": ["Productivity"],
  "license": "MIT",
  "platforms": ["macOS"],
  "commands": [
    {
      "name": "quickadd",
      "title": "QuickAdd",
      "subtitle": "Obsidian",
      "description": "Pick a QuickAdd choice, fill in its fields, and run it in Obsidian",
      "mode": "view"
    }
  ],
  "preferences": [
    {
      "name": "vaultPath",
      "title": "Vault Folder",
      "description": "Obsidian vault that has QuickAdd installed. Leave empty to detect it automatically.",
      "type": "directory",
      "required": false
    }
  ],
  "dependencies": {
    "@raycast/api": "^2.5.3",
    "@raycast/utils": "^2.3.2"
  },
  "devDependencies": {
    "@raycast/eslint-config": "^2.2.0",
    "@types/node": "22.19.17",
    "@types/react": "19.0.10",
    "eslint": "^9.22.0",
    "prettier": "^3.9.9",
    "typescript": "^5.9.0",
    "vitest": "^3.2.6"
  },
  "scripts": {
    "build": "ray build",
    "dev": "ray develop",
    "fix-lint": "ray lint --fix",
    "lint": "ray lint",
    "test": "vitest run",
    "publish": "npx @raycast/api@latest publish"
  }
}
```

`tsconfig.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "include": ["src/**/*", "raycast-env.d.ts"],
  "compilerOptions": {
    "lib": ["ES2023"],
    "module": "commonjs",
    "target": "ES2023",
    "strict": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "jsx": "react-jsx",
    "resolveJsonModule": true
  }
}
```

`eslint.config.js`:

```js
const { defineConfig } = require("eslint/config");
const raycastConfig = require("@raycast/eslint-config");

module.exports = defineConfig([...raycastConfig]);
```

`.prettierrc`:

```json
{
  "printWidth": 120,
  "singleQuote": false
}
```

`.gitignore`:

```
node_modules/
dist/
raycast-env.d.ts
.DS_Store
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
```

`src/types.ts`:

```ts
export interface Field {
  /** QuickAdd variable name (token spec before the first `|`, trimmed). */
  key: string;
  /** The same segment untrimmed; also sent when it differs from `key`. */
  rawKey: string;
  label: string;
  options?: string[];
  defaultValue?: string;
  optional: boolean;
}

export interface Choice {
  id: string;
  /** Exact QuickAdd name — what the URI selects by. */
  name: string;
  /** Display title; "Parent › Child" for choices nested in a Multi. */
  title: string;
  /** "Capture", "Template", "Macro", or whatever QuickAdd stores. */
  type: string;
  fields: Field[];
  /** Messages shown at the top of the form. */
  notes: string[];
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: completes; `node_modules/.bin/ray` and `node_modules/.bin/vitest` exist.

- [ ] **Step 3: Write the failing tests**

`tests/parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseFields, parseToken } from "../src/parse";

const keys = (texts: string[]) => parseFields(texts).fields.map((f) => f.key);

describe("parseToken", () => {
  it("treats a missing or empty spec as the plain value", () => {
    expect(parseToken(undefined)).toEqual({ key: "value", rawKey: "value", label: "Value", optional: false });
    expect(parseToken("")).toEqual({ key: "value", rawKey: "value", label: "Value", optional: false });
  });

  it("trims the key but keeps the raw segment", () => {
    expect(parseToken(" Source?")).toEqual({ key: "Source?", rawKey: " Source?", label: "Source?", optional: false });
  });

  it("reads label, default and optional modifiers", () => {
    expect(parseToken("note name|label:start with a space")).toMatchObject({
      key: "note name",
      label: "start with a space",
    });
    expect(parseToken("Where?|default:ETH|optional")).toMatchObject({
      key: "Where?",
      defaultValue: "ETH",
      optional: true,
    });
  });

  it("turns comma lists into options", () => {
    expect(parseToken("red, green ,blue")).toMatchObject({ key: "red, green ,blue", options: ["red", "green", "blue"] });
  });
});

describe("parseFields", () => {
  it("finds the plain value in a capture format (Thought)", () => {
    expect(keys(["- {{DATE}}, {{time}}: {{value}}"])).toEqual(["value"]);
  });

  it("is case-insensitive on VALUE and treats NAME as value", () => {
    expect(keys(["{{VALUE:Email address}} {{NAME}} {{name}} {{value}}"])).toEqual(["Email address", "value"]);
  });

  it("dedupes by key across texts, in first-appearance order (Letter)", () => {
    const filename = "{{DATE:YYYY.MM.DD.mm.ss}} letter to {{VALUE:Dear (name)}}";
    const body = "Dear {{VALUE:Dear (name)}},\n{{VALUE:Subject}}\n{{VALUE:Email address}}";
    expect(keys([filename, body])).toEqual(["Dear (name)", "Subject", "Email address"]);
  });

  it("ignores non-value tokens", () => {
    const t = "{{date:YYYY}} {{DATE}} {{time}} {{selected}} {{LINKCURRENT}} {{valuex}} {{VDATE:due,YYYY}}";
    expect(keys([t])).toEqual([]);
  });

  it("flags inputs that QuickAdd or Templater will still ask for in Obsidian", () => {
    expect(parseFields(["<% tp.system.prompt('Who?') %>"]).hasObsidianPrompts).toBe(true);
    expect(parseFields(["<% tp.system.suggester(['a'], ['a']) %>"]).hasObsidianPrompts).toBe(true);
    expect(parseFields(["{{VDATE:due,YYYY-MM-DD}}"]).hasObsidianPrompts).toBe(true);
    expect(parseFields(["{{FIELD:status}}"]).hasObsidianPrompts).toBe(true);
    expect(parseFields(["{{MACRO:doThing}}"]).hasObsidianPrompts).toBe(true);
    expect(parseFields(["<% tp.date.now() %> {{value}} {{DATE}}"]).hasObsidianPrompts).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/parse.test.ts`
Expected: FAIL — cannot resolve `../src/parse`.

- [ ] **Step 5: Implement `src/parse.ts`**

```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/parse.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json eslint.config.js .prettierrc .gitignore vitest.config.ts src/types.ts src/parse.ts tests/parse.test.ts
git commit -m "feat: project setup and QuickAdd placeholder parsing"
```

---

### Task 3: URI building

**Files:**
- Create: `src/uri.ts`, `tests/uri.test.ts`

**Interfaces:**
- Consumes: `Field` from `src/types.ts`.
- Produces: `VAULT_PARAM: string`, `collectVars(fields: Field[], values: string[]): Record<string, string>`, `buildQuickAddUri(vaultName: string, choiceName: string, vars: Record<string, string>): string`.

Read `docs/superpowers/notes/2026-09-30-uri-spike.md` first. The code below assumes `VAULT_PARAM: vault`; if the spike recorded `vaultName`, use that string in `VAULT_PARAM` **and** in the expected literals in the tests.

- [ ] **Step 1: Write the failing tests**

`tests/uri.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildQuickAddUri, collectVars } from "../src/uri";
import { Field } from "../src/types";

const field = (key: string, rawKey = key): Field => ({ key, rawKey, label: key, optional: false });

function decodeQuery(uri: string): [string, string][] {
  const query = uri.slice(uri.indexOf("?") + 1);
  return query.split("&").map((pair) => {
    const eq = pair.indexOf("=");
    return [decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1))];
  });
}

describe("buildQuickAddUri", () => {
  it("builds the basic capture URI", () => {
    expect(buildQuickAddUri("main-vault", "Thought", { value: "hi" })).toBe(
      "obsidian://quickadd?vault=main-vault&choice=Thought&value-value=hi",
    );
  });

  it("round-trips special characters in names, keys and values", () => {
    const value = "a+b & c=d #x 100% ?q привет 🙂\nline2";
    const uri = buildQuickAddUri("my vault", "Latin vocab & notes", { "Source?": value });
    expect(uri).not.toMatch(/[\s+#]/);
    expect(decodeQuery(uri)).toEqual([
      ["vault", "my vault"],
      ["choice", "Latin vocab & notes"],
      ["value-Source?", value],
    ]);
  });

  it("omits value params when there are no vars", () => {
    expect(buildQuickAddUri("v", "Quick note (brain dump)", {})).toBe(
      "obsidian://quickadd?vault=v&choice=Quick%20note%20(brain%20dump)",
    );
  });
});

describe("collectVars", () => {
  it("maps values to keys by position and sends the raw key too when it differs", () => {
    expect(collectVars([field("Title"), field("Source?", " Source?")], ["T", "S"])).toEqual({
      Title: "T",
      "Source?": "S",
      " Source?": "S",
    });
  });

  it("sends an empty string for a missing value so QuickAdd does not prompt", () => {
    expect(collectVars([field("value")], [])).toEqual({ value: "" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/uri.test.ts`
Expected: FAIL — cannot resolve `../src/uri`.

- [ ] **Step 3: Implement `src/uri.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS, all tests in both files.

- [ ] **Step 5: Commit**

```bash
git add src/uri.ts tests/uri.test.ts
git commit -m "feat: build obsidian://quickadd URIs"
```

---

### Task 4: Reading vaults, QuickAdd config and templates

**Files:**
- Create: `src/config.ts`, `tests/config.test.ts`

**Interfaces:**
- Consumes: `parseFields` from `src/parse.ts`; `Choice`, `Field` from `src/types.ts`.
- Produces:
  - `class ConfigError extends Error`
  - `DEFAULT_OBSIDIAN_JSON: string`, `QUICKADD_DATA: string` (`.obsidian/plugins/quickadd/data.json`)
  - `OBSIDIAN_PROMPTS_NOTE: string`
  - `findQuickAddVaults(obsidianJsonPath?: string): string[]`
  - `vaultName(vaultPath: string): string`
  - `loadChoices(vaultPath: string): Choice[]` (throws `ConfigError`)

Rules implemented here (from the spec and from QuickAdd 2.27 behaviour):
- Capture: scan `format.format` if `format.enabled`, else `{{value}}` (QuickAdd captures the raw value when the format is off); scan `captureTo` unless `captureToActiveFile`. A `captureTo` that starts with `#` or ends with `/` makes QuickAdd show a file picker, so the Obsidian-prompt note is added.
- Template: scan `fileNameFormat.format` if enabled, else `{{value}}`, labelled "File name" (QuickAdd uses `{{VALUE}}` as the file name when the format is off). Then scan the template file (vault-relative `templatePath`, with `.md` appended if the path doesn't exist as given). If the file is missing, add a note. `folder.chooseWhenCreatingNote`, `folder.chooseFromSubfolders`, or more than one folder in `folder.folders` means a folder picker, so the Obsidian-prompt note is added.
- Multi: flatten children with title `Parent › Child`.
- Any other type (Macro, etc.): no fields, plus the Obsidian-prompt note.
- Duplicate names: add a note to each duplicate.

- [ ] **Step 1: Write the failing tests**

`tests/config.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  OBSIDIAN_PROMPTS_NOTE,
  QUICKADD_DATA,
  findQuickAddVaults,
  loadChoices,
  vaultName,
} from "../src/config";

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function makeVault(choices: unknown[], files: Record<string, string> = {}): string {
  const vault = mkdtempSync(join(tmpdir(), "qa-vault-"));
  write(join(vault, QUICKADD_DATA), JSON.stringify({ choices }));
  for (const [path, content] of Object.entries(files)) write(join(vault, path), content);
  return vault;
}

const capture = (over: object = {}) => ({
  id: "c1",
  name: "Thought",
  type: "Capture",
  captureTo: "Quick thoughts.md",
  captureToActiveFile: false,
  format: { enabled: true, format: "- {{DATE}}, {{time}}: {{value}}" },
  ...over,
});

const template = (over: object = {}) => ({
  id: "t1",
  name: "Math idea",
  type: "Template",
  templatePath: "Templates/math_idea.md",
  fileNameFormat: { enabled: true, format: "{{DATE:YYYY.MM.DD.HH.mm.ss}} {{value:Title}}" },
  folder: { enabled: true, folders: ["Math ideas"], chooseWhenCreatingNote: false, chooseFromSubfolders: false },
  ...over,
});

describe("findQuickAddVaults", () => {
  it("keeps only registered vaults that have QuickAdd", () => {
    const withQa = makeVault([]);
    const withoutQa = mkdtempSync(join(tmpdir(), "qa-plain-"));
    const json = join(mkdtempSync(join(tmpdir(), "qa-obs-")), "obsidian.json");
    write(json, JSON.stringify({ vaults: { a: { path: withQa }, b: { path: withoutQa }, c: { path: "/nonexistent/x" } } }));
    expect(findQuickAddVaults(json)).toEqual([withQa]);
  });

  it("returns [] for a missing or invalid obsidian.json", () => {
    expect(findQuickAddVaults("/nonexistent/obsidian.json")).toEqual([]);
    const json = join(mkdtempSync(join(tmpdir(), "qa-obs-")), "obsidian.json");
    write(json, "{not json");
    expect(findQuickAddVaults(json)).toEqual([]);
  });
});

describe("vaultName", () => {
  it("is the folder name, ignoring a trailing slash", () => {
    expect(vaultName("/Users/x/main-vault/")).toBe("main-vault");
  });
});

describe("loadChoices errors", () => {
  it("throws ConfigError when QuickAdd settings are missing", () => {
    const vault = mkdtempSync(join(tmpdir(), "qa-empty-"));
    expect(() => loadChoices(vault)).toThrow(ConfigError);
    expect(() => loadChoices(vault)).toThrow(/not found/);
  });

  it("throws ConfigError on invalid JSON or a missing choices list", () => {
    const bad = makeVault([]);
    write(join(bad, QUICKADD_DATA), "{oops");
    expect(() => loadChoices(bad)).toThrow(/Could not read/);
    const noChoices = makeVault([]);
    write(join(noChoices, QUICKADD_DATA), JSON.stringify({ macros: [] }));
    expect(() => loadChoices(noChoices)).toThrow(/no choices/);
  });
});

describe("loadChoices captures", () => {
  it("reads a plain capture", () => {
    const [c] = loadChoices(makeVault([capture()]));
    expect(c).toMatchObject({ id: "c1", name: "Thought", title: "Thought", type: "Capture", notes: [] });
    expect(c.fields.map((f) => f.key)).toEqual(["value"]);
  });

  it("asks for the value when the format is disabled", () => {
    const [c] = loadChoices(makeVault([capture({ format: { enabled: false, format: "" } })]));
    expect(c.fields.map((f) => f.key)).toEqual(["value"]);
  });

  it("notes the file picker for #tag and folder targets", () => {
    const [tag] = loadChoices(makeVault([capture({ captureTo: "#projects/quicknotes" })]));
    expect(tag.notes).toContain(OBSIDIAN_PROMPTS_NOTE);
    const [folder] = loadChoices(makeVault([capture({ captureTo: "Inbox/" })]));
    expect(folder.notes).toContain(OBSIDIAN_PROMPTS_NOTE);
  });
});

describe("loadChoices templates", () => {
  it("collects fields from file name and template body", () => {
    const vault = makeVault([template()], { "Templates/math_idea.md": "Date: {{date}}\nSource: {{value: Source?}}\n" });
    const [t] = loadChoices(vault);
    expect(t.fields.map((f) => f.key)).toEqual(["Title", "Source?"]);
    expect(t.notes).toEqual([]);
  });

  it("asks for the file name when the file-name format is disabled (Person)", () => {
    const vault = makeVault(
      [template({ name: "Person", templatePath: "Templates/person_template.md", fileNameFormat: { enabled: false, format: "" } })],
      { "Templates/person_template.md": "{{VALUE:affiliation}} {{VALUE:email}} {{VALUE:website}}" },
    );
    const [t] = loadChoices(vault);
    expect(t.fields.map((f) => [f.key, f.label])).toEqual([
      ["value", "File name"],
      ["affiliation", "affiliation"],
      ["email", "email"],
      ["website", "website"],
    ]);
  });

  it("finds a template path given without .md", () => {
    const vault = makeVault([template({ templatePath: "Templates/math_idea" })], {
      "Templates/math_idea.md": "{{value:Where?}}",
    });
    expect(loadChoices(vault)[0].fields.map((f) => f.key)).toEqual(["Title", "Where?"]);
  });

  it("still works with a missing template file, and says so", () => {
    const [t] = loadChoices(makeVault([template()]));
    expect(t.fields.map((f) => f.key)).toEqual(["Title"]);
    expect(t.notes.join(" ")).toMatch(/Template file not found: Templates\/math_idea\.md/);
  });

  it("notes Templater prompts and folder pickers", () => {
    const templater = makeVault([template()], { "Templates/math_idea.md": "<% tp.system.prompt('x') %>" });
    expect(loadChoices(templater)[0].notes).toContain(OBSIDIAN_PROMPTS_NOTE);
    const picker = makeVault([template({ folder: { enabled: true, folders: ["A", "B"] } })], {
      "Templates/math_idea.md": "",
    });
    expect(loadChoices(picker)[0].notes).toContain(OBSIDIAN_PROMPTS_NOTE);
  });
});

describe("loadChoices structure", () => {
  it("flattens Multi choices and treats unknown types as Obsidian-driven", () => {
    const vault = makeVault([
      { id: "m", name: "Vocab", type: "Multi", choices: [capture({ id: "c2", name: "French" })] },
      { id: "x", name: "Do stuff", type: "Macro" },
      { name: "no id" },
    ]);
    const choices = loadChoices(vault);
    expect(choices.map((c) => [c.id, c.name, c.title])).toEqual([
      ["c2", "French", "Vocab › French"],
      ["x", "Do stuff", "Do stuff"],
    ]);
    expect(choices[1].fields).toEqual([]);
    expect(choices[1].notes).toContain(OBSIDIAN_PROMPTS_NOTE);
  });

  it("warns on duplicate names", () => {
    const choices = loadChoices(makeVault([capture({ id: "a" }), capture({ id: "b" })]));
    for (const c of choices) expect(c.notes.join(" ")).toMatch(/Another choice is also named "Thought"/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — cannot resolve `../src/config`.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
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

  const parsed = type === "Capture" || type === "Template" ? parseFields(texts) : { fields: [], hasObsidianPrompts: false };
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS, all tests in all three files.

- [ ] **Step 5: Sanity-check against the real vault (read-only)**

Run:
```bash
npx tsx -e 'import { loadChoices } from "./src/config"; for (const c of loadChoices("/Users/ievlevpn/main-vault")) console.log(c.type.padEnd(8), c.name.padEnd(30), JSON.stringify(c.fields.map(f => f.label)), c.notes.length ? "NOTE" : "")'
```
Expected: 23 lines. Thought → `["Value"]`; Scratch → `["start with a space"]`; Person → `["File name","affiliation","email","website"]`; Letter → has `NOTE` (Templater); Project note → has `NOTE` (`#projects/quicknotes`); Quick note (brain dump) → `[]`. (`npx tsx` downloads tsx on first use; it is not added to the project.)

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: read vaults, QuickAdd choices and template fields"
```

---

### Task 5: Raycast command, form, runner, and Store files

**Files:**
- Create: `src/run.ts`, `src/ChoiceForm.tsx`, `src/quickadd.tsx`, `assets/extension-icon.png`, `LICENSE`, `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `loadChoices`, `findQuickAddVaults`, `vaultName`, `ConfigError` (config.ts); `collectVars`, `buildQuickAddUri` (uri.ts); `Choice` (types.ts); spike notes `FOCUS_STEAL`.
- Produces: `runChoice(vaultName: string, choice: Choice, values: string[]): Promise<void>`; default-export command `quickadd`; default-export `ChoiceForm({ vaultName, choice })`. Launch context shape: `{ vaultPath?: string; choiceId?: string }`.

- [ ] **Step 1: Write `src/run.ts`**

```ts
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
```

- [ ] **Step 2 (only if the spike recorded `FOCUS_STEAL: yes`): restore the previous app after background captures**

Replace `src/run.ts` with:

```ts
import { closeMainWindow, showHUD, showToast, Toast } from "@raycast/api";
import { execFile } from "child_process";
import { promisify } from "util";
import { Choice } from "./types";
import { buildQuickAddUri, collectVars } from "./uri";

const execFileAsync = promisify(execFile);
const OBSIDIAN_BUNDLE_ID = "md.obsidian";

async function frontmostBundleId(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'tell application "System Events" to get bundle identifier of first application process whose frontmost is true',
    ]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function giveFocusBack(previous: string | undefined) {
  if (!previous || previous === OBSIDIAN_BUNDLE_ID) return;
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if ((await frontmostBundleId()) === OBSIDIAN_BUNDLE_ID) {
      await execFileAsync("open", ["-b", previous]);
      return;
    }
  }
}

export async function runChoice(vaultName: string, choice: Choice, values: string[]): Promise<void> {
  const uri = buildQuickAddUri(vaultName, choice.name, collectVars(choice.fields, values));
  const background = choice.type === "Capture";
  try {
    if (background) {
      await closeMainWindow();
      const previous = await frontmostBundleId();
      await execFileAsync("open", ["-g", uri]);
      await giveFocusBack(previous);
    } else {
      await execFileAsync("open", [uri]);
    }
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    await showToast({ style: Toast.Style.Failure, title: "Could not open Obsidian", message: stderr || String(error) });
    return;
  }
  await showHUD(background ? `Sent to QuickAdd: ${choice.name}` : `Opening in Obsidian: ${choice.name}`);
}
```

- [ ] **Step 3: Write `src/ChoiceForm.tsx`**

```tsx
import { Action, ActionPanel, Form, Icon } from "@raycast/api";
import { useState } from "react";
import { runChoice } from "./run";
import { Choice } from "./types";

export default function ChoiceForm({ vaultName, choice }: { vaultName: string; choice: Choice }) {
  const [errors, setErrors] = useState<Record<number, string | undefined>>({});
  const loneValue = choice.fields.length === 1 && choice.fields[0].key === "value" && !choice.fields[0].options;

  async function submit(formValues: Record<string, string>) {
    const values = choice.fields.map((_, index) => formValues[`f${index}`] ?? "");
    const missing: Record<number, string> = {};
    choice.fields.forEach((field, index) => {
      if (!field.optional && values[index].trim() === "") missing[index] = "Required";
    });
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }
    await runChoice(vaultName, choice, values);
  }

  const clearError = (index: number) => {
    if (errors[index]) setErrors({ ...errors, [index]: undefined });
  };

  return (
    <Form
      navigationTitle={choice.title}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={choice.type === "Capture" ? "Capture" : "Create"}
            icon={Icon.Checkmark}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      {choice.notes.map((note, index) => (
        <Form.Description key={`note-${index}`} text={note} />
      ))}
      {choice.fields.map((field, index) => {
        const id = `f${index}`;
        if (field.options) {
          const defaultValue =
            field.defaultValue && field.options.includes(field.defaultValue) ? field.defaultValue : field.options[0];
          return (
            <Form.Dropdown
              key={id}
              id={id}
              title={field.label}
              defaultValue={defaultValue}
              error={errors[index]}
              onChange={() => clearError(index)}
            >
              {field.options.map((option) => (
                <Form.Dropdown.Item key={option} value={option} title={option} />
              ))}
            </Form.Dropdown>
          );
        }
        if (loneValue) {
          return (
            <Form.TextArea
              key={id}
              id={id}
              title={choice.name}
              autoFocus
              defaultValue={field.defaultValue}
              error={errors[index]}
              onChange={() => clearError(index)}
            />
          );
        }
        return (
          <Form.TextField
            key={id}
            id={id}
            title={field.label}
            autoFocus={index === 0}
            defaultValue={field.defaultValue}
            placeholder={field.optional ? "Optional" : undefined}
            error={errors[index]}
            onChange={() => clearError(index)}
          />
        );
      })}
    </Form>
  );
}
```

- [ ] **Step 4: Write `src/quickadd.tsx`**

```tsx
import {
  Action,
  ActionPanel,
  Detail,
  getPreferenceValues,
  Icon,
  LaunchProps,
  List,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { createDeeplink, useFrecencySorting } from "@raycast/utils";
import { basename } from "path";
import { useEffect, useMemo } from "react";
import ChoiceForm from "./ChoiceForm";
import { ConfigError, findQuickAddVaults, loadChoices, vaultName } from "./config";
import { runChoice } from "./run";
import { Choice } from "./types";

type LaunchContext = { vaultPath?: string; choiceId?: string };

export default function Command(props: LaunchProps<{ launchContext?: LaunchContext }>) {
  const context = props.launchContext ?? {};
  const { vaultPath: preferredPath } = getPreferenceValues<Preferences>();
  const vaults = useMemo(() => (preferredPath ? [preferredPath] : findQuickAddVaults()), [preferredPath]);
  const target = context.vaultPath ?? (vaults.length === 1 ? vaults[0] : undefined);

  if (target) return <Choices vaultPath={target} choiceId={context.choiceId} />;
  if (vaults.length === 0) {
    return (
      <ErrorView message="No Obsidian vault with QuickAdd was found. Set the vault folder in the extension preferences." />
    );
  }
  return (
    <List navigationTitle="Choose Vault">
      {vaults.map((path) => (
        <List.Item
          key={path}
          title={basename(path)}
          subtitle={path}
          icon={Icon.Folder}
          actions={
            <ActionPanel>
              <Action.Push title="Open Vault" icon={Icon.ArrowRight} target={<Choices vaultPath={path} />} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function Choices({ vaultPath, choiceId }: { vaultPath: string; choiceId?: string }) {
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
    else if (direct.fields.length === 0) runChoice(name, direct, []);
  }, []);

  if (loaded.error) return <ErrorView message={loaded.error} />;
  if (direct && direct.fields.length > 0) return <ChoiceForm vaultName={name} choice={direct} />;
  if (direct) return <List isLoading />;

  return (
    <List searchBarPlaceholder="Search QuickAdd choices">
      {sorted.map((choice) => (
        <List.Item
          key={choice.id}
          title={choice.title}
          icon={choice.type === "Capture" ? Icon.Plus : Icon.Document}
          accessories={[{ tag: choice.type }]}
          actions={
            <ActionPanel>
              {choice.fields.length > 0 ? (
                <Action.Push
                  title="Fill In"
                  icon={Icon.Pencil}
                  target={<ChoiceForm vaultName={name} choice={choice} />}
                  onPush={() => visitItem(choice)}
                />
              ) : (
                <Action
                  title="Run"
                  icon={Icon.Play}
                  onAction={() => {
                    visitItem(choice);
                    runChoice(name, choice, []);
                  }}
                />
              )}
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
    </List>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <Detail
      markdown={`# QuickAdd unavailable\n\n${message}`}
      actions={
        <ActionPanel>
          <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    />
  );
}
```

- [ ] **Step 5: Create the icon**

Run:
```bash
mkdir -p assets && uv run --with pillow python -u - <<'EOF'
from PIL import Image, ImageDraw
S = 512
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((16, 16, S - 16, S - 16), radius=110, fill=(124, 58, 237, 255))
d.rounded_rectangle((226, 116, 286, 396), radius=24, fill=(255, 255, 255, 255))
d.rounded_rectangle((116, 226, 396, 286), radius=24, fill=(255, 255, 255, 255))
img.save("assets/extension-icon.png")
EOF
file assets/extension-icon.png
```
Expected: `PNG image data, 512 x 512, 8-bit/color RGBA`.

- [ ] **Step 6: Write `LICENSE`, `README.md`, `CHANGELOG.md`**

`LICENSE`: the standard MIT licence text with the line `Copyright (c) 2026 ievlevpn`.

`README.md`:

```markdown
# Obsidian QuickAdd

Run your [QuickAdd](https://github.com/chhoumann/quickadd) choices from Raycast.

- Every `{{VALUE}}` / `{{VALUE:name}}` prompt — in the capture format, the file-name format, or the template file — is asked in a Raycast form.
- Captures run with Obsidian in the background; templates open the new note in Obsidian.
- New and changed choices show up automatically; the extension reads QuickAdd's settings each time it opens.

## Requirements

- Obsidian with the QuickAdd plugin (tested with 2.27). Obsidian must be running or able to launch.

## Setup

The vault is detected automatically when exactly one vault has QuickAdd. Otherwise set **Vault Folder** in the extension preferences, or pick the vault from the list.

## Hotkeys and aliases for single choices

Select a choice, press `⌘⇧Q` (**Create Quicklink**), and save. In Raycast settings, give that quicklink an alias or a hotkey — it opens that choice's form directly. Quicklinks refer to the choice's id, so renaming it in QuickAdd doesn't break them.

## Limitations

- Templater prompts, `{{VDATE}}`, `{{FIELD}}`, macros, and file or folder pickers are still asked in Obsidian; the form says so.
- `{{selected}}` and `{{linkcurrent}}` come from Obsidian's active editor, not from Raycast.
- Raycast can't see whether QuickAdd succeeded; errors appear in Obsidian.
```

`CHANGELOG.md`:

```markdown
# Obsidian QuickAdd Changelog

## [Initial Version] - {PR_MERGE_DATE}
```

- [ ] **Step 7: Build, lint, test**

Run: `npm run build`
Expected: succeeds and generates `raycast-env.d.ts`, which declares `Preferences` with `vaultPath`. If there are type errors from the 2.x API, fix them against `node_modules/@raycast/api/types/index.d.ts` (see Global Constraints) and re-run.

Run: `npm run lint`
Expected: no errors. For Prettier-only complaints, run `npm run fix-lint`. If the only failure is the author lookup for `ievlevpn`, note it for the user and continue.

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/run.ts src/ChoiceForm.tsx src/quickadd.tsx assets/extension-icon.png LICENSE README.md CHANGELOG.md
git commit -m "feat: QuickAdd command with Raycast form, runner and quicklinks"
```

---

### Task 6: End-to-end check with the user

This needs the user at the keyboard: Raycast UI, hotkey assignment, watching Obsidian. The executor drives the steps and asks the user to confirm each result. Every note or line created here is removed in Step 7.

**Files:** none (fix-ups, if needed, go into the files from Task 5 with their own commit).

- [ ] **Step 1: Start development mode**

Run (background): `npm run dev`
Ask the user to open Raycast and search "QuickAdd". Expected: the list shows 23 choices with Capture/Template tags.

- [ ] **Step 2: Background capture**

User: with another app (e.g. Finder) frontmost, run QuickAdd → Thought and type `E2E-THOUGHT a+b & привет`, then ⌘↵.
Expected: HUD "Sent to QuickAdd: Thought"; the other app stays frontmost. Verify:
`grep 'E2E-THOUGHT a+b & привет' "/Users/ievlevpn/main-vault/Quick thoughts.md"` → one line.

- [ ] **Step 3: Template with template-body fields**

User: run Person, File name `E2E-PERSON`, affiliation `ETH`, email `a@b.c`, website `x.org`.
Expected: Obsidian comes forward with the new note, no QuickAdd prompt. Verify:
`grep -l 'a@b.c' "/Users/ievlevpn/main-vault/People/"*E2E-PERSON*`

Then Math idea with Title `E2E-MATH` and Source? `E2E-SRC` → note in `Math ideas/` containing `E2E-SRC`, no prompt.

- [ ] **Step 4: Quicklink with a hotkey**

User: select Thought → ⌘⇧Q → save as "QuickAdd: Thought". In Raycast Settings → Extensions → Quicklinks, assign a hotkey. Press it.
Expected: the Thought form opens directly. Submit `E2E-QUICKLINK`, then check it with `grep` as in Step 2.

- [ ] **Step 5: Obsidian not running**

User: quit Obsidian (⌘Q). Run Thought with `E2E-COLD`.
Expected: Obsidian launches and the line appears in `Quick thoughts.md` (the check may need up to ~15 s). If the capture is lost because QuickAdd wasn't loaded yet, record it and tell the user. It's a QuickAdd/Obsidian limitation to document in the README, not something to work around silently.

- [ ] **Step 6: Choice with Obsidian-side prompts**

User: open Letter.
Expected: the form shows "Some prompts will appear in Obsidian." Then press Esc without submitting.

- [ ] **Step 7: Clean up the vault**

```bash
V="/Users/ievlevpn/main-vault"
sed -i '' '/E2E-/d' "$V/Quick thoughts.md"
for f in "$V/People/"*E2E-PERSON* "$V/Math ideas/"*E2E-MATH*; do [ -e "$f" ] && mv "$f" ~/.Trash/; done
grep -rl 'E2E-' "$V" --include='*.md' || echo clean
```
Expected: `clean`.

- [ ] **Step 8: Record the outcome**

If Step 5 revealed a limitation, add it under README "Limitations" and commit:
```bash
git add README.md
git commit -m "docs: note cold-start behaviour"
```
Stop `npm run dev`. Tell the user the extension stays imported in Raycast; they can keep using it as a development extension.
