/**
 * Mock PF2e documents shaped like the real pf2e 8.x data (see src/systems/pf2e/*.js for the source files).
 * Only the fields the adapter reads are populated.
 */
export const SCENE = "scene1";

export function mockToken(id, actor) {
  return { id, document: { id, actorId: actor?.id ?? null }, actor };
}

export function mockActor(id, { name = id, tokenIds = [`tok-${id}`], items = [] } = {}) {
  const actor = {
    id,
    name,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    items: new Map(items.map((i) => [i.id, i]))
  };
  actor.tokens = tokenIds.map((t) => mockToken(t, actor));
  actor.getActiveTokens = () => actor.tokens;
  for (const i of items) i.parent = actor;
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
  for (const a of actors) for (const i of a.items.values()) byUuid.set(i.uuid, i);
  globalThis.fromUuidSync = (uuid) => byUuid.get(uuid) ?? null;
}

let n = 0;
function item(type, data) {
  n += 1;
  const id = data.id ?? `item${n}`;
  return {
    id,
    uuid: `Actor.hero.Item.${id}`,
    documentName: "Item",
    type,
    ...data,
    system: { slug: data.slug ?? null, rules: [], ...data.system }
  };
}

// --- Weapons (src/module/item/weapon/data.ts) ---------------------------------------------------
export const weapons = {
  longsword: () =>
    item("weapon", {
      name: "+1 Striking Longsword",
      slug: "longsword",
      system: {
        baseItem: "longsword",
        group: "sword",
        range: null,
        damage: { damageType: "slashing", dice: 2, die: "d8" },
        traits: { value: ["versatile-p"] }
      }
    }),
  shortbow: () =>
    item("weapon", {
      name: "Shortbow",
      slug: "shortbow",
      system: {
        baseItem: "shortbow",
        group: "bow",
        range: 60,
        damage: { damageType: "piercing", dice: 1, die: "d6" },
        traits: { value: ["deadly-d10"] }
      }
    }),
  /** Dagger as stored on the sheet (melee usage with thrown-10). */
  dagger: () =>
    item("weapon", {
      id: "dagger1",
      name: "Dagger",
      slug: "dagger",
      system: {
        baseItem: "dagger",
        group: "knife",
        range: null,
        damage: { damageType: "piercing", dice: 1, die: "d4" },
        traits: { value: ["agile", "finesse", "thrown-10", "versatile-s"] }
      }
    }),
  /** The thrown alt-usage clone (WeaponPF2e#toThrownUsage: range set, "thrown-10" → "thrown"). */
  daggerThrown: () => {
    const clone = weapons.dagger();
    clone.system.range = 10;
    clone.system.traits.value = ["agile", "finesse", "thrown", "versatile-s"];
    clone.altUsageType = "thrown";
    return clone;
  },
  /** In-memory basic unarmed strike (actor/character/document.ts). */
  fist: () =>
    item("weapon", {
      id: "xxPF2ExUNARMEDxx",
      name: "Unarmed Attack",
      slug: "basic-unarmed",
      system: {
        baseItem: null,
        category: "unarmed",
        group: "brawling",
        range: null,
        damage: { damageType: "bludgeoning", dice: 1, die: "d4" },
        traits: { value: ["agile", "finesse", "nonlethal", "unarmed"] }
      }
    })
};

// --- NPC attacks (src/module/item/melee/data.ts) -----------------------------------------------
export const npcAttacks = {
  jaws: () =>
    item("melee", {
      name: "Jaws",
      slug: "jaws",
      group: "brawling",
      baseType: "jaws",
      system: {
        range: null,
        damageRolls: { a: { damage: "2d8+4", damageType: "piercing", category: null } },
        traits: { value: ["unarmed", "reach-10"] }
      }
    }),
  claw: () =>
    item("melee", {
      name: "Claw",
      slug: "claw",
      system: {
        range: null,
        damageRolls: { a: { damage: "2d6+4", damageType: "slashing", category: null } },
        traits: { value: ["agile", "unarmed"] }
      }
    }),
  spear: () =>
    item("melee", {
      name: "Spear",
      slug: "spear",
      system: {
        range: { increment: 20, max: null },
        damageRolls: { a: { damage: "1d6+2", damageType: "piercing", category: null } },
        traits: { value: ["thrown-20"] }
      }
    })
};

// --- Spells (src/module/item/spell/data.ts) ----------------------------------------------------
const spell = (data) =>
  item("spell", {
    ...data,
    system: {
      area: null,
      defense: null,
      damage: {},
      duration: { value: "", sustained: false },
      range: { value: "30 feet" },
      ...data.system
    }
  });

export const spells = {
  fireball: () =>
    spell({
      name: "Fireball",
      slug: "fireball",
      system: {
        traits: { value: ["concentrate", "fire", "manipulate"], traditions: ["arcane", "primal"] },
        area: { type: "burst", value: 20 },
        defense: { save: { statistic: "reflex", basic: true } },
        damage: { 0: { formula: "6d6", type: "fire", kinds: ["damage"] } },
        range: { value: "500 feet" }
      }
    }),
  forceBarrage: () =>
    spell({
      name: "Force Barrage",
      slug: "force-barrage",
      system: {
        traits: { value: ["concentrate", "force", "manipulate"] },
        damage: { 0: { formula: "1d4+1", type: "force", kinds: ["damage"] } },
        range: { value: "120 feet" }
      }
    }),
  ignition: () =>
    spell({
      name: "Ignition",
      slug: "ignition",
      system: {
        traits: { value: ["attack", "cantrip", "concentrate", "fire", "manipulate"] },
        damage: { 0: { formula: "2d4", type: "fire", kinds: ["damage"] } },
        range: { value: "30 feet" }
      }
    }),
  electricArc: () =>
    spell({
      name: "Electric Arc",
      slug: "electric-arc",
      system: {
        traits: { value: ["cantrip", "concentrate", "electricity", "manipulate"] },
        defense: { save: { statistic: "reflex", basic: true } },
        damage: { 0: { formula: "2d4", type: "electricity", kinds: ["damage"] } }
      }
    }),
  breatheFire: () =>
    spell({
      name: "Breathe Fire",
      slug: "breathe-fire",
      system: {
        traits: { value: ["concentrate", "fire", "manipulate"] },
        area: { type: "cone", value: 15 },
        defense: { save: { statistic: "reflex", basic: true } },
        damage: { 0: { formula: "2d6", type: "fire", kinds: ["damage"] } },
        range: { value: "" }
      }
    }),
  lightningBolt: () =>
    spell({
      name: "Lightning Bolt",
      slug: "lightning-bolt",
      system: {
        traits: { value: ["concentrate", "electricity", "manipulate"] },
        area: { type: "line", value: 120 },
        defense: { save: { statistic: "reflex", basic: true } },
        damage: { 0: { formula: "4d12", type: "electricity", kinds: ["damage"] } },
        range: { value: "" }
      }
    }),
  heal: () =>
    spell({
      name: "Heal",
      slug: "heal",
      system: {
        traits: { value: ["healing", "manipulate", "vitality"] },
        damage: { 0: { formula: "1d8", type: "vitality", kinds: ["damage", "healing"] } },
        range: { value: "touch" }
      }
    }),
  harm: () =>
    spell({
      name: "Harm",
      slug: "harm",
      system: {
        traits: { value: ["manipulate", "void"] },
        damage: { 0: { formula: "1d8", type: "void", kinds: ["damage", "healing"] } },
        range: { value: "touch" }
      }
    }),
  sustained: () =>
    spell({
      name: "Tangle Vine",
      slug: "tangle-vine",
      system: {
        traits: { value: ["attack", "cantrip", "concentrate", "manipulate", "plant", "wood"] },
        duration: { value: "", sustained: true }
      }
    })
};

// --- Consumables / effects / conditions --------------------------------------------------------
export const consumables = {
  healingPotion: () =>
    item("consumable", {
      name: "Healing Potion (Minor)",
      slug: "healing-potion-minor",
      system: {
        category: "potion",
        damage: { formula: "1d8", type: "vitality", kind: "healing" },
        traits: { value: ["consumable", "healing", "magical", "potion", "vitality"] }
      }
    })
};

export const effects = {
  bless: () =>
    item("effect", {
      name: "Spell Effect: Bless",
      slug: "spell-effect-bless",
      system: {
        traits: { value: [] },
        rules: [{ key: "Aura", slug: "bless", radius: 15 }],
        context: {
          origin: { actor: "Actor.cleric", token: `Scene.${SCENE}.Token.tok-cleric`, item: null, rollOptions: [] },
          target: null,
          roll: null
        }
      }
    }),
  frightened: () =>
    item("condition", {
      name: "Frightened",
      slug: "frightened",
      system: { traits: { value: [] }, value: { value: 1 } }
    })
};

export const feats = {
  battleMedicine: () =>
    item("feat", {
      name: "Battle Medicine",
      slug: "battle-medicine",
      system: { traits: { value: ["general", "healing", "manipulate", "skill"] } }
    })
};

// --- Chat messages (src/module/chat-message/data.ts, system/check/check.ts, system/damage/damage.ts) ---
let m = 0;
/**
 * @param {object} o
 * @param {object} o.actor  speaker actor
 * @param {object} [o.item] resolved `message.item`
 * @param {object} [o.context] flags.pf2e.context
 * @param {object} [o.origin]  flags.pf2e.origin (defaults to item.getOriginData())
 * @param {object[]} [o.rolls]
 */
export function mockMessage({ actor, item = null, context, origin, rolls = [], author = "user1", blind = false }) {
  m += 1;
  const tokenId = actor?.tokens?.[0]?.id ?? null;
  const originFlag =
    origin === undefined
      ? item
        ? { actor: actor?.uuid, uuid: item.uuid, type: item.type, rollOptions: ["origin:item:slug:" + item.slug] }
        : null
      : origin;
  return {
    id: `msg${m}`,
    author: { id: author },
    blind,
    speaker: { scene: SCENE, actor: actor?.id ?? null, token: tokenId, alias: actor?.name },
    actor,
    item,
    rolls,
    flags: { pf2e: { ...(context ? { context } : {}), origin: originFlag } }
  };
}

export const tokenUuid = (id) => `Scene.${SCENE}.Token.${id}`;

/** flags.pf2e.context for a check (attack-roll / saving-throw / skill-check). */
export function checkContext(
  type,
  { outcome = "success", actor, target, origin, options = [], domains = [], ...rest }
) {
  return {
    type,
    actor: actor?.id ?? null,
    token: actor?.tokens?.[0]?.id ?? null,
    identifier: null,
    domains,
    options,
    origin: origin ? { actor: origin.uuid, token: tokenUuid(origin.tokens[0].id) } : null,
    target: target ? { actor: target.uuid, token: tokenUuid(target.tokens[0].id) } : null,
    outcome,
    unadjustedOutcome: outcome,
    isReroll: false,
    ...rest
  };
}

export function damageContext({ outcome = "success", actor, target = null, sourceType = "attack" }) {
  return {
    type: "damage-roll",
    sourceType,
    actor: actor?.id ?? null,
    token: actor?.tokens?.[0]?.id ?? null,
    target: target ? { actor: target.uuid, token: tokenUuid(target.tokens[0].id) } : null,
    domains: ["damage"],
    options: [],
    outcome
  };
}

export const damageRoll = (kinds = ["damage"], formula = "2d8+4[slashing]") => ({ formula, kinds: new Set(kinds) });
export const checkRoll = () => ({ formula: "1d20+9", total: 20 });
