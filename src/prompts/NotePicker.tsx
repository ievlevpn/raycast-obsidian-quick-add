import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useMemo } from "react";
import { listNotes } from "../links";

type Props = { vaultPath: string; onPick: (link: string) => void };

/** Searchable list of the vault's notes, shown when `[[` is typed in a text field. */
export default function NotePicker({ vaultPath, onPick }: Props) {
  const notes = useMemo(() => listNotes(vaultPath), [vaultPath]);
  return (
    <List navigationTitle="Link to Note" searchBarPlaceholder="Search notes">
      {notes.map((note) => (
        <List.Item
          key={note.path}
          title={note.name}
          subtitle={note.folder}
          icon={Icon.Document}
          actions={
            <ActionPanel>
              <Action title="Insert Link" icon={Icon.Link} onAction={() => onPick(note.link)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
