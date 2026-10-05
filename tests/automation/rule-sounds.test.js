import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const library = new Set(read("./soundfx-paths.json").paths);
const PREFIX = "modules/soundfxlibrary/";

/** Every `sound` of a recipe: its own and those of its outcome overrides. */
function sounds(recipe) {
  return [recipe.sound, ...Object.values(recipe.outcomes ?? {}).map((o) => o?.sound)].filter(Boolean);
}

describe.each(["pf2e", "dnd5e", "gurps"])("%s rule pack sounds", (system) => {
  const rules = read(`../../rules/${system}.json`).rules;

  it("point at recordings that exist in SoundFx Library", () => {
    const all = rules.flatMap((r) => sounds(r.recipe).map((s) => [r.id, s]));
    expect(all.length).toBeGreaterThan(0);
    for (const [id, s] of all) {
      expect(s.file.startsWith(PREFIX), id).toBe(true);
      expect(library.has(decodeURI(s.file.slice(PREFIX.length))), `${id}: ${s.file}`).toBe(true);
      expect(s.volume, id).toBeGreaterThan(0);
    }
  });

  it("melee weapons hit, crit and miss with different sounds", () => {
    const sword = rules.find((r) => r.id === "group-sword" || r.id === "group-sword-melee").recipe;
    const files = [sword.sound, sword.outcomes.criticalSuccess.sound, sword.outcomes.failure.sound].map((s) => s.file);
    expect(new Set(files).size).toBe(3);
    expect(files[2]).toBe(`${PREFIX}Combat/Single/Melee%20Miss/melee-miss-1.mp3`);
  });
});
