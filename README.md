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

- Templater's own prompts (`tp.system.prompt` and similar) always appear in Obsidian.
- `{{selected}}` and `{{linkcurrent}}` come from Obsidian's active editor, not from Raycast.
- In basic mode, Raycast can't see whether QuickAdd succeeded; errors appear in Obsidian.
