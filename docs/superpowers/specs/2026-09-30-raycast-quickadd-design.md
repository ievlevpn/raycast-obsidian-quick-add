# Raycast extension for Obsidian QuickAdd — design (rev 2)

Date: 2026-09-30. Rev 2 replaces "parse placeholders + URI" as the primary path with
QuickAdd's own interactive CLI; the rev-1 URI path stays as the fallback ("basic mode").
Evidence: `docs/superpowers/notes/2026-09-30-uri-spike.md`, `docs/superpowers/notes/2026-09-30-cli-spike.md`.

## Goal

Run any QuickAdd choice from Raycast and answer **whatever QuickAdd asks** in Raycast —
text inputs, one-page forms, suggesters and file pickers, multi-selects, checkboxes, dates,
confirmations. The extension supports QuickAdd's functionality generically; it is never
tailored to a particular user's choices. Individual choices can be bound to Raycast
hotkeys/aliases.

## Constraints

- Standalone: no dependency on the Raycast Obsidian extension. Depends on the QuickAdd
  Obsidian plugin (tested against 2.27.0) and, for full mode, Obsidian's CLI (Obsidian ≥ 1.12).
- QuickAdd does all formatting/writing; the extension never writes vault files.
- Store-publishable: no user-specific defaults, MIT licence, README, CHANGELOG, 512px icon,
  lint clean (the `author` field needs the real Raycast username before publishing).
- Out of reach in both modes: Templater's own `tp.system.*` modals (they belong to Templater,
  not QuickAdd) and `{{selected}}` / `{{linkcurrent}}` (they read Obsidian's active editor).

## Modes

**Full mode** — the choice runs through `obsidian-cli quickadd:interactive`; every QuickAdd
prompt is forwarded to Raycast and rendered there.

**Basic mode** — the rev-1 path: placeholders parsed from QuickAdd's config and template files,
collected in a Raycast form, sent via `obsidian://quickadd?vault=…&choice=…&value-<key>=…`.
Anything else QuickAdd asks appears in Obsidian.

### Mode detection (every launch, no process spawn in the common case)

1. CLI binary: preference `cliPath` if set, else the first existing of
   `/Applications/Obsidian.app/Contents/MacOS/obsidian-cli`,
   `~/Applications/Obsidian.app/Contents/MacOS/obsidian-cli`. None → basic, reason `no-cli`
   ("Update Obsidian to 1.12 or later for full QuickAdd support").
2. `obsidian.json` top-level `cli !== true` → basic, reason `cli-disabled`
   ("Turn on Settings → General → Advanced → Command line interface, then restart Obsidian").
3. Otherwise full mode. Failures discovered when a run starts (below) fall back to basic for
   that run and show the reason.

In basic mode the choice list shows a top item "Full QuickAdd support is off" with the reason
and a "Check Again" action.

### CLI invocation

`execFile(cli, ["vault=<vaultName>", "quickadd:<cmd>", ...args])`. The CLI **exits 0 even on
failure**, so the result is classified from stdout:

| stdout | meaning | handling |
| --- | --- | --- |
| JSON object (first non-blank char `{`) | QuickAdd response | use it (`ok:false` → QuickAdd error message) |
| contains `not enabled` | CLI disabled | basic mode, reason `cli-disabled` |
| contains `unable to find Obsidian` | app not running | launch (below), retry |
| `Command "quickadd:` … `not found` | QuickAdd missing/too old | basic mode, reason `quickadd-old` ("Update QuickAdd to 2.27 or later") |
| `Vault not found.` | vault not registered | error toast |
| anything else | unknown | error toast with the text |

**Vault safety.** Passing `vault=` for a registered vault that is not open makes Obsidian open
it, and a command sent while it loads can run in another window. So before running a choice:
if the vault's `obsidian.json` entry is not `open: true`, or Obsidian is not running, open it with
`open -g "obsidian://open?vault=<name>"` and poll `quickadd:list` (every 500 ms, up to 20 s)
until the response **contains the target choice id**; only then start the run. The same check
guards every run: the choice id must be in the `quickadd:list` response for that vault.

## Choice list (both modes)

Read from `<vault>/.obsidian/plugins/quickadd/data.json` (works with Obsidian closed): top-level
choices, `Multi` children flattened as "Parent › Child", recent-first (frecency). Actions: primary
"Run" (full) / "Fill in" or "Run" (basic); "Create Quicklink" (`⌘⇧Q`) → deeplink with
`launchContext {vaultPath, choiceId}`; the quicklink opens that choice's run directly.

Vault resolution as rev 1: preference `vaultPath`, else vaults in `obsidian.json` that have
QuickAdd; one → used; several → picker; none → error view with "Open Extension Preferences".

## Full-mode run (`RunSession` view)

1. `quickadd:interactive id=<choiceId>` → `{port, sessionId, token}`.
2. A poll loop runs for the whole session (`GET /poll?session&token`), independent of the UI —
   the server ends the session after 75 s without a poll, and users may take longer to answer.
   `idle` events are ignored; `prompt` events queue; `done`/`error` end the loop.
3. The view renders the first unanswered prompt. Replies go to `POST /reply {requestId, value}`.
4. Leaving the view (Esc / pop / Raycast closed) while the session is live → `POST /abort`.

Prompt → Raycast mapping and reply value:

| QuickAdd prompt | Raycast UI | reply `value` |
| --- | --- | --- |
| `form {fields}` | `Form`, one control per field (table below) | `{ [field.id]: string \| string[] }` |
| `input {header, placeholder, defaultValue, multiline}` | `Form` with `TextField` / `TextArea` | string |
| `suggester {placeholder, items, allowCustomInput}` | `List` of `items[].title`; with custom input, the search text is offered as an extra item "Use “…”" | selected `items[].value` or the custom text |
| `multiselect {items, preselected, allowCustomInput}` | `Form` with `TagPicker` (custom input: extra `TextField`, comma-separated) | string[] of item values (+ custom) |
| `checkbox {header, items}` | `Form` with one `Checkbox` per item | string[] of checked values |
| `date {header, defaultValue, withTime}` | `Form` with `DatePicker` (`DateTime` if `withTime`) | `"@date:<ISO>"` |
| `confirm {header, text}` | `Detail` with "Yes" / "No" actions | boolean |
| `info {header, text[]}` | `Detail` with "Continue" | `true` |
| unknown type | `Detail` explaining the prompt type is unsupported; "Cancel Run" | — (abort) |

Form field types: `text` → `TextField`; `textarea` → `TextArea`; `dropdown` → `Dropdown`
(`options` as values, `displayOptions` as titles); `suggester`/`field-suggest` → `Dropdown` when
`options` are given (plus a "custom value" `TextField` if `suggesterConfig.allowCustomInput`),
else `TextField`; `date` → `DatePicker`, sent as `"@date:<ISO>"`; `number`/`slider` → `TextField`
validated as a number; `checkbox` → `Checkbox` (`"true"`/`"false"`); unknown → `TextField`.
Non-optional fields are required; `defaultValue` pre-fills; `description`/`placeholder` shown.

Finish:
- `done {ok:true, effect, file}` → if the choice's config has `openFile: true` and `file` is set,
  `open "obsidian://open?vault=<name>&file=<file>"` (Obsidian does not come forward by itself);
  HUD: `created` → "Created <file>", `changed` → "Added to <file>", else "Ran <choice>".
- `error` "Execution cancelled by user" → close quietly; other errors → failure toast with
  QuickAdd's message.
- Startup errors mapped per the CLI table; `cli-disabled` / `quickadd-old` → run this choice in
  basic mode instead and show the reason once as a toast.

## Basic-mode run (rev 1, with review fixes)

Unchanged approach (`parse.ts`, `uri.ts`, `ChoiceForm`, `run.ts`), with these generic fixes:
- Token grammar follows QuickAdd: `{{VALUE}}`, `{{NAME}}`, `{{VALUE|mods}}` → key `value`;
  `{{VALUE:spec|mods}}` → key = spec before `|`, trimmed; `|name:x` makes `x` the key; `{{NAME:…}}`
  is not a value token; no newlines inside tokens; keys de-duplicated case-insensitively.
- One malformed choice never breaks the list: per-choice errors become a note on that choice;
  non-string config fields are ignored; a `templatePath` that is not a file counts as missing.
- "Some prompts will appear in Obsidian" also for: empty `captureTo` (not active file), a
  `captureTo` that is an existing folder, `createFileIfItDoesntExist.createWithTemplate`,
  `{{FILE:}}`, `{{MVALUE}}`, `{{TEMPLATE:}}`, `tp.system.multi_suggester`, template folder enabled
  with an empty folder list, option lists with `|custom` / `|multi`.
- Choices with that note run in the foreground (`open`, not `open -g`) so the prompts are seen.
- A lone plain `{{value}}` uses a `TextArea` only when its label is the default; the Template
  "File name" field is a `TextField`.
- HUD stays "Sent to QuickAdd" (success is not observable in basic mode).

## Units

- `src/cli.ts` — find binary, read `obsidian.json` flags, `runCli(args)`, pure `classifyCliOutput(stdout)`.
- `src/mode.ts` — pure `detectMode({cliPath?, obsidianJson}) → {mode, reason?}`.
- `src/session.ts` — `InteractiveSession`: `start()`, poll loop with an `onEvent` callback, `reply()`, `abort()`.
- `src/replies.ts` — pure reply builders (form values → reply object, date → `@date:` string, …).
- `src/RunSession.tsx` + `src/prompts/*.tsx` — prompt views.
- `src/ensureVault.ts` — open-and-wait vault safety check.
- Existing: `config.ts`, `parse.ts`, `uri.ts`, `run.ts`, `ChoiceForm.tsx`, `quickadd.tsx`, `types.ts`.

## Testing

- Vitest: `classifyCliOutput` (every row of the table), `detectMode`, reply builders,
  `InteractiveSession` against an in-process fake HTTP server implementing `/poll`, `/reply`,
  `/abort` with the spike's recorded payloads (prompt → reply → done; idle events; abort; error),
  basic-mode parser/config fixes.
- E2E test vault `e2e-vault/` in the repo: QuickAdd `data.json` + templates with one choice per
  prompt kind (text, one-page form, `{{VALUE:a,b}}` suggester, `{{VDATE}}`, capture to `#tag`,
  multi-select field, macro with a confirm, Template with `openFile`). The QuickAdd plugin files are
  copied from the local install during setup (git-ignored). The user opens the folder as a vault
  once. Manual run-through in `npm run dev` in full mode and, with the CLI switched off, basic mode;
  plus Obsidian-closed and quicklink/hotkey checks.

## Out of scope

Store submission; writing vault files; Templater prompt forwarding; `{{selected}}` from the macOS
selection; driving QuickAdd without Obsidian running.
