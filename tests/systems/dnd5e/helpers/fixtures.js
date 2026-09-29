/**
 * Mock dnd5e 6.x documents shaped like the real data (packs/_source/spells24, equipment24 and the data models cited in
 * src/systems/dnd5e/*.js). Only the fields the adapter reads are populated.
 */
export const SCENE = "scene1";

export function mockToken(id, actor) {
  return { id, document: { id, actorId: actor?.id ?? null }, actor };
}

export function mockActor(id, { name = id, tokenIds = [`tok-${id}`], items = [], ac = 15 } = {}) {
  const actor = {
    id,
    name,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    system: { attributes: { ac: { value: ac } } },
    items: new Map(items.map((i) => [i.id, i]))
  };
  actor.tokens = tokenIds.map((t) => mockToken(t, actor));
  actor.getActiveTokens = () => actor.tokens;
  for (const i of items) {
    i.parent = actor;
    i.actor = actor;
    i.uuid = `Actor.${id}.Item.${i.id}`;
    for (const a of i.system.activities.values()) {
      a.item = i;
      a.uuid = `${i.uuid}.Activity.${a.id}`;
    }
  }
  return actor;
}

/** Install canvas + fromUuidSync + user targets globals. */
export function installCanvas({ actors = [], targets = [], gridSize = 100, gridDistance = 5 } = {}) {
  const placeables = actors.flatMap((a) => a.tokens);
  globalThis.canvas = {
    scene: { id: SCENE },
    dimensions: { size: gridSize, distance: gridDistance },
    grid: { size: gridSize, distance: gridDistance },
    tokens: { placeables }
  };
  globalThis.game.user.targets = new Set(targets.map((id) => placeables.find((t) => t.id === id) ?? { id }));
  const byUuid = new Map();
  for (const a of actors) {
    byUuid.set(a.uuid, a);
    for (const i of a.items.values()) {
      byUuid.set(i.uuid, i);
      for (const act of i.system.activities.values()) byUuid.set(act.uuid, act);
    }
  }
  globalThis.fromUuidSync = (uuid) => byUuid.get(uuid) ?? null;
}

// --- Activities (module/data/activity/*) -------------------------------------------------------------------
let n = 0;
const nextId = (p) => `${p}${(n += 1)}`;

export function attackActivity({ value = "melee", classification = "weapon", types = [] } = {}) {
  return {
    id: nextId("atk"),
    type: "attack",
    attack: { type: { value, classification } },
    damage: { parts: types.length ? [{ types: new Set(types) }] : [] },
    target: { template: { type: "", size: "" } }
  };
}
export function saveActivity({ types = [], template = null } = {}) {
  return {
    id: nextId("sav"),
    type: "save",
    damage: { parts: types.length ? [{ types: new Set(types) }] : [] },
    target: { template: template ?? { type: "", size: "" } }
  };
}
export function damageActivity({ types = [] } = {}) {
  return { id: nextId("dmg"), type: "damage", damage: { parts: [{ types: new Set(types) }] }, target: {} };
}
export function healActivity({ types = ["healing"] } = {}) {
  return { id: nextId("hel"), type: "heal", healing: { types: new Set(types) }, target: {} };
}
export function utilityActivity() {
  return { id: nextId("utl"), type: "utility", target: {} };
}

function item(type, { name, identifier, activities = [], system = {} }) {
  const id = nextId(type);
  return {
    id,
    name,
    type,
    documentName: "Item",
    uuid: `Item.${id}`,
    system: {
      identifier,
      properties: new Set(),
      activities: new Map(activities.map((a) => [a.id, a])),
      ...system
    }
  };
}

// --- Weapons (module/data/item/weapon.mjs, packs/_source/equipment24/weapons) ------------------------------
export const weapons = {
  longsword: () =>
    item("weapon", {
      name: "Longsword",
      identifier: "longsword",
      activities: [attackActivity()],
      system: {
        type: { value: "martialM", baseItem: "longsword" },
        properties: new Set(["ver"]),
        damage: { base: { types: new Set(["slashing"]) } },
        range: { value: null, reach: 5, units: "ft" }
      }
    }),
  sunBlade: () =>
    item("weapon", {
      name: "Sun Blade",
      identifier: "sun-blade",
      activities: [attackActivity()],
      system: {
        type: { value: "martialM", baseItem: "longsword" },
        properties: new Set(["fin", "mgc", "ver"]),
        damage: { base: { types: new Set(["radiant"]) } }
      }
    }),
  dagger: () =>
    item("weapon", {
      name: "Dagger",
      identifier: "dagger",
      activities: [attackActivity()],
      system: {
        type: { value: "simpleM", baseItem: "dagger" },
        properties: new Set(["fin", "lgt", "thr"]),
        damage: { base: { types: new Set(["piercing"]) } },
        range: { value: 20, long: 60, reach: 5, units: "ft" }
      }
    }),
  longbow: () =>
    item("weapon", {
      name: "Longbow",
      identifier: "longbow",
      activities: [attackActivity({ value: "ranged" })],
      system: {
        type: { value: "martialR", baseItem: "longbow" },
        properties: new Set(["amm", "hvy", "two"]),
        damage: { base: { types: new Set(["piercing"]) } },
        range: { value: 150, long: 600, units: "ft" }
      }
    }),
  dart: () =>
    item("weapon", {
      name: "Dart",
      identifier: "dart",
      activities: [attackActivity({ value: "ranged" })],
      system: {
        type: { value: "simpleR", baseItem: "dart" },
        properties: new Set(["fin", "thr"]),
        damage: { base: { types: new Set(["piercing"]) } },
        range: { value: 20, long: 60, units: "ft" }
      }
    }),
  warPick: () =>
    item("weapon", {
      name: "War Pick",
      identifier: "war-pick",
      activities: [attackActivity()],
      system: { type: { value: "martialM", baseItem: "warpick" }, damage: { base: { types: new Set(["piercing"]) } } }
    }),
  unarmedStrike: () =>
    item("weapon", {
      name: "Unarmed Strike",
      identifier: "unarmed-strike",
      activities: [attackActivity({ classification: "unarmed" })],
      system: { type: { value: "natural", baseItem: "" }, damage: { base: { types: new Set(["bludgeoning"]) } } }
    }),
  claw: () =>
    item("weapon", {
      name: "Claws",
      identifier: "claws",
      activities: [attackActivity()],
      system: { type: { value: "natural", baseItem: "" }, damage: { base: { types: new Set(["slashing"]) } } }
    }),
  homebrewBlade: () =>
    item("weapon", {
      name: "Moonsilver Blade",
      identifier: "moonsilver-blade",
      activities: [attackActivity()],
      system: { type: { value: "martialM", baseItem: "" }, damage: { base: { types: new Set(["slashing"]) } } }
    })
};

// --- Spells (packs/_source/spells24) ------------------------------------------------------------------------
function spell(name, identifier, { level = 1, school = "evo", activities, properties = [], template, range } = {}) {
  return item("spell", {
    name,
    identifier,
    activities,
    system: {
      level,
      school,
      properties: new Set(properties),
      range: range ?? { value: 60, units: "ft" },
      target: { template: template ?? { type: "", size: "" } }
    }
  });
}

export const spells = {
  fireBolt: () =>
    spell("Fire Bolt", "fire-bolt", {
      level: 0,
      activities: [attackActivity({ value: "ranged", classification: "spell", types: ["fire"] })],
      range: { value: 120, units: "ft" }
    }),
  eldritchBlast: () =>
    spell("Eldritch Blast", "eldritch-blast", {
      level: 0,
      activities: [attackActivity({ value: "ranged", classification: "spell", types: ["force"] })]
    }),
  shockingGrasp: () =>
    spell("Shocking Grasp", "shocking-grasp", {
      level: 0,
      activities: [attackActivity({ value: "melee", classification: "spell", types: ["lightning"] })],
      range: { units: "touch" }
    }),
  sacredFlame: () =>
    spell("Sacred Flame", "sacred-flame", { level: 0, activities: [saveActivity({ types: ["radiant"] })] }),
  magicMissile: () => spell("Magic Missile", "magic-missile", { activities: [damageActivity({ types: ["force"] })] }),
  fireball: () =>
    spell("Fireball", "fireball", {
      level: 3,
      activities: [saveActivity({ types: ["fire"] })],
      range: { value: 150, units: "ft" },
      template: { type: "sphere", size: "20", units: "ft" }
    }),
  burningHands: () =>
    spell("Burning Hands", "burning-hands", {
      activities: [saveActivity({ types: ["fire"] })],
      range: { units: "self" },
      template: { type: "cone", size: "15", units: "ft" }
    }),
  cureWounds: () => spell("Cure Wounds", "cure-wounds", { school: "abj", activities: [healActivity()] }),
  revivify: () =>
    spell("Revivify", "revivify", { level: 3, school: "nec", activities: [damageActivity({ types: ["healing"] })] }),
  bless: () =>
    spell("Bless", "bless", {
      school: "enc",
      properties: ["vocal", "somatic", "concentration"],
      activities: [utilityActivity()]
    }),
  spiritGuardians: () =>
    spell("Spirit Guardians", "spirit-guardians", {
      level: 3,
      school: "con",
      properties: ["vocal", "somatic", "material", "concentration"],
      activities: [saveActivity({ types: ["radiant", "necrotic"] })],
      template: { type: "radius", size: "15", units: "ft" }
    }),
  mistyStep: () =>
    spell("Misty Step", "misty-step", { level: 2, school: "con", activities: [{ id: "tel1", type: "teleport" }] }),
  homebrewFlare: () =>
    spell("Homebrew Flare", "homebrew-flare", {
      activities: [attackActivity({ value: "ranged", classification: "spell", types: ["fire"] })]
    })
};

// --- Consumables ---------------------------------------------------------------------------------------------
export const consumables = {
  potionOfHealing: () =>
    item("consumable", {
      name: "Potion of Healing",
      identifier: "potion-of-healing",
      activities: [healActivity()],
      system: { type: { value: "potion", subtype: "" }, properties: new Set(["mgc"]) }
    }),
  homebrewPotion: () =>
    item("consumable", {
      name: "Troll Tonic",
      identifier: "troll-tonic",
      activities: [healActivity()],
      system: { type: { value: "potion", subtype: "" } }
    })
};

// --- Rolls (module/dice/d20-roll.mjs, damage-roll.mjs) -----------------------------------------------------
export function d20Roll(total, { natural = 10, target } = {}) {
  return {
    total,
    options: { target },
    isCritical: natural === 20,
    isFumble: natural === 1,
    isSuccess: target === undefined ? false : total >= target,
    isFailure: target === undefined ? false : total < target
  };
}
export function damageRoll(type, { critical = false } = {}) {
  return { total: 7, options: { type }, isCritical: critical };
}

/** TargetsField descriptor (targets-field.mjs#getDescriptors). */
export function targetDescriptor(actor, tokenId = `tok-${actor.id}`, { ac = actor.system.attributes.ac.value } = {}) {
  return { actor: actor.uuid, token: `Scene.${SCENE}.Token.${tokenId}`, ac, name: actor.name, img: "" };
}

/** ChatMessage5e with a typed `system` (module/data/chat-message/*). */
export function mockMessage({
  id = nextId("msg"),
  type,
  actor,
  item: it,
  activity,
  targets = [],
  rolls = [],
  system = {}
}) {
  const act = activity ?? it?.system?.activities?.values().next().value ?? null;
  return {
    id,
    type,
    author: { id: "user1" },
    speaker: { scene: SCENE, actor: actor?.id ?? null, token: actor ? `tok-${actor.id}` : null },
    rolls,
    system: {
      activity: act ? { id: act.id, type: act.type, uuid: act.uuid } : undefined,
      item: it ? { id: it.id, type: it.type, uuid: it.uuid } : undefined,
      targets,
      ...system
    },
    flags: {}
  };
}
