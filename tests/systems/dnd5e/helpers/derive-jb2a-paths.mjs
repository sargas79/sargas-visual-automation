/* global console, process, URL */
/**
 * Rebuilds tests/systems/dnd5e/jb2a-paths.json: every JB2A dot path used by rules/dnd5e.json, checked against the
 * real JB2A database. Not a test - run it by hand after editing the rule pack:
 *
 *   python -c "import zipfile;open('jb2a_sequencer.mjs','wb').write(zipfile.ZipFile(r'E:/jb2a/module-0.9.3.zip').read('jb2a_patreon/scripts/jb2a_sequencer.js'))"
 *   node tests/systems/dnd5e/helpers/derive-jb2a-paths.mjs ./jb2a_sequencer.mjs
 *
 * Only the database script is read (never media). Exits 1 and lists unknown paths if any.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dbScript = process.argv[2];
if (!dbScript) {
  console.error("usage: node derive-jb2a-paths.mjs <jb2a_sequencer.mjs>");
  process.exit(2);
}
const { jb2aPatreonDatabase, patreonDatabase } = await import(pathToFileURL(resolve(dbScript)).href);
await jb2aPatreonDatabase("modules");

const known = new Set();
(function walk(node, path) {
  known.add(path);
  if (typeof node !== "object" || Array.isArray(node)) return;
  for (const [k, v] of Object.entries(node)) if (!k.startsWith("_")) walk(v, path ? `${path}.${k}` : `jb2a.${k}`);
})(patreonDatabase, "");

const root = new URL("../../../../", import.meta.url);
const pack = JSON.parse(readFileSync(new URL("rules/dnd5e.json", root), "utf8"));
const used = new Set();
for (const rule of pack.rules) {
  const recipes = [rule.recipe, ...Object.values(rule.recipe.outcomes ?? {})];
  for (const r of recipes) {
    if (r.animation) used.add(r.animation);
    for (const stage of Object.values(r.stages ?? {})) if (stage.animation) used.add(stage.animation);
  }
}
const missing = [...used].filter((p) => !known.has(p));
if (missing.length) {
  console.error(`Unknown JB2A paths:\n${missing.join("\n")}`);
  process.exit(1);
}
const out = { source: "jb2a_patreon 0.9.3 scripts/jb2a_sequencer.js", paths: [...used].sort() };
writeFileSync(new URL("tests/systems/dnd5e/jb2a-paths.json", root), `${JSON.stringify(out, null, 2)}\n`);
console.log(`${used.size} paths OK`);
