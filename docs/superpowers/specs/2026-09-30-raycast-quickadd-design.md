# Raycast extension for Obsidian QuickAdd — design

Date: 2026-09-30

## Goal

Run any QuickAdd choice from Raycast. Every input QuickAdd would ask for via a
`{{value…}}` placeholder is typed in a Raycast form; the choice is then executed by
QuickAdd itself. Captures happen without leaving the current app; Templates bring
Obsidian forward with the new note. Individual choices can be bound to Raycast
hotkeys/aliases.

## Constraints

- Standalone: no dependency on the Raycast Obsidian extension. Dependency on the
  QuickAdd Obsidian plugin (tested against 2.27.0) is expected.
- QuickAdd does all formatting/writing — the extension never writes vault files.
- Obsidian must be running or launchable (the `obsidian://` URI starts it).
- Kept Store-publishable: no user-specific defaults, MIT licence, README, CHANGELOG,
  512px icon, `npm run lint` clean. Store submission itself is out of scope for now.

## QuickAdd facts relied on (verified in 2.27.0 `main.js`)

- URI: `obsidian://quickadd?vault=<vault name>&choice=<choice name>&value-<key>=<text>`.
  The choice is selected **by name only** (no id on the URI path).
- Each `value-<key>` sets variable `<key>`; QuickAdd only prompts for variables that
  are not already set, so every passed key (even an empty string) suppresses its prompt.
- Variable key for `{{value:<spec>}}` / `{{VALUE:<spec>}}` = the part of `<spec>`
  before the first `|`, trimmed. Plain `{{value}}` and `{{name}}` use key `value`.
- Choice config lives in `<vault>/.obsidian/plugins/quickadd/data.json` (`choices[]`,
  each with `id`, `name`, `type`; Capture has `format.format`, `captureTo`; Template has
  `templatePath`, `fileNameFormat.format`).

(The vault query-param name — `vault` vs `vaultName` — is confirmed in the first
implementation step against Obsidian's URI handling.)

## Commands

**QuickAdd** (single view command, the only command)

- List of all top-level choices (and nested ones inside `Multi` choices, flattened
  with a "Parent › Child" title), searchable, with a Capture/Template accessory.
  Macro choices are listed but run without fields (they are opaque to us).
- Enter on a choice → form of its fields. A choice with no fields runs immediately.
- Action "Create Quicklink" on each choice → Raycast deeplink
  `raycast://extensions/<author>/<ext>/quickadd?launchContext={"choiceId":"<id>"}`,
  which the user can give an alias/hotkey in Raycast. When launched with a
  `choiceId`, the command resolves it to the current choice (so renames don't break
  it) and opens that form directly.

## Preferences

- `vaultPath` (optional directory). If empty: read
  `~/Library/Application Support/obsidian/obsidian.json`, keep vaults containing
  `.obsidian/plugins/quickadd/data.json`; one → use it; several → show a vault
  picker list first; none → error view.
- Vault name for the URI = basename of the vault path.

## Units

- `src/config.ts` — locate vault, read and validate `data.json`, return `Choice[]`.
- `src/parse.ts` — pure: `(choice, templateBody?) → Field[]`.
- `src/uri.ts` — pure: `(vaultName, choiceName, values) → string`.
- `src/run.ts` — open the URI (`open -g` for Capture, `open` for Template/other), HUD.
- `src/quickadd.tsx` — list, vault picker, launch-context routing.
- `src/ChoiceForm.tsx` — form rendering and submit.

## Placeholder parsing

Sources scanned, in order: Capture → `format.format` (if enabled), `captureTo`;
Template → `fileNameFormat.format` (if enabled), then the template file body.

Field extracted from each `{{value…}}` / `{{name}}` token, de-duplicated by key,
in first-appearance order:

- `key` — as above.
- `label` — `|label:<text>` if present, else the key (`Value` for plain `{{value}}`).
- `options` — if the key part contains commas (`{{value:a,b,c}}`) → dropdown.
- `default` — `|default:<text>`; `optional` — `|optional` flag.

Everything else (date/time tokens, `{{selected}}`, `{{LINKCURRENT}}`, `{{field:}}`,
`{{MACRO:}}`, Templater `<% tp.* %>`) is left to QuickAdd. If the choice contains
Templater `tp.system.prompt`/`suggester`, `{{field:…}}`, or is a Macro, the form
shows a note: "Some prompts will appear in Obsidian."

## Form

- A choice whose only field is plain `{{value}}` gets a multi-line text area;
  otherwise text fields (dropdowns for options). First field focused; ⌘↵ submits.
- Required fields (non-optional) show a validation error when empty; optional empty
  fields are still sent as `""` so QuickAdd does not re-prompt.

## Execution

- Build the URI with every value URL-encoded.
- Capture: `open -g <uri>` so Obsidian stays in the background; close Raycast; HUD
  "Sent to QuickAdd: <choice>". If Obsidian still steals focus (checked in the first
  implementation step), re-activate the previously frontmost app.
- Template and other types: `open <uri>`; Obsidian comes forward.
- HUD wording is "Sent", never "Saved": QuickAdd callbacks are off by default and only
  allow `shortcuts:`/`obsidian:` callbacks, so success is not observable from Raycast.

## Errors

- No vault found / `data.json` missing / invalid JSON → error view with "Open
  Extension Preferences" action.
- Template file missing → run with filename-format fields only; form note says so.
- Quicklink `choiceId` not found → failure toast "Choice no longer exists", then the
  normal list.
- `open` failure → failure toast with stderr.

## Testing

- Vitest unit tests for `parse.ts` and `uri.ts`, fixtures copied from real choices:
  Thought (plain value), Scratch (`|label:`), Person (fields only in template body),
  Math idea (`{{value: Source?}}` leading space), Letter (Templater note), a
  synthetic `{{value:a,b,c}}` and `|default:`/`|optional`.
- Manual check in `npm run dev`: Thought captured in background, Person fields filled
  from Raycast, Scratch opens note, a quicklink with a hotkey opens its form.
- `npm run lint` and `npm run build` pass.

## Out of scope

Store submission, writing files without Obsidian, x-callback success reporting,
Obsidian-side `{{selected}}` substitution from the macOS selection.
