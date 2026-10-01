import {
  Action,
  ActionPanel,
  closeMainWindow,
  Detail,
  Form,
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
import BlockedView from "./BlockedView";
import ChoiceForm from "./ChoiceForm";
import { closeTempTab, openTempTab, realTabDeps, TempTab } from "./currentNote";
import { ensureVaultReady, realVaultDeps } from "./ensureVault";
import { BasicReason, isBasicReason, REASON_TEXT } from "./mode";
import { openUri } from "./open";
import CancelAction from "./prompts/CancelAction";
import CurrentNotePicker from "./prompts/CurrentNotePicker";
import FormPrompt from "./prompts/FormPrompt";
import MessagePrompt from "./prompts/MessagePrompt";
import SuggesterPrompt from "./prompts/SuggesterPrompt";
import { messageMarkdown, promptTitle, replyForForm, specsForPrompt, unsupportedMarkdown } from "./replies";
import { runChoice } from "./run";
import { doneMessage, InteractiveSession, PromptEvent, SessionEvent, startSession, withoutPrompt } from "./session";
import { Choice } from "./types";
import { basicRunBlocked, buildOpenUri } from "./uri";

type Phase =
  | { kind: "starting" }
  | { kind: "waiting" }
  | { kind: "failed"; message: string }
  | { kind: "basic"; reason: BasicReason };

type Props = {
  cli: string;
  vaultPath: string;
  vaultName: string;
  choice: Choice;
  relaunched?: boolean;
  /** For choices that use Obsidian's current note: a vault path, or null for "no current note". */
  currentNote?: string | null;
};

/** Asks for the current note first when the choice uses one, then runs it. */
export function RunChoice({ initialCurrentNote, ...props }: Props & { initialCurrentNote?: string | null }) {
  const [currentNote, setCurrentNote] = useState<string | null | undefined>(initialCurrentNote);
  if (props.choice.currentNote === "none") return <RunSession {...props} />;
  if (currentNote === undefined) {
    const vault = { vaultPath: props.vaultPath, vaultName: props.vaultName, cli: props.cli };
    return <CurrentNotePicker choice={props.choice} vault={vault} onPick={setCurrentNote} />;
  }
  return <RunSession {...props} currentNote={currentNote} />;
}

export default function RunSession({ cli, vaultPath, vaultName, choice, relaunched, currentNote }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [prompts, setPrompts] = useState<PromptEvent[]>([]);
  const session = useRef<InteractiveSession | undefined>(undefined);
  const unmounted = useRef(false);
  const answered = useRef(new Set<string>());
  const cancelled = useRef(false);
  const tempTab = useRef<TempTab | undefined>(undefined);

  /** Close the temporary current-note tab, if it's still ours and untouched (at most once). */
  async function releaseTab() {
    const tab = tempTab.current;
    tempTab.current = undefined;
    if (tab) await closeTempTab(realTabDeps(cli, vaultName), tab).catch(() => "kept");
  }
  const [slow, setSlow] = useState(false);

  function fail(reason: string, message: string) {
    void session.current?.abort();
    void releaseTab();
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
    await releaseTab();
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
          await close();
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
    // Per-run flag: Raycast's dev mode mounts views twice (mount → unmount → mount), so the first run
    // must stop on its own while the second carries on. The shared ref only serves the handlers.
    let active = true;
    unmounted.current = false;
    const stopped = () => !active || cancelled.current;
    (async () => {
      const ready = await ensureVaultReady(choice.id, vaultPath, realVaultDeps(cli, vaultName));
      if (stopped()) return;
      if (!ready.ok) return fail(ready.reason, ready.message);
      if (ready.opened && !relaunched) {
        // Opening the vault brought Obsidian forward and hid Raycast. A command can't launchCommand
        // itself, so reopen this choice through its deeplink (as a quicklink would); the vault is open
        // now, so the relaunched run starts right away.
        await openUri(
          createDeeplink({
            command: "quickadd",
            context: {
              vaultPath,
              choiceId: choice.id,
              relaunched: true,
              currentNote: currentNote === undefined ? undefined : (currentNote ?? ""),
            },
          }),
        );
        return;
      }
      if (currentNote !== undefined) {
        // QuickAdd takes the current note from Obsidian's active tab: make that the chosen note, or nothing.
        tempTab.current = await openTempTab(realTabDeps(cli, vaultName), currentNote);
        if (stopped()) return releaseTab();
      }
      const started = await startSession(cli, vaultName, choice.id);
      if (stopped()) {
        if (started.ok) await started.session.abort();
        return releaseTab();
      }
      if (!started.ok) return fail(started.reason, started.message);
      session.current = started.session;
      setPhase({ kind: "waiting" });
      await started.session.pollLoop((event) => {
        if (active) void handle(event);
      });
    })().catch((error) => {
      if (active) fail("unknown", String(error));
    });
    return () => {
      active = false;
      unmounted.current = true;
      void session.current?.abort();
      void releaseTab();
    };
  }, []);

  // After a few seconds with nothing to show, say why: still starting (Obsidian or the vault may be opening),
  // or QuickAdd is probably asking something in Obsidian itself.
  useEffect(() => {
    setSlow(false);
    if ((phase.kind !== "starting" && phase.kind !== "waiting") || prompts.length > 0) return;
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
    cancelled.current = true;
    await session.current?.abort();
    await close();
  }

  if (phase.kind === "basic")
    return <BasicFallback vaultName={vaultName} vaultPath={vaultPath} choice={choice} reason={phase.reason} />;
  if (phase.kind === "failed") {
    return <Detail navigationTitle={choice.title} markdown={`# QuickAdd run failed\n\n${phase.message}`} />;
  }

  const current = prompts[0];
  if (!current) {
    // An empty, loading form rather than a text page: most prompts are forms, so the first one appears
    // in place instead of flashing a different layout.
    return (
      <Form
        isLoading
        navigationTitle={choice.title}
        actions={
          <ActionPanel>
            {slow && phase.kind === "waiting" ? (
              <Action
                title="Open Obsidian"
                icon={Icon.AppWindow}
                shortcut={Keyboard.Shortcut.Common.Open}
                onAction={() =>
                  openUri(buildOpenUri(vaultName)).catch((error) =>
                    showToast({ style: Toast.Style.Failure, title: "Could not open Obsidian", message: String(error) }),
                  )
                }
              />
            ) : null}
            <CancelAction onCancel={cancel} />
          </ActionPanel>
        }
      >
        {slow && phase.kind === "starting" ? (
          <Form.Description
            title="Starting"
            text="Starting QuickAdd in Obsidian… This can take a few seconds if Obsidian or the vault has to open first."
          />
        ) : null}
        {slow && phase.kind === "waiting" ? (
          <Form.Description
            title="Waiting"
            text="QuickAdd may be asking something in Obsidian itself (for example a Templater prompt). Answer it there, or cancel the run."
          />
        ) : null}
      </Form>
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
        vault={{ vaultPath, vaultName, cli }}
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

function BasicFallback({
  vaultName,
  vaultPath,
  choice,
  reason,
}: {
  vaultName: string;
  vaultPath: string;
  choice: Choice;
  reason: BasicReason;
}) {
  useEffect(() => {
    showToast({ style: Toast.Style.Failure, title: "Full QuickAdd support is off", message: REASON_TEXT[reason] });
    if (choice.fields.length === 0 && !basicRunBlocked(choice)) void runChoice(vaultName, choice, []);
  }, []);
  const blocked = basicRunBlocked(choice);
  if (blocked) return <BlockedView choice={choice} reason={blocked} />;
  if (choice.fields.length > 0)
    return (
      <ChoiceForm vaultName={vaultName} vault={{ vaultPath, vaultName }} choice={choice} notice={REASON_TEXT[reason]} />
    );
  return <Detail isLoading navigationTitle={choice.title} markdown="Sending to QuickAdd…" />;
}
