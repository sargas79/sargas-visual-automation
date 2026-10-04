import { describe, expect, it } from "vitest";
import { findRule, matchRule, orderRules } from "../../src/automation/matcher.js";
import { bootAutomation, flagged } from "./helpers/setup.js";
import { fakeItem } from "./helpers/dummy-adapter.js";

const recipe = (animation, preset = "ranged") => ({ version: 1, preset, animation });
const descriptors = {
  name: "Fire Bolt",
  key: "fire-bolt",
  type: "spell",
  traits: ["fire", "cantrip", "attack"],
  attackKind: "ranged",
  weaponGroup: null,
  damageTypes: ["fire"],
  isHealing: false
};

describe("matchRule", () => {
  const m = (match) => matchRule({ match }, descriptors);

  it("matches each criterion", () => {
    expect(m({ key: "fire-bolt" }).matched).toBe(true);
    expect(m({ key: ["x", "FIRE-BOLT"] }).matched).toBe(true);
    expect(m({ name: "fire bolt" }).matched).toBe(true);
    expect(m({ regex: "^fire" }).matched).toBe(true);
    expect(m({ regex: { pattern: "^fire", flags: "" } }).matched).toBe(false);
    expect(m({ type: "spell" }).matched).toBe(true);
    expect(m({ traits: ["fire", "cantrip"] }).matched).toBe(true);
    expect(m({ traits: ["fire", "cold"] }).matched).toBe(false);
    expect(m({ attackKind: "ranged" }).matched).toBe(true);
    expect(m({ weaponGroup: "bow" }).matched).toBe(false);
  });

  it("matches the base item of every variant", () => {
    const d = { name: "+1 Striking Longsword", key: "holy-avenger", type: "weapon", baseItem: "longsword" };
    expect(matchRule({ match: { baseItem: "LONGSWORD" } }, d).matched).toBe(true);
    expect(matchRule({ match: { baseItem: ["dagger", "longsword"] } }, d).matched).toBe(true);
    expect(matchRule({ match: { baseItem: "dagger" } }, d).matched).toBe(false);
    expect(matchRule({ match: { baseItem: "longsword" } }, { ...d, baseItem: null }).matched).toBe(false);
  });

  it("requires every criterion and never matches an empty rule", () => {
    expect(m({ type: "spell", attackKind: "melee" }).matched).toBe(false);
    expect(m({}).matched).toBe(false);
  });

  it("explains why", () => {
    expect(m({ traits: ["cold"] }).reasons[0]).toMatch(/missing traits cold/);
    expect(m({ key: "fire-bolt" }).reasons[0]).toMatch(/matches/);
  });
});

describe("rule ordering", () => {
  it("sorts by priority, then specificity, then order; skips disabled", () => {
    const rules = [
      { id: "type", priority: 0, match: { type: "spell" } },
      { id: "key", priority: 0, match: { key: "fire-bolt" } },
      { id: "high", priority: 10, match: { traits: ["fire"] } },
      { id: "off", priority: 99, enabled: false, match: { key: "fire-bolt" } }
    ];
    expect(orderRules(rules).map((r) => r.id)).toEqual(["high", "key", "type"]);
    expect(findRule(rules, descriptors).winner.rule.id).toBe("high");
  });

  it("matches actorTraits (all required) against the creature's traits", () => {
    const d = { ...descriptors, actorTraits: ["dragon", "size:large"] };
    expect(matchRule({ match: { actorTraits: "DRAGON" } }, d).matched).toBe(true);
    expect(matchRule({ match: { actorTraits: ["dragon", "size:large"] } }, d).matched).toBe(true);
    const miss = matchRule({ match: { actorTraits: ["dragon", "undead"] } }, d);
    expect(miss.matched).toBe(false);
    expect(miss.reasons[0]).toContain("missing actor traits undead");
    expect(matchRule({ match: { actorTraits: "dragon" } }, descriptors).matched).toBe(false);
  });

  it("ranks baseItem between name and regex", () => {
    const rules = [
      { id: "group", match: { weaponGroup: "sword" } },
      { id: "regex", match: { regex: "sword" } },
      { id: "base", match: { baseItem: "longsword" } },
      { id: "name", match: { name: "Longsword" } }
    ];
    expect(orderRules(rules).map((r) => r.id)).toEqual(["name", "base", "regex", "group"]);
  });
});

describe("resolution priority", () => {
  function setup(itemFlags = {}) {
    const item = fakeItem({ name: "Fire Bolt", flags: itemFlags, sva: descriptors });
    const ctx = bootAutomation({ items: [item] });
    return { ...ctx, item };
  }

  const worldRule = { id: "w1", match: { key: "fire-bolt" }, recipe: recipe("jb2a.fire_bolt.blue") };
  const systemRule = { id: "s1", match: { key: "fire-bolt" }, recipe: recipe("jb2a.fire_bolt.dark_red") };

  it("level 4: generic fallback from descriptors", () => {
    const { api, item } = setup();
    const r = api.automation.resolveRecipe(item, { eventType: "attack" });
    expect(r).toMatchObject({ source: "fallback", recipe: { preset: "ranged", animation: "jb2a.fire_bolt.orange" } });
  });

  it("level 3: system rule pack beats the fallback", () => {
    const { api, item } = setup();
    api.automation.rules.setSystemRules(
      [systemRule].map((r) => ({ ...r, enabled: true, priority: 0 })),
      "dummy"
    );
    const r = api.automation.resolveRecipe(item);
    expect(r).toMatchObject({ source: "system", ruleId: "s1", recipe: { animation: "jb2a.fire_bolt.dark_red" } });
  });

  it("level 2: world rules beat the system pack, and shadow same-id system rules", async () => {
    const { api, item } = setup();
    api.automation.rules.setSystemRules([{ ...systemRule, enabled: true, priority: 100 }], "dummy");
    await api.automation.rules.save(worldRule);
    expect(api.automation.resolveRecipe(item)).toMatchObject({ source: "world", ruleId: "w1" });
    await api.automation.rules.save({ ...systemRule, enabled: false });
    await api.automation.rules.delete("w1");
    expect(api.automation.resolveRecipe(item, { eventType: "attack" })).toMatchObject({ source: "fallback" });
  });

  it("level 1: the item flag beats everything", async () => {
    const { api, item } = setup(flagged({ recipe: recipe("jb2a.magic_missile.purple") }));
    await api.automation.rules.save(worldRule);
    expect(api.automation.resolveRecipe(item)).toMatchObject({
      source: "item",
      recipe: { animation: "jb2a.magic_missile.purple" }
    });
  });

  it("the disabled flag turns everything off", () => {
    const { api, item } = setup(flagged({ disabled: true, recipe: recipe("jb2a.magic_missile.purple") }));
    expect(api.automation.resolveRecipe(item)).toBeNull();
    expect(api.automation.explain(item)).toMatchObject({ disabled: true, result: null });
  });

  it("returns null when the recipe does not trigger on the event type", () => {
    const { api, item } = setup();
    expect(api.automation.resolveRecipe(item, { eventType: "cast" })).toBeNull();
    const trace = api.automation.explain(item, { eventType: "damage" });
    expect(trace.result).toBeNull(); // fallback has nothing for damage events
  });

  it("explain lists every candidate with reasons", async () => {
    const { api, item } = setup();
    await api.automation.rules.save({
      id: "cold",
      match: { traits: ["cold"] },
      recipe: recipe("jb2a.ray_of_frost.blue")
    });
    await api.automation.rules.save(worldRule);
    const trace = api.automation.explain(item, { eventType: "attack" });
    expect(trace.result).toMatchObject({ source: "world", ruleId: "w1", triggered: true });
    expect(trace.candidates.map((c) => [c.ruleId, c.matched])).toEqual([
      ["w1", true],
      ["cold", false]
    ]);
    expect(trace.reasons.join(" ")).toMatch(/world rule "w1"/);
  });

  it("an invalid item recipe falls through to the next level", () => {
    const { api, item } = setup(flagged({ recipe: { preset: "nope" } }));
    const trace = api.automation.explain(item, { eventType: "attack" });
    expect(trace.result.source).toBe("fallback");
    expect(trace.reasons[0]).toMatch(/invalid/);
  });
});
