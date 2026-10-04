import { describe, expect, it, vi } from "vitest";
import { MODULE_ID } from "../../src/constants.js";
import { fallbackAnimations, fallbackRecipe } from "../../src/automation/fallback.js";
import { fakeItem } from "./helpers/dummy-adapter.js";
import { bootAutomation, flagged } from "./helpers/setup.js";

const sword = () =>
  fakeItem({
    name: "Longsword",
    uuid: "Item.sword",
    sva: { key: "longsword", type: "weapon", attackKind: "melee", weaponGroup: "sword", damageTypes: ["slashing"] }
  });

const attack = (extra = {}) => ({
  type: "attack",
  source: { tokenId: "src", actorId: "a1" },
  targets: [{ tokenId: "t1", outcome: "success" }],
  outcome: "success",
  itemUuid: "Item.sword",
  userId: "user1",
  sceneId: "scene1",
  ...extra
});

describe("handle()", () => {
  it("drives the core end-to-end from an adapter event", async () => {
    const { api, adapter } = bootAutomation({ items: [sword()] });
    await adapter.fire(attack());
    expect(api.playSequence).toHaveBeenCalledTimes(1);
    const [seq] = api.playSequence.mock.calls[0];
    expect(seq.steps[0].effect).toMatchObject({
      file: "jb2a.sword.melee.01.white",
      atLocation: { tokenId: "src" },
      stretchTo: { tokenId: "t1" }
    });
    expect(seq).toMatchObject({ sceneId: "scene1", userId: "user1" });
  });

  it("only runs on the client of the user who triggered it", async () => {
    const { api } = bootAutomation({ items: [sword()] });
    expect(await api.automation.handle(attack({ userId: "someoneElse" }))).toBe(false);
    expect(api.playSequence).not.toHaveBeenCalled();
  });

  it("drops duplicate events", async () => {
    const { api } = bootAutomation({ items: [sword()] });
    expect(await api.automation.handle(attack())).toBe(true);
    expect(await api.automation.handle(attack())).toBe(false);
    expect(await api.automation.handle(attack({ outcome: "failure" }))).toBe(true);
    expect(api.playSequence).toHaveBeenCalledTimes(2);
  });

  it("dedupes by event id regardless of timing, and lets distinct ids through", async () => {
    vi.useFakeTimers();
    try {
      const { api } = bootAutomation({ items: [sword()] });
      // Two genuine strikes in quick succession (different chat messages) both play.
      expect(await api.automation.handle(attack({ id: "msg1:attack" }))).toBe(true);
      expect(await api.automation.handle(attack({ id: "msg2:attack" }))).toBe(true);
      // The same message never plays twice, even long after the time window.
      vi.advanceTimersByTime(60_000);
      expect(await api.automation.handle(attack({ id: "msg1:attack" }))).toBe(false);
      expect(api.playSequence).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the time window for events without an id", async () => {
    vi.useFakeTimers();
    try {
      const { api } = bootAutomation({ items: [sword()] });
      expect(await api.automation.handle(attack())).toBe(true);
      expect(await api.automation.handle(attack())).toBe(false);
      vi.advanceTimersByTime(1500);
      expect(await api.automation.handle(attack())).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("respects the automationEnabled setting", async () => {
    const { api } = bootAutomation({ items: [sword()] });
    await game.settings.set(MODULE_ID, "automationEnabled", false);
    expect(await api.automation.handle(attack())).toBe(false);
  });

  it("ignores invalid events and unknown items", async () => {
    const { api } = bootAutomation({ items: [] });
    expect(await api.automation.handle({ type: "explode" })).toBe(false);
    expect(await api.automation.handle(attack())).toBe(false);
  });

  it("uses event descriptors when the item cannot be loaded", async () => {
    const { api } = bootAutomation({ items: [] });
    const ok = await api.automation.handle(
      attack({ itemUuid: null, descriptors: { name: "Bolt", attackKind: "ranged", damageTypes: ["cold"] } })
    );
    expect(ok).toBe(true);
    expect(api.playSequence.mock.calls[0][0].steps[0].effect.file).toBe("jb2a.ray_of_frost.blue");
  });

  it("plays nothing for an actor whose animations are turned off, and drops its tokens from targets", async () => {
    const { api } = bootAutomation({ items: [sword()] });
    const off = { id: "a1", flags: flagged({ disabled: true }), setFlag: vi.fn(), unsetFlag: vi.fn() };
    const on = { id: "a2", flags: {} };
    globalThis.game.actors = new Map([
      ["a1", off],
      ["a2", on]
    ]);
    globalThis.canvas = {
      tokens: { get: (id) => ({ src: { actor: off }, t1: { actor: off }, t2: { actor: on } })[id] }
    };
    expect(api.automation.isActorDisabled(off)).toBe(true);
    expect(api.automation.isActorDisabled(on)).toBe(false);
    // The disabled actor attacks: nothing plays.
    expect(await api.automation.handle(attack())).toBe(false);
    expect(api.playSequence).not.toHaveBeenCalled();
    // Another actor attacks the disabled one and a third token: only the third token gets the animation.
    const ev = attack({ source: { tokenId: "t2", actorId: "a2" }, targets: [{ tokenId: "t1" }, { tokenId: "t2" }] });
    expect(await api.automation.handle(ev)).toBe(true);
    const steps = api.playSequence.mock.calls[0][0].steps.filter((s) => s.type === "effect");
    expect(steps.some((s) => s.effect.stretchTo?.tokenId === "t1" || s.effect.atLocation?.tokenId === "t1")).toBe(
      false
    );
    // The API writes the actor flag.
    await api.automation.setActorDisabled(off, false);
    expect(off.unsetFlag).toHaveBeenCalledWith("sargas-visual-automation", "disabled");
    await api.automation.setActorDisabled(off, true);
    expect(off.setFlag).toHaveBeenCalledWith("sargas-visual-automation", "disabled", true);
    delete globalThis.canvas;
  });

  it("skips items whose recipe does not trigger on the event", async () => {
    const { api } = bootAutomation({ items: [sword()] });
    expect(await api.automation.handle(attack({ type: "damage" }))).toBe(false);
  });

  it("starts auras once and ends them on effectRemoved", async () => {
    const stored = [];
    const effects = {
      list: vi.fn(({ name }) => stored.filter((e) => e.name === name)),
      end: vi.fn(async () => stored.splice(0))
    };
    const aura = fakeItem({
      name: "Effect: Aura",
      uuid: "Item.aura",
      flags: flagged({ recipe: { version: 1, preset: "aura", animation: "jb2a.energy_field.01.blue" } }),
      sva: { key: "aura-effect", type: "effect" }
    });
    const { api } = bootAutomation({ items: [aura], effects });
    const ev = { type: "effectApplied", source: { tokenId: "src", actorId: "a1" }, itemUuid: "Item.aura" };
    expect(await api.automation.handle(ev)).toBe(true);
    const effect = api.playSequence.mock.calls[0][0].steps[0].effect;
    expect(effect).toMatchObject({ persist: true, name: "aura:a1:aura-effect" });
    stored.push(effect);
    expect(await api.automation.handle({ ...ev, effectUuid: "again" })).toBe(false);
    expect(await api.automation.handle({ ...ev, type: "effectRemoved" })).toBe(true);
    expect(effects.end).toHaveBeenCalledWith({ name: "aura:a1:aura-effect" });
  });
  it("ends an aura that is only playing locally (not stored yet, or no GM to store it)", async () => {
    const effects = { list: vi.fn(() => []), end: vi.fn(async () => {}) };
    const aura = fakeItem({
      name: "Effect: Aura",
      uuid: "Item.aura",
      flags: flagged({ recipe: { version: 1, preset: "aura", animation: "jb2a.energy_field.01.blue" } }),
      sva: { key: "aura-effect", type: "effect" }
    });
    const { api } = bootAutomation({ items: [aura], effects });
    const ev = { type: "effectRemoved", source: { tokenId: "src", actorId: "a1" }, itemUuid: "Item.aura" };
    expect(await api.automation.handle(ev)).toBe(false);
    api.engine = { active: () => [{ id: "e1", descriptor: { name: "aura:a1:aura-effect" } }] };
    expect(await api.automation.handle({ ...ev, effectUuid: "x" })).toBe(true);
    expect(effects.end).toHaveBeenCalledWith({ name: "aura:a1:aura-effect" });
  });
});

describe("preview()", () => {
  it("plays locally and strips persistence", async () => {
    const { api } = bootAutomation();
    await api.automation.preview(
      { version: 1, preset: "aura", animation: "jb2a.energy_field.01.blue" },
      { sourceToken: { id: "src", actor: { id: "a1" } }, targetTokens: [] }
    );
    const [seq, opts] = api.playSequence.mock.calls[0];
    expect(opts).toEqual({ broadcast: false });
    expect(seq.steps[0].effect.persist).toBeUndefined();
    expect(seq.steps[0].effect.attachTo).toEqual({ tokenId: "src" });
  });

  it("accepts token documents and ids for targets", async () => {
    const { api } = bootAutomation();
    await api.automation.preview(
      { version: 1, preset: "ranged", animation: "jb2a.fire_bolt.orange" },
      { sourceToken: "src", targetTokens: [{ document: { id: "t1" } }, "t2"] }
    );
    const targets = api.playSequence.mock.calls[0][0].steps.map((s) => s.effect.stretchTo.tokenId).sort();
    expect(targets).toEqual(["t1", "t2"]);
  });
});

describe("item flags", () => {
  it("gets, sets, replaces and clears the item recipe and disabled flag", async () => {
    const { api } = bootAutomation();
    const item = sword();
    expect(api.automation.getItemRecipe(item)).toBeNull();
    await api.automation.setItemRecipe(item, {
      preset: "melee",
      animation: "jb2a.sword.melee.fire.orange",
      stages: { impact: { animation: "jb2a.impact.fire.01.orange" } }
    });
    expect(api.automation.getItemRecipe(item)).toMatchObject({ version: 1, preset: "melee" });
    await api.automation.setItemRecipe(item, { version: 1, preset: "melee", animation: "jb2a.sword.melee.01.white" });
    expect(item.flags[MODULE_ID].recipe.stages).toBeUndefined();
    await expect(api.automation.setItemRecipe(item, { preset: "bad" })).rejects.toThrow();
    await api.automation.setItemRecipe(item, null);
    expect(api.automation.getItemRecipe(item)).toBeNull();
    await api.automation.setItemDisabled(item, true);
    expect(api.automation.isItemDisabled(item)).toBe(true);
    await api.automation.setItemDisabled(item, false);
    expect(api.automation.isItemDisabled(item)).toBe(false);
  });
});

describe("world rules CRUD", () => {
  const rule = {
    id: "r1",
    label: "Swords",
    match: { weaponGroup: "sword" },
    recipe: { version: 1, preset: "melee", animation: "jb2a.sword.melee.fire.orange" }
  };

  it("saves, lists, updates and deletes", async () => {
    const { api } = bootAutomation();
    const saved = await api.automation.rules.save(rule);
    expect(saved).toMatchObject({ id: "r1", enabled: true, priority: 0 });
    await api.automation.rules.save({ ...rule, priority: 5 });
    expect(api.automation.rules.list()).toHaveLength(1);
    expect(api.automation.rules.list()[0].priority).toBe(5);
    const generated = await api.automation.rules.save({ ...rule, id: undefined });
    expect(generated.id).toBeTypeOf("string");
    expect(await api.automation.rules.delete("r1")).toBe(true);
    expect(await api.automation.rules.delete("r1")).toBe(false);
    await expect(api.automation.rules.save({ ...rule, match: {} })).rejects.toThrow(/criteria|at least one/);
  });

  it("exports and imports JSON", async () => {
    const { api } = bootAutomation();
    await api.automation.rules.save(rule);
    const json = api.automation.rules.exportJSON();
    expect(JSON.parse(json)).toMatchObject({ system: "world", version: 1, rules: [{ id: "r1" }] });
    await api.automation.rules.delete("r1");
    const res = await api.automation.rules.importJSON(json);
    expect(res).toEqual({ imported: 1, errors: [] });
    const res2 = await api.automation.rules.importJSON([{ ...rule, id: "r2" }, { id: "bad" }]);
    expect(res2.imported).toBe(1);
    expect(res2.errors).toHaveLength(1);
    expect(api.automation.rules.list().map((r) => r.id)).toEqual(["r1", "r2"]);
    await api.automation.rules.importJSON({ version: 1, rules: [] }, { replace: true });
    expect(api.automation.rules.list()).toEqual([]);
    await expect(api.automation.rules.importJSON("{nope")).rejects.toThrow(/JSON/);
  });
});

describe("generic fallback", () => {
  const fb = (d, eventType = "attack", area) => fallbackRecipe(d, { eventType, area })?.recipe;

  it("maps weapons by group and attack kind", () => {
    expect(fb({ type: "weapon", attackKind: "melee", weaponGroup: "axe" }).animation).toBe(
      "jb2a.greataxe.melee.standard.white"
    );
    expect(fb({ type: "weapon", attackKind: "melee", damageTypes: ["piercing"] }).animation).toBe(
      "jb2a.melee_generic.piercing.one_handed"
    );
    expect(fb({ type: "weapon", attackKind: "ranged", weaponGroup: "bow" })).toMatchObject({
      preset: "ranged",
      animation: "jb2a.arrow.physical.white.01"
    });
    expect(fb({ type: "weapon", attackKind: "thrown", weaponGroup: "knife" }).animation).toBe(
      "jb2a.dagger.throw.01.white"
    );
  });

  it("sizes and colours natural attacks by creature size, energy damage and creature type", () => {
    const jaws = { type: "weapon", attackKind: "melee", weaponGroup: "brawling", baseItem: "jaws", name: "Jaws" };
    expect(fallbackRecipe(jaws, { eventType: "attack" })).toMatchObject({
      recipe: { preset: "melee", animation: "jb2a.bite.200px.red" },
      reason: "natural bite attack"
    });
    const dragon = { ...jaws, damageTypes: ["piercing", "fire"], actorTraits: ["dragon", "size:huge"] };
    expect(fallbackRecipe(dragon, { eventType: "attack" })).toMatchObject({
      recipe: {
        animation: "jb2a.bite.400px.orange",
        stages: { impact: { animation: "jb2a.impact.fire.01.orange" } }
      },
      reason: "natural bite attack, large creature, fire damage"
    });
    const ghoul = { type: "weapon", attackKind: "melee", weaponGroup: null, name: "Claw", actorTraits: ["undead"] };
    expect(fb(ghoul).animation).toBe("jb2a.claws.200px.purple");
    expect(fb({ type: "weapon", attackKind: "melee", name: "Tail" }).animation).toBe(
      "jb2a.melee_generic.creature_attack.fist"
    );
    expect(fb({ type: "weapon", attackKind: "melee", name: "Stinger" }).animation).toBe(
      "jb2a.melee_generic.piercing.one_handed"
    );
    // A weapon with a real group keeps its group animation even when it is called "Claw Blade".
    expect(fb({ type: "weapon", attackKind: "melee", weaponGroup: "sword", name: "Claw Blade" }).animation).toBe(
      "jb2a.sword.melee.01.white"
    );
    // Variants missing from the database fall back to the branch path (random colour), then to the family.
    const only200 = (path) => path === "jb2a.bite.200px";
    expect(fallbackRecipe(jaws, { eventType: "attack", exists: only200 }).recipe.animation).toBe("jb2a.bite.200px");
    expect(fallbackRecipe(dragon, { eventType: "attack", exists: () => false }).recipe.animation).toBe("jb2a.bite");
  });

  it("maps spells by damage type (with system synonyms)", () => {
    expect(fb({ type: "spell", attackKind: "ranged", damageTypes: ["lightning"] })).toMatchObject({
      animation: "jb2a.chain_lightning.primary.blue",
      stages: { impact: { animation: "jb2a.static_electricity.01.blue" } }
    });
    expect(fb({ type: "spell", attackKind: "melee", damageTypes: ["fire"] }).animation).toBe(
      "jb2a.unarmed_strike.magical.01.orange"
    );
  });

  it("covers areas, healing and auras", () => {
    expect(fb({ damageTypes: ["fire"] }, "areaPlaced", { shape: "cone" }).animation).toBe(
      "jb2a.burning_hands.01.orange"
    );
    expect(fb({ area: { shape: "burst", size: 20 }, damageTypes: ["fire"] }, "areaPlaced").animation).toBe(
      "jb2a.fireball.explosion.orange"
    );
    expect(fb({ isHealing: true }, "healing")).toMatchObject({ preset: "onToken" });
    expect(fb({ traits: ["aura"] }, "effectApplied")).toMatchObject({ preset: "aura" });
    expect(fb({ traits: [] }, "effectApplied")).toBeUndefined();
    expect(fb({}, "damage")).toBeUndefined();
  });

  it("only uses jb2a database paths", () => {
    for (const path of fallbackAnimations()) expect(path).toMatch(/^jb2a\.[a-z0-9_.]+$/i);
  });
});
