// Opens an Obsidian dialog that QuickAdd cannot forward, so the run waits on Obsidian (like a Templater prompt).
module.exports = async ({ app, obsidian }) => {
  await new Promise((resolve) => {
    const modal = new obsidian.Modal(app);
    modal.titleEl.setText("Close me in Obsidian");
    modal.contentEl.setText("QuickAdd is waiting for this dialog, which Raycast cannot show.");
    modal.onClose = () => resolve();
    modal.open();
  });
};
