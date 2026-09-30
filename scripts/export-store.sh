#!/bin/sh
# Copy only what the Raycast Store needs into a separate folder, then run `npm run publish` there.
# The e2e vault, design docs and tests stay in this repo.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${1:?usage: scripts/export-store.sh <destination folder>}"
mkdir -p "$dest"
rm -rf "$dest/src" "$dest/assets" "$dest/metadata"
for item in src assets package.json package-lock.json CHANGELOG.md tsconfig.json eslint.config.js .prettierrc .gitignore; do
  cp -R "$root/$item" "$dest/"
done
if [ -d "$root/metadata" ]; then cp -R "$root/metadata" "$dest/"; fi
cp "$root/store/README.md" "$dest/README.md"
# Raycast's default lint config (this repo's version also ignores the e2e vault, which isn't exported).
cat > "$dest/eslint.config.js" <<'CONFIG'
const { defineConfig } = require("eslint/config");
const raycastConfig = require("@raycast/eslint-config");

module.exports = defineConfig([...raycastConfig]);
CONFIG
echo "Exported to $dest"
