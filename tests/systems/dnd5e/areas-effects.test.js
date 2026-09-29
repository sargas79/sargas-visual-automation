import { beforeEach, describe, expect, it } from "vitest";
import { eventFromTemplate, eventsFromRegion, removalFromRegion } from "../../../src/systems/dnd5e/areas.js";
import { eventFromEffect } from "../../../src/systems/dnd5e/effects.js";
import { AREA_SHAPES, EVENT_TYPES } from "../../../src/shared/events.js";
import { SCENE, installCanvas, mockActor, spells } from "./helpers/fixtures.js";

let env;
beforeEach(() => {
  const fireball = spells.fireball();
  const burningHands = spells.burningHands();
  const guardians = spells.spiritGuardians();
  const bless = spells.bless();
  const hero = mockActor("hero", { items: [fireball, burningHands, guardians, bless] });
  const goblin = mockActor("goblin");
  installCanvas({ actors: [hero, goblin] });
  env = { hero, goblin, fireball, burningHands, guardians, bless };
});

/** RegionDocument created by TemplatePlacement.fromActivity (canvas/template-placement.mjs). */
function region(item, shapes, { id = "reg1", tokens = [] } = {}) {
  const activity = item.system.activities.values().next().value;
  return {
    id,
    uuid: `Scene.${SCENE}.Region.${id}`,
    parent: { id: SCENE },
    shapes,
    tokens: new Set(tokens.map((t) => ({ id: t }))),
    flags: {
      core: { MeasuredTemplate: true },
      dnd5e: {
        activity: activity.uuid,
        item: item.uuid,
        origin: `Scene.${SCENE}.Token.tok-hero`,
        dimensions: { size: 20, units: "ft" }
      }
    }
  };
}

describe("template regions → AREA_PLACED", () => {
  it("converts a Fireball sphere (circle shape, px) into a 20 ft burst", () => {
    const doc = region(env.fireball, [{ type: "circle", x: 500, y: 600, radius: 400, rotation: 0 }], {
      tokens: ["tok-goblin"]
    });
    const [event] = eventsFromRegion(doc, { userId: "user1" });
    expect(event).toMatchObject({
      id: "reg1:areaPlaced",
      type: EVENT_TYPES.AREA_PLACED,
      source: { tokenId: "tok-hero", actorId: "hero" },
      targets: [{ tokenId: "tok-goblin" }],
      itemUuid: env.fireball.uuid,
      area: { shape: AREA_SHAPES.BURST, origin: { x: 500, y: 600 }, distance: 20, documentUuid: doc.uuid },
      descriptors: { key: "fireball", area: { shape: AREA_SHAPES.BURST, size: 20 } },
      userId: "user1"
    });
  });

  it("converts a 5e cone", () => {
    const doc = region(env.burningHands, [{ type: "cone", x: 100, y: 100, radius: 300, angle: 53.13, rotation: 90 }]);
    expect(eventsFromRegion(doc)[0].area).toMatchObject({
      shape: AREA_SHAPES.CONE,
      direction: 90,
      distance: 15,
      angle: 53.13
    });
  });

  it("emits one event per placed shape", () => {
    const doc = region(env.fireball, [
      { type: "circle", x: 0, y: 0, radius: 100 },
      { type: "circle", x: 500, y: 0, radius: 100 }
    ]);
    expect(eventsFromRegion(doc).map((e) => e.id)).toEqual(["reg1:areaPlaced", "reg1:1:areaPlaced"]);
  });

  it("converts an emanation around the caster", () => {
    const doc = region(env.guardians, [
      { type: "emanation", radius: 300, base: { type: "token", x: 200, y: 200, width: 1, height: 1 } }
    ]);
    expect(eventsFromRegion(doc)[0].area).toMatchObject({
      shape: AREA_SHAPES.EMANATION,
      origin: { x: 250, y: 250 },
      distance: 15
    });
  });

  it("ignores regions not placed by dnd5e and reports removal", () => {
    expect(eventsFromRegion({ id: "x", shapes: [{ type: "circle", radius: 1 }], flags: {} })).toEqual([]);
    const doc = region(env.fireball, [{ type: "circle", x: 0, y: 0, radius: 100 }]);
    expect(removalFromRegion(doc)).toMatchObject({
      id: "reg1:effectRemoved",
      type: EVENT_TYPES.EFFECT_REMOVED,
      effectUuid: doc.uuid,
      descriptors: { key: "fireball" }
    });
  });

  it("still reads deprecated MeasuredTemplates", () => {
    const activity = env.fireball.system.activities.values().next().value;
    const doc = {
      id: "t1",
      uuid: "Scene.scene1.MeasuredTemplate.t1",
      t: "circle",
      x: 10,
      y: 20,
      distance: 20,
      flags: { dnd5e: { item: env.fireball.uuid, origin: activity.uuid } }
    };
    expect(eventFromTemplate(doc)).toMatchObject({
      id: "t1:areaPlaced",
      area: { shape: AREA_SHAPES.BURST, distance: 20 },
      descriptors: { key: "fireball" }
    });
  });
});

/** ActiveEffect5e (documents/active-effect.mjs). */
function effect(parent, data) {
  return { id: "eff1", uuid: `${parent.uuid}.ActiveEffect.eff1`, parent, statuses: new Set(), flags: {}, ...data };
}

describe("active effects", () => {
  it("concentration describes the concentrated spell (aura lifecycle)", () => {
    const { hero, guardians } = env;
    const conc = effect(hero, {
      name: "Concentrating: Spirit Guardians",
      statuses: new Set(["concentrating"]),
      system: { type: "concentrating" },
      origin: guardians.uuid,
      flags: { dnd5e: { item: { id: guardians.id, uuid: guardians.uuid, type: "spell" } } }
    });
    const applied = eventFromEffect(conc, EVENT_TYPES.EFFECT_APPLIED, { userId: "user1" });
    expect(applied).toMatchObject({
      type: EVENT_TYPES.EFFECT_APPLIED,
      source: { tokenId: "tok-hero", actorId: "hero" },
      itemUuid: guardians.uuid,
      effectUuid: conc.uuid,
      descriptors: { key: "spirit-guardians", type: "spell", area: { shape: AREA_SHAPES.EMANATION, size: 15 } }
    });
    const removed = eventFromEffect(conc, EVENT_TYPES.EFFECT_REMOVED);
    expect(removed.descriptors.key).toBe("spirit-guardians");
    expect(removed.source).toEqual(applied.source);
  });

  it("conditions use the status id and can be turned off", () => {
    const { goblin } = env;
    const prone = effect(goblin, {
      name: "Prone",
      type: "condition",
      statuses: new Set(["prone"]),
      system: { type: "prone" }
    });
    expect(eventFromEffect(prone, EVENT_TYPES.EFFECT_APPLIED)).toMatchObject({
      source: { tokenId: "tok-goblin", actorId: "goblin" },
      targets: [{ tokenId: "tok-goblin" }],
      descriptors: { key: "prone", type: "condition" }
    });
    expect(eventFromEffect(prone, EVENT_TYPES.EFFECT_APPLIED, { conditions: false })).toBeNull();
  });

  it("spell effects on a target are keyed by name and sit on the carrier", () => {
    const { goblin, bless } = env;
    const blessed = effect(goblin, { name: "Blessed", origin: bless.uuid });
    expect(eventFromEffect(blessed, EVENT_TYPES.EFFECT_APPLIED)).toMatchObject({
      source: { tokenId: "tok-goblin", actorId: "goblin" },
      descriptors: { key: "blessed", type: "effect" }
    });
  });

  it("skips item effects, enchantments and disabled effects", () => {
    const { hero, bless } = env;
    expect(eventFromEffect(effect(bless, { name: "Transfer" }), EVENT_TYPES.EFFECT_APPLIED)).toBeNull();
    expect(eventFromEffect(effect(hero, { name: "Ench", type: "enchantment" }), EVENT_TYPES.EFFECT_APPLIED)).toBeNull();
    expect(eventFromEffect(effect(hero, { name: "Off", disabled: true }), EVENT_TYPES.EFFECT_APPLIED)).toBeNull();
  });
});
