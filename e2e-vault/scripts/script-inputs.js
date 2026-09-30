// Declares one-page inputs of every type a QuickAdd 2.27 script can declare; appends the answers to "Script results.md".
const inputs = [
  { id: "count", label: "Count", type: "number", numericConfig: { min: 0, max: 10 } },
  { id: "story", label: "Story", type: "textarea", placeholder: "A few lines" },
  { id: "size", label: "Size (optional)", type: "dropdown", options: ["S", "M", "L"], optional: true },
  { id: "note", label: "Pick a note", type: "file-picker" },
  { id: "status", label: "Status field", type: "field-suggest" },
  { id: "level", label: "Level", type: "slider", sliderConfig: { min: 1, max: 5, step: 1 } },
  { id: "animal", label: "Animal", type: "suggester", options: ["cat", "dog"] },
];

module.exports = async (params) => {
  const { app, variables } = params;
  const answers = Object.fromEntries(inputs.map((input) => [input.id, variables[input.id]]));
  const line = `- ${JSON.stringify(answers)}\n`;
  const file = "Script results.md";
  if (await app.vault.adapter.exists(file)) await app.vault.adapter.append(file, line);
  else await app.vault.create(file, line);
};
module.exports.quickadd = { inputs };
