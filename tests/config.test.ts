import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  OBSIDIAN_PROMPTS_NOTE,
  QUICKADD_DATA,
  findQuickAddVaults,
  loadChoices,
  vaultName,
} from "../src/config";

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function makeVault(choices: unknown[], files: Record<string, string> = {}): string {
  const vault = mkdtempSync(join(tmpdir(), "qa-vault-"));
  write(join(vault, QUICKADD_DATA), JSON.stringify({ choices }));
  for (const [path, content] of Object.entries(files)) write(join(vault, path), content);
  return vault;
}

const capture = (over: object = {}) => ({
  id: "c1",
  name: "Thought",
  type: "Capture",
  captureTo: "Quick thoughts.md",
  captureToActiveFile: false,
  format: { enabled: true, format: "- {{DATE}}, {{time}}: {{value}}" },
  ...over,
});

const template = (over: object = {}) => ({
  id: "t1",
  name: "Math idea",
  type: "Template",
  templatePath: "Templates/math_idea.md",
  fileNameFormat: { enabled: true, format: "{{DATE:YYYY.MM.DD.HH.mm.ss}} {{value:Title}}" },
  folder: { enabled: true, folders: ["Math ideas"], chooseWhenCreatingNote: false, chooseFromSubfolders: false },
  ...over,
});

describe("findQuickAddVaults", () => {
  it("keeps only registered vaults that have QuickAdd", () => {
    const withQa = makeVault([]);
    const withoutQa = mkdtempSync(join(tmpdir(), "qa-plain-"));
    const json = join(mkdtempSync(join(tmpdir(), "qa-obs-")), "obsidian.json");
    write(json, JSON.stringify({ vaults: { a: { path: withQa }, b: { path: withoutQa }, c: { path: "/nonexistent/x" } } }));
    expect(findQuickAddVaults(json)).toEqual([withQa]);
  });

  it("returns [] for a missing or invalid obsidian.json", () => {
    expect(findQuickAddVaults("/nonexistent/obsidian.json")).toEqual([]);
    const json = join(mkdtempSync(join(tmpdir(), "qa-obs-")), "obsidian.json");
    write(json, "{not json");
    expect(findQuickAddVaults(json)).toEqual([]);
  });
});

describe("vaultName", () => {
  it("is the folder name, ignoring a trailing slash", () => {
    expect(vaultName("/Users/x/main-vault/")).toBe("main-vault");
  });
});

describe("loadChoices errors", () => {
  it("throws ConfigError when QuickAdd settings are missing", () => {
    const vault = mkdtempSync(join(tmpdir(), "qa-empty-"));
    expect(() => loadChoices(vault)).toThrow(ConfigError);
    expect(() => loadChoices(vault)).toThrow(/not found/);
  });

  it("throws ConfigError on invalid JSON or a missing choices list", () => {
    const bad = makeVault([]);
    write(join(bad, QUICKADD_DATA), "{oops");
    expect(() => loadChoices(bad)).toThrow(/Could not read/);
    const noChoices = makeVault([]);
    write(join(noChoices, QUICKADD_DATA), JSON.stringify({ macros: [] }));
    expect(() => loadChoices(noChoices)).toThrow(/no choices/);
  });
});

describe("loadChoices captures", () => {
  it("reads a plain capture", () => {
    const [c] = loadChoices(makeVault([capture()]));
    expect(c).toMatchObject({ id: "c1", name: "Thought", title: "Thought", type: "Capture", notes: [] });
    expect(c.fields.map((f) => f.key)).toEqual(["value"]);
  });

  it("asks for the value when the format is disabled", () => {
    const [c] = loadChoices(makeVault([capture({ format: { enabled: false, format: "" } })]));
    expect(c.fields.map((f) => f.key)).toEqual(["value"]);
  });

  it("notes the file picker for #tag and folder targets", () => {
    const [tag] = loadChoices(makeVault([capture({ captureTo: "#projects/quicknotes" })]));
    expect(tag.notes).toContain(OBSIDIAN_PROMPTS_NOTE);
    const [folder] = loadChoices(makeVault([capture({ captureTo: "Inbox/" })]));
    expect(folder.notes).toContain(OBSIDIAN_PROMPTS_NOTE);
  });
});

describe("loadChoices templates", () => {
  it("collects fields from file name and template body", () => {
    const vault = makeVault([template()], { "Templates/math_idea.md": "Date: {{date}}\nSource: {{value: Source?}}\n" });
    const [t] = loadChoices(vault);
    expect(t.fields.map((f) => f.key)).toEqual(["Title", "Source?"]);
    expect(t.notes).toEqual([]);
  });

  it("asks for the file name when the file-name format is disabled (Person)", () => {
    const vault = makeVault(
      [template({ name: "Person", templatePath: "Templates/person_template.md", fileNameFormat: { enabled: false, format: "" } })],
      { "Templates/person_template.md": "{{VALUE:affiliation}} {{VALUE:email}} {{VALUE:website}}" },
    );
    const [t] = loadChoices(vault);
    expect(t.fields.map((f) => [f.key, f.label])).toEqual([
      ["value", "File name"],
      ["affiliation", "affiliation"],
      ["email", "email"],
      ["website", "website"],
    ]);
  });

  it("finds a template path given without .md", () => {
    const vault = makeVault([template({ templatePath: "Templates/math_idea" })], {
      "Templates/math_idea.md": "{{value:Where?}}",
    });
    expect(loadChoices(vault)[0].fields.map((f) => f.key)).toEqual(["Title", "Where?"]);
  });

  it("still works with a missing template file, and says so", () => {
    const [t] = loadChoices(makeVault([template()]));
    expect(t.fields.map((f) => f.key)).toEqual(["Title"]);
    expect(t.notes.join(" ")).toMatch(/Template file not found: Templates\/math_idea\.md/);
  });

  it("notes Templater prompts and folder pickers", () => {
    const templater = makeVault([template()], { "Templates/math_idea.md": "<% tp.system.prompt('x') %>" });
    expect(loadChoices(templater)[0].notes).toContain(OBSIDIAN_PROMPTS_NOTE);
    const picker = makeVault([template({ folder: { enabled: true, folders: ["A", "B"] } })], {
      "Templates/math_idea.md": "",
    });
    expect(loadChoices(picker)[0].notes).toContain(OBSIDIAN_PROMPTS_NOTE);
  });
});

describe("loadChoices structure", () => {
  it("flattens Multi choices and treats unknown types as Obsidian-driven", () => {
    const vault = makeVault([
      { id: "m", name: "Vocab", type: "Multi", choices: [capture({ id: "c2", name: "French" })] },
      { id: "x", name: "Do stuff", type: "Macro" },
      { name: "no id" },
    ]);
    const choices = loadChoices(vault);
    expect(choices.map((c) => [c.id, c.name, c.title])).toEqual([
      ["c2", "French", "Vocab › French"],
      ["x", "Do stuff", "Do stuff"],
    ]);
    expect(choices[1].fields).toEqual([]);
    expect(choices[1].notes).toContain(OBSIDIAN_PROMPTS_NOTE);
  });

  it("warns on duplicate names", () => {
    const choices = loadChoices(makeVault([capture({ id: "a" }), capture({ id: "b" })]));
    for (const c of choices) expect(c.notes.join(" ")).toMatch(/Another choice is also named "Thought"/);
  });
});
