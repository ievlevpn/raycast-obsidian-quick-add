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
