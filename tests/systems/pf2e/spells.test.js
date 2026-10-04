import { describe, expect, it, vi } from "vitest";
import Pf2eAdapter from "../../../src/systems/pf2e/index.js";
import { describeItem } from "../../../src/systems/pf2e/descriptors.js";
import { eventFromMessage } from "../../../src/systems/pf2e/messages.js";
import { areaFromShape, baseCenter, eventFromRegion, eventFromTemplate } from "../../../src/systems/pf2e/areas.js";
import { AREA_SHAPES, ATTACK_KINDS, EVENT_TYPES, OUTCOMES } from "../../../src/shared/events.js";
import { checkContext, installCanvas, mockActor, mockMessage, SCENE, spells } from "./helpers/fixtures.js";

const CAST = ["origin:action:slug:cast-a-spell"];

function castMessage(actor, spell) {
  return mockMessage({
    actor,
    item: spell,
    context: spell.system.defense ? { type: "spell-cast", domains: ["spell-dc"], options: [] } : undefined,
    origin: { actor: actor.uuid, uuid: spell.uuid, type: "spell", castRank: 3, rollOptions: CAST }
  });
}

/** Region as created by PF2e placeRegionFromItem (flags.pf2e.origin = item.getOriginData() + name/slug/traits). */
function region(spell, shape, { tokens = [] } = {}) {
  return {
    id: "reg1",
    uuid: `Scene.${SCENE}.Region.reg1`,
    parent: { id: SCENE },
    shapes: [shape],
    tokens: new Set(tokens.map((id) => ({ id }))),
    flags: {
      pf2e: {
        messageId: "msg1",
        areaShape: spell.system.area.type,
        origin: {
          name: spell.name,
          slug: spell.slug,
          traits: spell.system.traits.value,
          actor: "Actor.hero",
          uuid: spell.uuid,
          type: "spell"
        }
      }
    }
  };
}

describe("spell descriptors", () => {
  it("areas, damage types, attack kind", () => {
    expect(describeItem(spells.fireball())).toMatchObject({
      type: "spell",
      area: { shape: AREA_SHAPES.BURST, size: 20 },
      damageTypes: ["fire"],
      range: 500,
      attackKind: null
    });
    expect(describeItem(spells.breatheFire()).area).toEqual({ shape: AREA_SHAPES.CONE, size: 15 });
    expect(describeItem(spells.lightningBolt()).area).toEqual({ shape: AREA_SHAPES.LINE, size: 120 });
    expect(describeItem(spells.ignition())).toMatchObject({ attackKind: ATTACK_KINDS.RANGED, range: 30 });
  });

  it("touch attack spells are melee", () => {
    const touch = spells.ignition();
    touch.system.range.value = "touch";
    expect(describeItem(touch).attackKind).toBe(ATTACK_KINDS.MELEE);
  });

  it("marks sustained spells with a synthetic trait", () => {
    expect(describeItem(spells.sustained()).traits).toContain("sustained");
    expect(describeItem(spells.fireball()).traits).not.toContain("sustained");
  });
});

describe("spell events", () => {
  it("cast → CAST on caster with targets", () => {
    const fireball = spells.fireball();
    const hero = mockActor("hero", { items: [fireball] });
    const orc = mockActor("orc");
    installCanvas({ actors: [hero, orc], targets: ["tok-orc"] });
    const ev = eventFromMessage(castMessage(hero, fireball), { userId: "user1" });
    expect(ev).toMatchObject({
      type: EVENT_TYPES.CAST,
      source: { tokenId: "tok-hero" },
      targets: [{ tokenId: "tok-orc" }],
      outcome: OUTCOMES.NONE,
      descriptors: { key: "fireball" }
    });
  });

  it("spell attack roll → ATTACK (attack-roll with spell-attack-roll domain)", () => {
    const ignition = spells.ignition();
    const hero = mockActor("hero", { items: [ignition] });
    const orc = mockActor("orc");
    installCanvas({ actors: [hero, orc] });
    const msg = mockMessage({
      actor: hero,
      item: ignition,
      context: checkContext("attack-roll", {
        actor: hero,
        target: orc,
        outcome: "failure",
        domains: ["spell-attack", "spell-attack-roll", "attack", "attack-roll"]
      })
    });
    expect(eventFromMessage(msg, { userId: "user1" })).toMatchObject({
      type: EVENT_TYPES.ATTACK,
      outcome: OUTCOMES.FAILURE,
      targets: [{ tokenId: "tok-orc", outcome: OUTCOMES.FAILURE }],
      descriptors: { key: "ignition", attackKind: ATTACK_KINDS.RANGED, damageTypes: ["fire"] }
    });
  });

  it("saving throw → SAVE on the saving token, source = caster", () => {
    const arc = spells.electricArc();
    const hero = mockActor("hero", { items: [arc] });
    const orc = mockActor("orc");
    installCanvas({ actors: [hero, orc] });
    // The orc's player/GM rolls the save from the spell card: speaker = orc, origin = caster, flags.origin = spell.
    const msg = mockMessage({
      actor: orc,
      item: arc,
      context: checkContext("saving-throw", { actor: orc, origin: hero, target: orc, outcome: "criticalFailure" }),
      origin: { actor: hero.uuid, uuid: arc.uuid, type: "spell" }
    });
    expect(eventFromMessage(msg, { userId: "gm" })).toMatchObject({
      type: EVENT_TYPES.SAVE,
      source: { tokenId: "tok-hero", actorId: "hero" },
      targets: [{ tokenId: "tok-orc", outcome: OUTCOMES.CRITICAL_FAILURE }],
      outcome: OUTCOMES.CRITICAL_FAILURE,
      userId: "gm"
    });
  });
});

describe("areas (v14 Regions)", () => {
  it("Fireball burst: circle center, radius px → feet, tokens inside as targets", () => {
    const fireball = spells.fireball();
    const hero = mockActor("hero", { items: [fireball] });
    installCanvas({ actors: [hero] });
    const ev = eventFromRegion(
      region(fireball, { type: "circle", x: 1000, y: 800, radius: 400 }, { tokens: ["a", "b"] }),
      {
        userId: "user1"
      }
    );
    expect(ev).toMatchObject({
      type: EVENT_TYPES.AREA_PLACED,
      source: { actorId: "hero", tokenId: "tok-hero" },
      targets: [{ tokenId: "a" }, { tokenId: "b" }],
      itemUuid: fireball.uuid,
      descriptors: { key: "fireball" },
      area: {
        shape: AREA_SHAPES.BURST,
        origin: { x: 1000, y: 800 },
        direction: 0,
        distance: 20,
        documentUuid: `Scene.${SCENE}.Region.reg1`
      }
    });
  });

  it("Breathe Fire cone keeps direction", () => {
    const spell = spells.breatheFire();
    installCanvas({ actors: [mockActor("hero", { items: [spell] })] });
    const ev = eventFromRegion(region(spell, { type: "cone", x: 500, y: 500, radius: 300, angle: 90, rotation: 45 }));
    expect(ev.area).toMatchObject({ shape: AREA_SHAPES.CONE, origin: { x: 500, y: 500 }, direction: 45, distance: 15 });
  });

  it("Lightning Bolt line has distance and width", () => {
    const spell = spells.lightningBolt();
    installCanvas({ actors: [mockActor("hero", { items: [spell] })] });
    const ev = eventFromRegion(
      region(spell, { type: "line", x: 100, y: 100, length: 2400, width: 100, rotation: 180 })
    );
    expect(ev.area).toMatchObject({ shape: AREA_SHAPES.LINE, direction: 180, distance: 120, width: 5 });
  });

  it("emanation is centered on the token base", () => {
    const area = areaFromShape(
      { type: "emanation", radius: 200, base: { type: "token", x: 300, y: 300, width: 2, height: 2 } },
      "emanation"
    );
    expect(area).toMatchObject({ shape: AREA_SHAPES.EMANATION, origin: { x: 400, y: 400 }, distance: 10 });
  });

  it("emanation base in pixels (token shape with pixel width/height)", () => {
    const area = areaFromShape(
      { type: "emanation", radius: 200, base: { type: "token", x: 300, y: 300, width: 200, height: 200 } },
      "emanation"
    );
    expect(area).toMatchObject({ origin: { x: 400, y: 400 }, distance: 10, width: 10 });
  });

  it("emanation around circle, rectangle and polygon bases", () => {
    expect(baseCenter({ type: "circle", x: 150, y: 250, radius: 50 }, 100)).toEqual({ x: 150, y: 250 });
    expect(baseCenter({ type: "rectangle", x: 100, y: 100, width: 200, height: 100 }, 100)).toEqual({ x: 200, y: 150 });
    expect(baseCenter({ type: "polygon", points: [0, 0, 200, 0, 200, 200, 0, 200] }, 100)).toEqual({ x: 100, y: 100 });
    expect(baseCenter({ type: "token" }, 100)).toBeNull();
    expect(baseCenter(null, 100)).toBeNull();
  });

  it("emanation without a resolvable base has no origin, so the recipe anchors on the caster", () => {
    const area = areaFromShape({ type: "emanation", radius: 100, base: { type: "token" } }, "emanation");
    expect(area).toMatchObject({ shape: AREA_SHAPES.EMANATION, origin: null, distance: 5 });
  });

  it("falls back to flag data when the item is gone, ignores foreign regions", () => {
    const spell = spells.fireball();
    installCanvas({ actors: [] });
    const ev = eventFromRegion(region(spell, { type: "circle", x: 0, y: 0, radius: 100 }));
    expect(ev.descriptors).toMatchObject({ key: "fireball", type: "spell", traits: expect.arrayContaining(["fire"]) });
    expect(eventFromRegion({ flags: {}, shapes: [{ type: "circle" }] })).toBeNull();
  });

  it("legacy MeasuredTemplate with PF2e origin", () => {
    const spell = spells.breatheFire();
    installCanvas({ actors: [mockActor("hero", { items: [spell] })] });
    const ev = eventFromTemplate({
      t: "cone",
      x: 10,
      y: 20,
      direction: 90,
      distance: 15,
      angle: 90,
      flags: { pf2e: { origin: { uuid: spell.uuid, type: "spell", actor: "Actor.hero" } } }
    });
    expect(ev.area).toMatchObject({ shape: AREA_SHAPES.CONE, direction: 90, distance: 15 });
  });

  it("adapter emits AREA_PLACED on createRegion and EFFECT_REMOVED on deleteRegion for the placing user", () => {
    const spell = spells.fireball();
    installCanvas({ actors: [mockActor("hero", { items: [spell] })] });
    const emit = vi.fn();
    const adapter = new Pf2eAdapter({ api: {}, emit });
    adapter.register();
    const doc = region(spell, { type: "circle", x: 0, y: 0, radius: 100 });
    Hooks.callAll("createRegion", doc, {}, "otherUser");
    expect(emit).not.toHaveBeenCalled();
    Hooks.callAll("createRegion", doc, {}, "user1");
    Hooks.callAll("createRegion", doc, {}, "user1");
    expect(emit).toHaveBeenCalledTimes(1);
    Hooks.callAll("deleteRegion", doc, {}, "user1");
    expect(emit.mock.calls[0][0].id).toBe("reg1:areaPlaced");
    expect(emit.mock.calls[1][0]).toMatchObject({
      id: "reg1:effectRemoved",
      type: EVENT_TYPES.EFFECT_REMOVED,
      effectUuid: doc.uuid,
      itemUuid: spell.uuid
    });
  });
});
