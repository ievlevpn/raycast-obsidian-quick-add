#!/bin/sh
# Copy an installed QuickAdd plugin into the e2e fixture vault (plugin code is not committed).
set -eu
src="${1:?usage: scripts/setup-e2e-vault.sh <path to .obsidian/plugins/quickadd of a vault that has QuickAdd>}"
dest="$(cd "$(dirname "$0")/.." && pwd)/e2e-vault/.obsidian/plugins/quickadd"
for f in main.js manifest.json styles.css; do
  if [ -f "$src/$f" ]; then cp "$src/$f" "$dest/$f"; fi
done
echo "QuickAdd copied into $dest"
