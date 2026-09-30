# Obsidian QuickAdd

Run your [QuickAdd](https://github.com/chhoumann/quickadd) choices from Raycast.

- Answer whatever the choice asks — text, forms, pickers, dates, confirmations — in Raycast (full mode, below).
- Captures run with Obsidian in the background; choices set to open their note bring Obsidian forward.
- New and changed choices show up automatically; the extension reads QuickAdd's settings each time it opens.

## Full and basic mode

**Full mode** (recommended) runs choices through QuickAdd's interactive command-line interface. Everything QuickAdd asks — text, one-page forms, suggesters and file pickers, multi-selects, checkboxes, dates, confirmations — is answered in Raycast. It needs:

- Obsidian 1.12 or later, with **Settings → General → Advanced → Command line interface** turned on (restart Obsidian afterwards).
- QuickAdd 2.27 or later.

If any of these is missing, the extension uses **basic mode**: it fills `{{VALUE}}` placeholders from the choice's format, file name and template in a Raycast form and sends them through QuickAdd's `obsidian://quickadd` link. Anything else QuickAdd asks then appears in Obsidian. The choice list says why basic mode is on.

## Requirements

- Obsidian with the QuickAdd plugin. Obsidian is started if it isn't running.

## Setup

The vault is detected automatically when exactly one vault has QuickAdd. Otherwise set **Vault Folder** in the extension preferences, or pick the vault from the list.

## Hotkeys and aliases for single choices

Select a choice, press `⌘⇧Q` (**Create Quicklink**), and save. In Raycast settings, give that quicklink an alias or a hotkey — it opens that choice's form directly. Quicklinks refer to the choice's id, so renaming it in QuickAdd doesn't break them.

## Limitations

- Templater's own prompts (`tp.system.prompt` and similar) and dialogs opened by scripts appear in Obsidian. In full mode Raycast waits for them; after a few seconds it says so and offers **Open Obsidian** (⌘O).
- QuickAdd sends file-picker and field-suggest inputs without a list of options, so they are plain text fields in Raycast.
- `{{selected}}` and `{{linkcurrent}}` come from Obsidian's active editor, not from Raycast.
- In basic mode, Raycast can't see whether QuickAdd succeeded; errors appear in Obsidian.

## Development

```sh
npm install
npm test          # unit tests
npm run dev       # load the extension in Raycast
```

`e2e-vault/` is a small vault with one QuickAdd choice per prompt kind, for trying the extension by hand. Its QuickAdd plugin code is not committed; copy it from a vault that has QuickAdd installed, then open the folder in Obsidian (Open folder as vault) and trust its plugins:

```sh
scripts/setup-e2e-vault.sh /path/to/some-vault/.obsidian/plugins/quickadd
```

After editing the fixture's QuickAdd settings, reload the plugin: `obsidian-cli vault=e2e-vault plugin:reload id=quickadd`. Reset the vault with `git checkout -- e2e-vault && git clean -fd e2e-vault`.
