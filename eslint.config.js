const { defineConfig } = require("eslint/config");
const raycastConfig = require("@raycast/eslint-config");

module.exports = defineConfig([{ ignores: ["e2e-vault/**", "demo-vault/**"] }, ...raycastConfig]);
