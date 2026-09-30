import {
  Action,
  ActionPanel,
  closeMainWindow,
  Detail,
  Icon,
  Keyboard,
  popToRoot,
  PopToRootType,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { createDeeplink } from "@raycast/utils";
import { useEffect, useRef, useState } from "react";
import ChoiceForm from "./ChoiceForm";
import { ensureVaultReady, realVaultDeps } from "./ensureVault";
import { BasicReason, isBasicReason, REASON_TEXT } from "./mode";
import { openUri } from "./open";
import CancelAction from "./prompts/CancelAction";
import FormPrompt from "./prompts/FormPrompt";
import MessagePrompt from "./prompts/MessagePrompt";
import SuggesterPrompt from "./prompts/SuggesterPrompt";
import { messageMarkdown, promptTitle, replyForForm, specsForPrompt, unsupportedMarkdown } from "./replies";
import { runChoice } from "./run";
import { doneMessage, InteractiveSession, PromptEvent, SessionEvent, startSession, withoutPrompt } from "./session";
import { Choice } from "./types";
import { buildOpenUri } from "./uri";

type Phase =
  | { kind: "starting" }
  | { kind: "waiting" }
  | { kind: "failed"; message: string }
  | { kind: "basic"; reason: BasicReason };

type Props = { cli: string; vaultPath: string; vaultName: string; choice: Choice; relaunched?: boolean };

export default function RunSession({ cli, vaultPath, vaultName, choice, relaunched }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [prompts, setPrompts] = useState<PromptEvent[]>([]);
  const session = useRef<InteractiveSession | undefined>(undefined);
  const unmounted = useRef(false);
  const answered = useRef(new Set<string>());
  const [slow, setSlow] = useState(false);

  function fail(reason: string, message: string) {
    void session.current?.abort();
    if (unmounted.current) return;
    if (isBasicReason(reason)) {
      setPhase({ kind: "basic", reason });
      return;
    }
    setPhase({ kind: "failed", message });
    showToast({ style: Toast.Style.Failure, title: "QuickAdd run failed", message });
  }

  async function handle(event: SessionEvent) {
    if (event.kind === "prompt") {
      setPrompts((queue) => [...queue, event]);
      return;
    }
    if (event.kind === "done") {
      if (choice.openFile && event.result.file) {
        try {
          await openUri(buildOpenUri(vaultName, event.result.file));
        } catch (error) {
          await showToast({
            style: Toast.Style.Failure,
            title: `${doneMessage(choice.name, event.result)}, but it couldn't be opened`,
            message: String(error),
          });
          return;
        }
      }
      await showHUD(doneMessage(choice.name, event.result), { popToRootType: PopToRootType.Immediate });
      return;
    }
    if (/cancelled by user/i.test(event.error)) {
      await close();
      return;
    }
    fail("quickadd-error", event.error);
  }

  useEffect(() => {
    (async () => {
      const ready = await ensureVaultReady(choice.id, realVaultDeps(cli, vaultName, vaultPath));
      if (unmounted.current) return;
      if (!ready.ok) return fail(ready.reason, ready.message);
      if (ready.opened && !relaunched) {
        // Opening the vault brought Obsidian forward and hid Raycast. A command can't launchCommand
        // itself, so reopen this choice through its deeplink (as a quicklink would); the vault is open
        // now, so the relaunched run starts right away.
        await openUri(
          createDeeplink({ command: "quickadd", context: { vaultPath, choiceId: choice.id, relaunched: true } }),
        );
        return;
      }
      const started = await startSession(cli, vaultName, choice.id);
      if (!started.ok) return fail(started.reason, started.message);
      session.current = started.session;
      if (unmounted.current) return started.session.abort();
      setPhase({ kind: "waiting" });
      await started.session.pollLoop((event) => {
        if (!unmounted.current) void handle(event);
      });
    })().catch((error) => fail("unknown", String(error)));
    return () => {
      unmounted.current = true;
      void session.current?.abort();
    };
  }, []);

  // After a few seconds with nothing to show, QuickAdd is probably asking something in Obsidian itself.
  useEffect(() => {
    setSlow(false);
    if (phase.kind !== "waiting" || prompts.length > 0) return;
    const timer = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(timer);
  }, [phase.kind, prompts.length]);

  async function answer(event: PromptEvent, value: unknown) {
    if (answered.current.has(event.requestId)) return;
    answered.current.add(event.requestId);
    setPrompts((queue) => withoutPrompt(queue, event.requestId));
    try {
      await session.current?.reply(event.requestId, value);
    } catch (error) {
      fail("quickadd-error", (error as Error).message);
    }
  }

  /** Close Raycast; popToRoot alone leaves an empty window when this view is the root (quicklink). */
  async function close() {
    await closeMainWindow({ clearRootSearch: true });
    await popToRoot();
  }

  async function cancel() {
    await session.current?.abort();
    await close();
  }

  if (phase.kind === "basic") return <BasicFallback vaultName={vaultName} choice={choice} reason={phase.reason} />;
  if (phase.kind === "failed") {
    return <Detail navigationTitle={choice.title} markdown={`# QuickAdd run failed\n\n${phase.message}`} />;
  }

  const current = prompts[0];
  if (!current) {
    return (
      <Detail
        isLoading
        navigationTitle={choice.title}
        markdown={
          phase.kind === "starting"
            ? "Starting QuickAdd…"
            : slow
              ? "Waiting for QuickAdd…\n\nQuickAdd may be asking something in Obsidian itself (for example a Templater prompt). Answer it there, or cancel the run."
              : "Waiting for QuickAdd…"
        }
        actions={
          <ActionPanel>
            {slow ? (
              <Action
                title="Open Obsidian"
                icon={Icon.AppWindow}
                shortcut={Keyboard.Shortcut.Common.Open}
                onAction={() => openUri(buildOpenUri(vaultName))}
              />
            ) : null}
            <CancelAction onCancel={cancel} />
          </ActionPanel>
        }
      />
    );
  }

  const prompt = current.prompt;
  const title = promptTitle(prompt, choice.title);
  if (prompt.type === "suggester") {
    return (
      <SuggesterPrompt
        key={current.requestId}
        title={title}
        prompt={prompt}
        onPick={(value) => answer(current, value)}
        onCancel={cancel}
      />
    );
  }
  if (prompt.type === "confirm" || prompt.type === "info") {
    const choices =
      prompt.type === "confirm"
        ? [
            { title: "Yes", icon: Icon.Checkmark, onAction: () => answer(current, true) },
            { title: "No", icon: Icon.XMarkCircle, onAction: () => answer(current, false) },
          ]
        : [{ title: "Continue", icon: Icon.ArrowRight, onAction: () => answer(current, true) }];
    return (
      <MessagePrompt
        key={current.requestId}
        title={title}
        markdown={messageMarkdown(prompt)}
        choices={choices}
        onCancel={cancel}
      />
    );
  }
  const specs = specsForPrompt(prompt);
  if (specs) {
    return (
      <FormPrompt
        key={current.requestId}
        title={title}
        specs={specs}
        onSubmit={(values) => answer(current, replyForForm(prompt, specs, values))}
        onCancel={cancel}
      />
    );
  }
  return (
    <Detail
      navigationTitle={title}
      markdown={unsupportedMarkdown(prompt.type)}
      actions={
        <ActionPanel>
          <CancelAction onCancel={cancel} />
        </ActionPanel>
      }
    />
  );
}

function BasicFallback({ vaultName, choice, reason }: { vaultName: string; choice: Choice; reason: BasicReason }) {
  useEffect(() => {
    showToast({ style: Toast.Style.Failure, title: "Full QuickAdd support is off", message: REASON_TEXT[reason] });
    if (choice.fields.length === 0) void runChoice(vaultName, choice, []);
  }, []);
  if (choice.fields.length > 0)
    return <ChoiceForm vaultName={vaultName} choice={choice} notice={REASON_TEXT[reason]} />;
  return <Detail isLoading navigationTitle={choice.title} markdown="Sending to QuickAdd…" />;
}
