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
