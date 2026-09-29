import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";

const foundryGlobals = Object.fromEntries(
  [
    "game",
    "Hooks",
    "foundry",
    "canvas",
    "ui",
    "CONFIG",
    "CONST",
    "PIXI",
    "ChatMessage",
    "Actor",
    "Item",
    "Token",
    "TokenDocument",
    "Macro",
    "Scene"
  ].map((name) => [name, "readonly"])
);

export default [
  { ignores: ["dist/", "node_modules/", "coverage/"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: { globals: { ...globals.browser, ...foundryGlobals } }
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: { globals: { ...globals.node, ...foundryGlobals } }
  },
  {
    files: ["*.js", "tools/**/*.mjs"],
    languageOptions: { globals: globals.node }
  },
  {
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }]
    }
  },
  prettier
];
