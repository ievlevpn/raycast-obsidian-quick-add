// Exercises every QuickAdd API prompt; appends what it got to "Macro results.md".
module.exports = async (params) => {
  const { quickAddApi: qa, app } = params;
  const text = await qa.inputPrompt("Short text", "type something", "hello");
  const long = await qa.wideInputPrompt("Long text");
  const fruit = await qa.suggester(["Apple", "Banana", "Cherry"], ["apple", "banana", "cherry"], "Pick a fruit", true);
  const boxes = await qa.checkboxPrompt(["one", "two", "three"], ["two"]);
  const date = await qa.datePrompt("Pick a date");
  const write = await qa.yesNoPrompt("Write the results?", "Appends a line to Macro results.md");
  await qa.infoDialog("Almost done", ["Line one", "Line two"]);
  if (!write) return;
  const line = `- ${JSON.stringify({ text, long, fruit, boxes, date })}\n`;
  const file = "Macro results.md";
  if (await app.vault.adapter.exists(file)) await app.vault.adapter.append(file, line);
  else await app.vault.create(file, line);
};
