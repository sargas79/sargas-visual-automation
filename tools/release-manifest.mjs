#!/usr/bin/env node
/**
 * Stamps dist/module.json for a GitHub release.
 *
 *   node tools/release-manifest.mjs v0.1.0
 *
 * Sets `version` from the tag and points `download` at that release's module.zip.
 * `manifest` stays on releases/latest so installed copies keep receiving updates.
 */
import { readFileSync, writeFileSync } from "node:fs";

const tag = process.argv[2];
const match = /^v(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(tag ?? "");
if (!match) {
  console.error(`Expected a tag like v1.2.3, got: ${tag}`);
  process.exit(1);
}

const path = "dist/module.json";
const manifest = JSON.parse(readFileSync(path, "utf8"));
const repo = manifest.url;

manifest.version = match[1];
manifest.manifest = `${repo}/releases/latest/download/module.json`;
manifest.download = `${repo}/releases/download/${tag}/module.zip`;

writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`module.json -> version ${manifest.version}, download ${manifest.download}`);
