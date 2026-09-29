#!/usr/bin/env node
/**
 * Compiles the compendium sources in packs-src/<pack>/ (one JSON document per file)
 * into Foundry v14 LevelDB packs in packs/<pack>/.
 *
 *   npm run build:packs
 *
 * packs/ is generated (gitignored); `npm run build` runs this first and vite copies
 * packs/ into dist/. To edit a macro, change its JSON in packs-src and rebuild.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { compilePack } from "@foundryvtt/foundryvtt-cli";

const SRC = resolve("packs-src");
const OUT = resolve("packs");

if (!existsSync(SRC)) {
  console.log("No packs-src/ folder, nothing to compile.");
  process.exit(0);
}

const packs = readdirSync(SRC).filter((name) => statSync(join(SRC, name)).isDirectory());
for (const pack of packs) {
  const dest = join(OUT, pack);
  // Start from an empty database so deleted sources don't linger in the pack.
  rmSync(dest, { recursive: true, force: true });
  await compilePack(join(SRC, pack), dest, { log: false });
  const count = readdirSync(join(SRC, pack)).filter((f) => f.endsWith(".json")).length;
  console.log(`Compiled ${pack}: ${count} document(s) -> packs/${pack}`);
}
