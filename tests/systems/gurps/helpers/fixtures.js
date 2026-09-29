/**
 * Plain-object stand-ins for GURPS Game Aid (crnormand/gurps v0.18.23) actors, items and chat messages.
 *
 * Roll cards reproduce what GGA posts: templates/die-roll-chat-message.hbs rendered by dieroll.js#_doRoll, then
 * rewritten by the preCreateChatMessage hook in module/chat.js (gurpslink → `<span class='gga-app gurpslink'
 * data-action='<utoa(JSON)>' data-otf='...'>`). Damage cards carry flags.gurps.transfer (damagechat.js).
 */
export const SCENE = "scene1";

/** GGA lib/utilities.js#utoa */
export function utoa(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

let n = 0;
const key = () => String(n++).padStart(5, "0");

/** A GGA list object ({ "00000": entry, ... }). */
export function list(...entries) {
  return Object.fromEntries(entries.map((e) => [key(), { contains: {}, ...e }]));
}

export function mockToken(id, actor) {
  return { id, actor, document: { id, actorId: actor?.id } };
}

export function mockActor(id, { name = id, system = {}, items = [], tokenIds = [`tok-${id}`] } = {}) {
  const actor = {
    id,
    name,
    uuid: `Actor.${id}`,
    documentName: "Actor",
    system: { melee: {}, ranged: {}, spells: {}, skills: {}, ...system },
    items: new Map(items.map((i) => [i.id, i]))
  };
  for (const i of items) {
    i.parent = actor;
    i.uuid = `Actor.${id}.Item.${i.id}`;
  }
  actor.tokens = tokenIds.map((t) => mockToken(t, actor));
  actor.getActiveTokens = () => actor.tokens;
  return actor;
}

/** Install canvas, game.actors and user targets. */
export function installCanvas({ actors = [], targets = [] } = {}) {
  const placeables = actors.flatMap((a) => a.tokens);
  globalThis.canvas = {
    scene: { id: SCENE },
    tokens: { placeables, get: (id) => placeables.find((t) => t.id === id) }
  };
  globalThis.game.actors = new Map(actors.map((a) => [a.id, a]));
  globalThis.game.user.targets = new Set(targets.map((id) => placeables.find((t) => t.id === id) ?? { id }));
}

/** A hero with a broadsword, a bow, thrown knife, punch, spells and skills. */
export function hero() {
  const broadsword = {
    id: "eq-broadsword",
    name: "Broadsword",
    type: "equipment",
    system: { eqt: { name: "Broadsword" } }
  };
  return mockActor("hero", {
    items: [broadsword],
    system: {
      melee: list(
        {
          name: "Broadsword",
          mode: "Swing",
          damage: "2d+1 cut",
          level: 14,
          reach: "1",
          parry: "10",
          fromItem: "eq-broadsword"
        },
        {
          name: "Broadsword",
          mode: "Thrust",
          damage: "1d+2 cr",
          level: 14,
          reach: "1",
          parry: "10",
          fromItem: "eq-broadsword"
        },
        { name: "Punch", mode: "", damage: "1d-2 cr", level: 12, reach: "C" },
        { name: "Large Knife", mode: "Swing", damage: "1d-1 cut", level: 13, reach: "C,1" }
      ),
      ranged: list(
        { name: "Composite Bow", mode: "", damage: "1d+3 imp", level: 13, range: "20/25", rof: "1" },
        { name: "Large Knife", mode: "Thrown", damage: "1d-1 imp", level: 12, range: "8/15" },
        { name: "Fireball", mode: "", damage: "3d burn", level: 15, range: "25/50" },
        { name: "Pistol, .45", mode: "", damage: "2d pi+", level: 12, range: "175/1900", rof: "3", rcl: "3" }
      ),
      spells: list(
        { name: "Fireball", college: "Fire", class: "Missile", level: 15 },
        { name: "Minor Healing", college: "Healing", class: "Regular", level: 14 },
        { name: "Shield", college: "Protection and Warning", class: "Regular", level: 13 },
        { name: "Blink", college: "Movement/Gate", class: "Regular", level: 12 }
      ),
      skills: list({ name: "First Aid", level: 12 }, { name: "Stealth", level: 11 })
    }
  });
}

export function orc() {
  return mockActor("orc");
}

const OUTCOME_SPANS = {
  criticalSuccess: "<span class='crit success'>Critical Success!</span>",
  criticalFailure: "<span class='crit failure'>Critical Failure!</span>",
  failure: "<span class='failure'>Failure</span>",
  success: "<span class='success'>Success</span>"
};

/** gurpslink() output for an OtF (gspan in lib/otf-parser.ts). */
export function gspan(action, text = action.name) {
  return `<span class='gga-app gurpslink' data-action='${utoa(JSON.stringify(action))}' data-otf='${action.orig}'>${text}</span>`;
}

/**
 * A GGA die-roll card for a targeted roll.
 * @param {{actor: object, action?: object|null, otfOnly?: string, thing: string, outcome?: string, blind?: boolean,
 *          userId?: string, id?: string}} opts
 *   action: the decoded chatthing action (null for rolls made without an OtF)
 *   otfOnly: render the chatthing span without data-action (tests the data-otf fallback)
 */
export function rollMessage({
  actor,
  action = null,
  otfOnly = null,
  thing,
  outcome = "success",
  blind = false,
  userId = "user1",
  id
} = {}) {
  let chatthing = "";
  if (action) chatthing = gspan(action);
  else if (otfOnly) chatthing = `<span class='gga-app gurpslink' data-otf='${otfOnly}'>${thing}</span>`;
  const margin = `["Made it by 3"+3 margin for ${thing}]`;
  const marginSpan = gspan(
    { orig: `+3 margin for ${thing}`, type: "modifier", mod: "+3", desc: `margin for ${thing}` },
    margin
  );
  const followon =
    action?.type === "attack"
      ? gspan({
          orig: `@${actor.id}@D:"${thing}"`,
          type: "attackdamage",
          name: thing,
          isMelee: true,
          isRanged: true,
          sourceId: actor.id
        })
      : "";
  const content = `<div class='roll-message gga-chat-message'>
  <div class='prefix'>
    <div class='roll-result'>${chatthing}</div> (14)
  </div>
  <div class='roll-result'>
    <div>
      <span class='roll-value'>11</span>
      <span class='roll-detail'>
        ${OUTCOME_SPANS[outcome] ?? ""}
        <span class='aside'><div class='roll-result'>${marginSpan}</div></span>
      </span>
    </div>
    <div><hr />${followon ? `Damage: <div class='roll-result'>${followon}</div>` : ""}</div>
  </div>
</div>`;
  return {
    id: id ?? `msg${n++}`,
    author: { id: userId },
    blind,
    content,
    speaker: { actor: actor.id, token: actor.tokens?.[0]?.id ?? null, scene: SCENE, alias: actor.name },
    rolls: [{ formula: `3d6[${thing}]`, total: 11 }],
    flags: {}
  };
}

/** Build the decoded GGA attack action for an OtF like `M:"Broadsword (Swing)"`. */
export function attackAction(actor, prefix, name) {
  return {
    orig: `${prefix}:"${name}"`,
    type: "attack",
    name,
    isMelee: /[AM]/.test(prefix),
    isRanged: /[AR]/.test(prefix),
    sourceId: actor.id
  };
}

export function skillSpellAction(actor, prefix, name) {
  return {
    orig: `${prefix}:"${name}"`,
    type: "skill-spell",
    name,
    isSpellOnly: prefix === "Sp",
    isSkillOnly: prefix === "Sk",
    sourceId: actor.id,
    spantext: name
  };
}

/** A GGA damage card (damagechat.js#_createChatMessage). */
export function damageMessage({ actor, damageType = "cut", userTarget = null, userId = "user1", id } = {}) {
  return {
    id: id ?? `msg${n++}`,
    author: { id: userId },
    content: "<div class='damage-message'>...</div>",
    speaker: { actor: actor.id, token: actor.tokens?.[0]?.id ?? null, scene: SCENE },
    rolls: [{ formula: "2d6[Damage]+1", total: 8 }],
    flags: {
      gurps: {
        transfer: {
          type: "damageItem",
          payload: [{ attacker: actor.id, damageType, damage: 8, dice: "2d+1" }],
          userTarget
        }
      }
    }
  };
}
