import { describe, expect, it } from "vitest";
import { CliResult } from "../src/cli";
import { choiceIds, ensureVaultReady, VaultDeps } from "../src/ensureVault";

const list = (...ids: string[]): CliResult => ({
  kind: "json",
  data: { ok: true, choices: ids.map((id) => ({ id })) },
});
const failure = (reason: "cli-disabled" | "not-running"): CliResult => ({ kind: "failure", reason, message: reason });

function deps(open: boolean, responses: CliResult[]) {
  let clock = 0;
  const calls = { open: 0, list: 0 };
  const d: VaultDeps = {
    isOpen: () => open,
    open: async () => {
      calls.open++;
    },
    list: async () => {
      calls.list++;
      return responses[Math.min(calls.list - 1, responses.length - 1)];
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { d, calls };
}

describe("ensureVaultReady", () => {
  it("is ready at once when the vault is open and has the choice", async () => {
    const { d, calls } = deps(true, [list("a", "b")]);
    expect(await ensureVaultReady("b", d)).toEqual({ ok: true });
    expect(calls).toEqual({ open: 0, list: 1 });
  });

  it("opens a closed vault and waits until it answers with the choice", async () => {
    const { d, calls } = deps(false, [list("other"), list("other"), list("b")]);
    expect(await ensureVaultReady("b", d)).toEqual({ ok: true });
    expect(calls).toEqual({ open: 1, list: 3 });
  });

  it("launches Obsidian when it is not running", async () => {
    const { d, calls } = deps(true, [failure("not-running"), list("b")]);
    expect(await ensureVaultReady("b", d)).toEqual({ ok: true });
    expect(calls.open).toBe(1);
  });

  it("fails fast on other CLI failures", async () => {
    const { d } = deps(true, [failure("cli-disabled")]);
    expect(await ensureVaultReady("b", d)).toMatchObject({ ok: false, reason: "cli-disabled" });
  });

  it("fails fast when an open vault does not have the choice", async () => {
    const { d } = deps(true, [list("a")]);
    expect(await ensureVaultReady("b", d)).toMatchObject({ ok: false, reason: "choice-missing" });
  });

  it("times out when a vault it opened never shows the choice", async () => {
    const { d, calls } = deps(false, [list("a")]);
    expect(await ensureVaultReady("b", d, 2000)).toMatchObject({ ok: false, reason: "timeout" });
    expect(calls.list).toBe(5);
  });
});

describe("choiceIds", () => {
  it("includes nested choices", () => {
    expect(choiceIds({ choices: [{ id: "m", choices: [{ id: "c" }] }, { id: "x" }, { name: "no id" }] })).toEqual([
      "m",
      "c",
      "x",
    ]);
  });
});
