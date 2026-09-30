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
                  title="Fill in"
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
