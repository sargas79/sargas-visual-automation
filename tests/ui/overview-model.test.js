import { describe, expect, it, vi } from "vitest";
import {
  animationThumbnail,
  buildRow,
  changedRecipe,
  groupRows,
  isActorItem,
  isActorToken,
  isListed,
  matchesFilter,
  matchesQuery,
  pickSourceToken,
  probeEventTypes,
  recipeFromDescriptors,
  resolveForOverview,
  summarize
} from "../../src/ui/models/overview-model.js";

const descriptors = (extra = {}) => ({
  name: "Item",
  key: "item",
  type: "spell",
  traits: [],
  attackKind: null,
  area: null,
  damageTypes: [],
  isHealing: false,
  ...extra
});

const trace = (result, extra = {}) => ({
  descriptors: descriptors(),
  disabled: false,
  result,
  candidates: [],
  reasons: [],
  ...extra
});

describe("probeEventTypes", () => {
  it("asks the event types the adapter would emit for this kind of item", () => {
    expect(probeEventTypes(descriptors({ attackKind: "ranged" }))).toEqual(["attack"]);
    expect(probeEventTypes(descriptors({ area: { shape: "burst", size: 20 } }))).toEqual(["areaPlaced"]);
    expect(probeEventTypes(descriptors({ type: "effect" }))).toEqual(["effectApplied"]);
    expect(probeEventTypes(descriptors({ traits: ["Thrown"], isHealing: true }))).toEqual(["attack", "healing"]);
    expect(probeEventTypes(descriptors())).toEqual(["attack", "areaPlaced", "effectApplied"]);
  });
});

describe("resolveForOverview", () => {
  it("uses the plain explain result when there is one", () => {
    const result = {
      recipe: { preset: "ranged", animation: "jb2a.fire_bolt" },
      source: "system",
      triggers: ["attack"]
    };
    const explain = vi.fn(() => trace(result));
    const r = resolveForOverview(explain, { id: "a" });
    expect(explain).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ result, triggers: ["attack"], eventType: null });
  });

  it("stops at a disabled item", () => {
    const explain = vi.fn(() => trace(null, { disabled: true }));
    expect(resolveForOverview(explain, {}).result).toBeNull();
    expect(explain).toHaveBeenCalledTimes(1);
  });

  it("probes event types for the generic fallback and keeps only triggered results", () => {
    const d = descriptors({ attackKind: "melee", area: { shape: "cone", size: 15 } });
    const explain = vi.fn((_item, opts) => {
      if (!opts) return trace(null, { descriptors: d });
      if (opts.eventType === "attack")
        return trace({ recipe: { preset: "melee", animation: "jb2a.sword" }, source: "fallback", triggered: true });
      return trace({ recipe: { preset: "area", animation: "jb2a.cone" }, source: "fallback", triggered: false });
    });
    const r = resolveForOverview(explain, {});
    expect(explain).toHaveBeenCalledWith({}, { eventType: "attack" });
    expect(explain).toHaveBeenCalledWith({}, { eventType: "areaPlaced" });
    expect(r.result.recipe.animation).toBe("jb2a.sword");
    expect(r.triggers).toEqual(["attack"]);
    expect(r.eventType).toBe("attack");
  });

  it("returns no result when nothing matches", () => {
    const r = resolveForOverview(() => trace(null), {});
    expect(r.result).toBeNull();
    expect(r.triggers).toEqual([]);
  });
});

describe("animationThumbnail", () => {
  const db = { available: true, getEntry: (p) => (p === "jb2a.ok" ? { thumbnail: "t.webp" } : null) };
  it("reads the catalog entry thumbnail and flags unknown paths", () => {
    expect(animationThumbnail(db, "jb2a.ok")).toEqual({ thumbnail: "t.webp", missing: false });
    expect(animationThumbnail(db, "jb2a.nope")).toEqual({ thumbnail: null, missing: true });
  });
  it("does not flag direct files, empty paths or a missing database", () => {
    expect(animationThumbnail(db, "modules/x/y.webm").missing).toBe(false);
    expect(animationThumbnail(db, "").missing).toBe(false);
    expect(animationThumbnail({ available: false }, "jb2a.nope").missing).toBe(false);
  });
});

describe("buildRow", () => {
  const item = { id: "i1", uuid: "Actor.a.Item.i1", name: "Fire Bolt", img: "fb.webp", type: "spell" };
  const presets = { ranged: { label: "Ranged attack" } };

  it("describes the resolved animation, its source and triggers", () => {
    const resolution = {
      trace: trace(null, { descriptors: descriptors({ type: "spell" }) }),
      result: {
        recipe: { preset: "ranged", animation: "jb2a.fire_bolt" },
        source: "system",
        ruleId: "fire-bolt",
        reason: 'system rule "Fire bolt": key'
      },
      triggers: ["attack"],
      eventType: null
    };
    const row = buildRow(item, resolution, {
      db: { available: true, getEntry: () => ({ thumbnail: "t.webp" }) },
      presets
    });
    expect(row).toMatchObject({
      id: "i1",
      name: "Fire Bolt",
      type: "spell",
      found: true,
      source: "system",
      sourceKey: "SVA.UI.Source.system",
      ruleId: "fire-bolt",
      preset: "ranged",
      presetLabel: "Ranged attack",
      animation: "jb2a.fire_bolt",
      thumbnail: "t.webp",
      missing: false,
      triggers: ["attack"],
      triggerKeys: [{ id: "attack", labelKey: "SVA.UI.Recipe.Triggers.attack" }],
      hasOwnRecipe: false
    });
    expect(row.search).toContain("fire bolt");
    expect(row.search).toContain("jb2a.fire_bolt");
  });

  it("marks disabled items and items without a recipe", () => {
    const disabled = buildRow(item, { trace: trace(null, { disabled: true }), result: null, triggers: [] });
    expect(disabled).toMatchObject({ disabled: true, found: false, source: "disabled" });
    expect(disabled.view).toMatchObject({
      rowClass: "sva-overview-row sva-row-disabled sva-row-none",
      noPreview: true,
      noReset: true,
      pressed: "true",
      toggleIcon: "fa-toggle-off",
      toggleTooltip: "SVA.UI.Overview.Enable"
    });
    const none = buildRow(item, { trace: trace(null), result: null, triggers: [] });
    expect(none).toMatchObject({ disabled: false, found: false, source: "none", sourceKey: "SVA.UI.Source.none" });
  });

  it("puts unknown descriptor types in the other group", () => {
    const row = buildRow(item, {
      trace: trace(null, { descriptors: descriptors({ type: "armor" }) }),
      result: null,
      triggers: []
    });
    expect(row.type).toBe("other");
  });
});

describe("filtering and grouping", () => {
  const row = (name, type, extra = {}) => {
    const r = { name, type, found: true, disabled: false, hasOwnRecipe: false, ...extra };
    r.search = `${name} ${extra.animation ?? ""}`.toLowerCase();
    return r;
  };
  const rows = [
    row("Magic Missile", "spell", { animation: "jb2a.magic_missile" }),
    row("Fireball", "spell", { animation: "jb2a.fireball" }),
    row("Longsword", "weapon", { hasOwnRecipe: true }),
    row("Shield", "other", { found: false }),
    row("Torch", "other", { found: true }),
    row("Frightened", "condition", { found: false, disabled: true })
  ];

  it("matches every query term", () => {
    expect(matchesQuery("magic missile jb2a.magic_missile", "MISSILE jb2a")).toBe(true);
    expect(matchesQuery("fireball", "fire bolt")).toBe(false);
    expect(matchesQuery("anything", "  ")).toBe(true);
  });

  it("filters by status", () => {
    expect(rows.filter((r) => matchesFilter(r, "animated")).map((r) => r.name)).toEqual([
      "Magic Missile",
      "Fireball",
      "Longsword",
      "Torch"
    ]);
    expect(rows.filter((r) => matchesFilter(r, "none")).map((r) => r.name)).toEqual(["Shield"]);
    expect(rows.filter((r) => matchesFilter(r, "item")).map((r) => r.name)).toEqual(["Longsword"]);
    expect(rows.filter((r) => matchesFilter(r, "disabled")).map((r) => r.name)).toEqual(["Frightened"]);
  });

  it("hides other items without animation unless showAll", () => {
    expect(isListed(rows[3])).toBe(false);
    expect(isListed(rows[3], { showAll: true })).toBe(true);
    expect(isListed(rows[4])).toBe(true);
  });

  it("groups in order with rows sorted by name", () => {
    const groups = groupRows(rows);
    expect(groups.map((g) => g.id)).toEqual(["spell", "weapon", "condition", "other"]);
    expect(groups[0].rows.map((r) => r.name)).toEqual(["Fireball", "Magic Missile"]);
    expect(groups[0]).toMatchObject({ labelKey: "SVA.UI.Overview.Groups.spell", count: 2 });
    expect(groupRows(rows, { query: "missile" }).map((g) => g.id)).toEqual(["spell"]);
    expect(groupRows(rows, { showAll: true }).find((g) => g.id === "other").count).toBe(2);
  });

  it("summarizes the listed rows", () => {
    expect(summarize(rows)).toEqual({ total: 5, animated: 4, none: 0, disabled: 1 });
  });
});

describe("changedRecipe", () => {
  it("keeps the resolved preset, options and stages and only replaces the animation", () => {
    const recipe = {
      version: 1,
      preset: "ranged",
      animation: "jb2a.fire_bolt.orange",
      options: { scale: 1.2 },
      stages: { impact: { animation: "jb2a.impact.fire" } }
    };
    const row = { recipe, triggers: ["attack"], eventType: null };
    const out = changedRecipe(row, "jb2a.ray_of_frost");
    expect(out).toEqual({ ...recipe, animation: "jb2a.ray_of_frost" });
    expect(recipe.animation).toBe("jb2a.fire_bolt.orange");
  });

  it("pins the probed trigger of a fallback recipe", () => {
    const row = {
      recipe: { version: 1, preset: "area", animation: "x" },
      triggers: ["areaPlaced"],
      eventType: "areaPlaced"
    };
    expect(changedRecipe(row, "jb2a.y").triggers).toEqual(["areaPlaced"]);
  });

  it("creates a recipe from the descriptors when nothing resolved", () => {
    const row = (d) => ({ recipe: null, descriptors: descriptors(d) });
    expect(changedRecipe(row({ attackKind: "ranged" }), "p")).toEqual({ version: 1, preset: "ranged", animation: "p" });
    expect(changedRecipe(row({ traits: ["thrown"] }), "p").preset).toBe("ranged");
    expect(changedRecipe(row({ attackKind: "melee" }), "p").preset).toBe("melee");
    expect(changedRecipe(row({ area: { shape: "cone", size: 30 } }), "p")).toEqual({
      version: 1,
      preset: "area",
      animation: "p",
      options: { shape: "cone" }
    });
    expect(changedRecipe(row({ type: "effect", traits: ["aura"] }), "p").preset).toBe("aura");
    expect(changedRecipe(row({ type: "effect" }), "p")).toMatchObject({
      preset: "onToken",
      triggers: ["effectApplied"]
    });
    expect(changedRecipe(row({}), "p")).toEqual({ version: 1, preset: "onToken", animation: "p" });
    expect(recipeFromDescriptors(null, "p").preset).toBe("onToken");
  });
});

describe("actor helpers", () => {
  const actor = { id: "a1", uuid: "Actor.a1" };
  const synthetic = { id: "a1", uuid: "Scene.s.Token.t.Actor.a1" };

  it("prefers a controlled token of the actor, then an active token", () => {
    const other = { actor: { id: "b", uuid: "Actor.b" } };
    const own = { actor };
    const active = { id: "active" };
    expect(pickSourceToken(actor, [other, own], [active])).toBe(own);
    expect(pickSourceToken(actor, [other], [active])).toBe(active);
    expect(pickSourceToken(actor, [], [])).toBeNull();
  });

  it("tells synthetic token actors apart", () => {
    expect(isActorToken(actor, { actor: synthetic })).toBe(false);
    expect(isActorToken(synthetic, { actor: synthetic })).toBe(true);
    expect(isActorToken({ id: "a1" }, { document: { actorId: "a1" } })).toBe(true);
  });

  it("matches items embedded in the actor", () => {
    expect(isActorItem(actor, { parent: { id: "a1", uuid: "Actor.a1" } })).toBe(true);
    expect(isActorItem(actor, { parent: synthetic })).toBe(false);
    expect(isActorItem(actor, { parent: null })).toBe(false);
    expect(isActorItem(actor, null)).toBe(false);
  });
});
