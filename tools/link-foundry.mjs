#!/usr/bin/env node
/**
 * Links this repository into a local Foundry VTT data folder for development.
 *
 *   npm run link -- "C:/Users/me/AppData/Local/FoundryVTT/Data"
 *   FOUNDRY_DATA_PATH=... npm run link
 *
 * The repo root is linked (module.json loads src/main.js directly), so edits
 * only need a browser refresh. Use `--dist` to link the built dist/ folder instead.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const useDist = args.includes("--dist");
const dataPath = args.find((a) => !a.startsWith("--")) ?? process.env.FOUNDRY_DATA_PATH;

if (!dataPath) {
  console.error("Usage: npm run link -- <FoundryData path> [--dist]  (or set FOUNDRY_DATA_PATH)");
  process.exit(1);
}

const { id } = JSON.parse(readFileSync("module.json", "utf8"));
const modulesDir = join(resolve(dataPath), "modules");
const target = join(modulesDir, id);
const source = resolve(useDist ? "dist" : ".");

if (!existsSync(modulesDir)) mkdirSync(modulesDir, { recursive: true });
if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false })) {
  console.error(`Already exists: ${target} - remove it first.`);
  process.exit(1);
}

// "junction" works on Windows without admin rights and is ignored elsewhere.
symlinkSync(source, target, "junction");
console.log(`Linked ${target} -> ${source}`);
