import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { useEffect, useState } from "react";
import { LinkTarget } from "../links";
import { loadLinkTargets, VaultRef } from "../suggestions";
import { Choice } from "../types";

type Props = { choice: Choice; vault: VaultRef; onPick: (note: string | null) => void };

/**
 * Asked before running a choice that uses Obsidian's current note, so the run never depends on whatever
 * happens to be open in Obsidian. "No current note" is offered (and first) when the choice can do without one.
 */
export default function CurrentNotePicker({ choice, vault, onPick }: Props) {
  const [notes, setNotes] = useState<LinkTarget[] | undefined>(undefined);

  useEffect(() => {
    let active = true;
    loadLinkTargets(vault)
      .then((targets) => {
        if (active) setNotes(targets.filter((target) => target.kind === "note"));
      })
      .catch(() => {
        if (active) setNotes([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const optional = choice.currentNote === "optional";
  return (
    <List
      isLoading={notes === undefined}
      navigationTitle={`${choice.title}: Current Note`}
      searchBarPlaceholder={optional ? "Current note (optional)" : "Choose the current note"}
    >
      {optional ? (
        <List.Section title="Current Note">
          <List.Item
            title="No current note"
            subtitle={`${choice.name} won't link to or read from any note`}
            icon={Icon.Circle}
            actions={
              <ActionPanel>
                <Action title="Run Without Current Note" icon={Icon.Play} onAction={() => onPick(null)} />
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}
      <List.Section title="Notes">
        {(notes ?? []).map((note) => (
          <List.Item
            key={note.id}
            title={note.title}
            subtitle={note.subtitle}
            icon={Icon.Document}
            actions={
              <ActionPanel>
                <Action title="Use as Current Note" icon={Icon.Play} onAction={() => onPick(note.id)} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
