/**
 * Checks the example macro sources in packs-src/sva-macros: valid compendium documents, SVA API
 * only (no Sequencer / Tagger), and every macro runs against a mocked SVA using only the
 * documented builder methods (docs/architecture.md, docs/api.md).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeEffect } from "../../src/shared/descriptors.js";

const DIR = join(import.meta.dirname, "../../packs-src/sva-macros");
const docs = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((file) => ({ file, doc: JSON.parse(readFileSync(join(DIR, file), "utf8")) }));

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** EffectBuilder setters from the contract. */
const EFFECT_METHODS = new Set(
  (
    "file atLocation stretchTo rotateTowards attachTo scale scaleToObject size rotate mirrorX mirrorY opacity tint " +
    "fadeIn fadeOut scaleIn scaleOut duration playbackRate startTime endTime delay layer zIndex missed returnTrip " +
    "persist name forUsers waitUntilFinished"
  ).split(" ")
);
const LAYERS = new Set(["belowTiles", "belowTokens", "aboveTokens", "aboveLighting", "screen"]);

function token(id, x, y) {
  return { id, name: id, center: { x, y }, document: { width: 1, height: 1 } };
}

/** Runs a macro twice (toggle on, toggle off) for a given target list, returning the effects it built. */
async function runMacro(command, targets) {
  const effects = [];
  const stored = new Set();
  const unknown = [];
  const SVA = {
    ready: true,
    sequence() {
      const own = [];
      const seq = {
        effect() {
          const partial = {};
          own.push(partial);
          effects.push(partial);
          const builder = new Proxy(
            {},
            {
              get(_t, method) {
                return (...args) => {
                  if (!EFFECT_METHODS.has(method)) unknown.push(method);
                  if (method === "file") partial.file = args[0];
                  if (method === "atLocation") partial.atLocation = args[0];
                  if (method === "attachTo") partial.attachTo = { tokenId: args[0] };
                  if (method === "layer") partial.layer = args[0];
                  if (method === "persist") partial.persist = args[0];
                  if (method === "name") partial.name = args[0];
                  return builder;
                };
              }
            }
          );
          return builder;
        },
        wait: () => seq,
        sound: () => seq,
        async play() {
          for (const e of own) if (e.persist && e.name) stored.add(e.name);
        }
      };
      return seq;
    },
    effects: {
      list: ({ name }) => (stored.has(name) ? [{ name }] : []),
      end: async ({ name }) => stored.delete(name)
    },
    db: { has: (path) => typeof path === "string" && path.startsWith("jb2a.") },
    net: { preload: async () => {} }
  };
  const source = token("source", 100, 100);
  const tile = { id: "tile", document: { x: 0, y: 0, width: 300, height: 300, getFlag: () => "spike-trap" } };
  const scope = {
    game: {
      modules: { get: () => ({ api: SVA }) },
      user: { targets: new Set(targets) },
      keyboard: { downKeys: new Set() }
    },
    canvas: {
      scene: { id: "scene", grid: { distance: 5 } },
      grid: { measurePath: ([a, b]) => ({ distance: (Math.hypot(a.x - b.x, a.y - b.y) / 100) * 5 }) },
      tokens: { controlled: [source], placeables: [source, ...targets] },
      tiles: { controlled: [tile], placeables: [tile] }
    },
    ui: {
      notifications: {
        warn: (m) => {
          throw new Error(`warn: ${m}`);
        },
        error: (m) => {
          throw new Error(`error: ${m}`);
        }
      }
    },
    token: source,
    actor: null,
    setTimeout: (fn) => fn()
  };
  const fn = new AsyncFunction(...Object.keys(scope), command);
  await fn(...Object.values(scope));
  await fn(...Object.values(scope));
  return { effects, unknown };
}

describe("example macros compendium", () => {
  it("has the 16 example macros", () => {
    expect(docs).toHaveLength(16);
  });

  it.each(docs)("$file is a valid Macro document", ({ doc }) => {
    expect(doc._id).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(doc._key).toBe(`!macros!${doc._id}`);
    expect(doc.type).toBe("script");
    expect(doc.name).toBeTruthy();
    expect(doc.img).toBeTruthy();
    expect(() => new AsyncFunction("game", "canvas", "ui", "token", "actor", doc.command)).not.toThrow();
  });

  it("uses unique ids and names", () => {
    expect(new Set(docs.map((d) => d.doc._id)).size).toBe(docs.length);
    expect(new Set(docs.map((d) => d.doc.name)).size).toBe(docs.length);
  });

  it.each(docs)("$file uses SVA only (no Sequencer, Tagger or Automated Animations)", ({ doc }) => {
    const code = doc.command.replace(/No Sequencer[^\n]*/g, "");
    expect(code).not.toMatch(/Sequencer|new Sequence\b|Tagger|AutomatedAnimations|autoanimations/);
    expect(code).toContain('game.modules.get("sargas-visual-automation")');
  });

  it.each(docs)("$file runs against the documented API", async ({ doc }) => {
    const near = token("near", 200, 100);
    const far = token("far", 1500, 100);
    for (const targets of [[near], [near, far]]) {
      const { effects, unknown } = await runMacro(doc.command, targets);
      expect(unknown).toEqual([]);
      expect(effects.length).toBeGreaterThan(0);
      for (const effect of effects) {
        expect(() => normalizeEffect(effect)).not.toThrow();
        expect(effect.file).toMatch(/^jb2a\.[a-z0-9_.]+$/);
        if (effect.layer) expect(LAYERS.has(effect.layer)).toBe(true);
      }
    }
  });
});
