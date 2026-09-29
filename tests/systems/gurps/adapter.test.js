import { describe, expect, it, vi } from "vitest";
import { BUILTIN_ADAPTERS } from "../../../src/systems/index.js";
import { init as initAutomation } from "../../../src/automation/index.js";
import GurpsAdapter, { LAST_ATTACK_WINDOW_MS, SETTING_FAILED_CASTS } from "../../../src/systems/gurps/index.js";
import {
  actionsInContent,
  atou,
  outcomeFromChatdata,
  outcomeFromContent,
  parseOtf
} from "../../../src/systems/gurps/messages.js";
import { addHeaderButton, HOOK } from "../../../src/systems/gurps/sheet.js";
import { EVENT_TYPES, OUTCOMES } from "../../../src/shared/events.js";
import { resetFoundryMock } from "../../setup/foundry-mock.js";
import {
  attackAction,
  damageMessage,
  hero as makeHero,
  installCanvas,
  orc as makeOrc,
  rollMessage,
  skillSpellAction,
  utoa
} from "./helpers/fixtures.js";

function setup({ targets = ["tok-orc"] } = {}) {
  game.system.id = "gurps";
  const hero = makeHero();
  const orc = makeOrc();
  installCanvas({ actors: [hero, orc], targets });
  const emit = vi.fn();
  const adapter = new GurpsAdapter({ api: {}, emit });
  adapter.register();
  const send = (message, userId = game.user.id) => Hooks.callAll("createChatMessage", message, {}, userId);
  return { adapter, emit, hero, orc, send };
}

describe("GurpsAdapter skeleton", () => {
  it("is a built-in adapter active for the gurps system", () => {
    expect(BUILTIN_ADAPTERS).toContain(GurpsAdapter);
    expect(GurpsAdapter.id).toBe("gurps");
    expect(GurpsAdapter.isActive()).toBe(false);
    game.system.id = "gurps";
    expect(GurpsAdapter.isActive()).toBe(true);
    expect(new GurpsAdapter({}).rulePackUrl).toBe("modules/sargas-visual-automation/rules/gurps.json");
  });

  it("registers hooks once and unregisters them", () => {
    const { adapter } = setup();
    const count = Hooks._handlers.get("createChatMessage").length;
    adapter.register();
    expect(Hooks._handlers.get("createChatMessage").length).toBe(count);
    expect(Hooks._handlers.get(HOOK)?.length).toBe(1);
    Hooks.off = vi.fn();
    adapter.unregister();
    expect(Hooks.off).toHaveBeenCalledWith("createChatMessage", expect.any(Function));
    expect(Hooks.off).toHaveBeenCalledWith(HOOK, expect.any(Function));
  });

  it("registers its world setting only in GURPS worlds", () => {
    const id = `sargas-visual-automation.${SETTING_FAILED_CASTS}`;
    game.system.id = "gurps";
    initAutomation({});
    expect(game.settings._configs.get(id)).toMatchObject({ scope: "world", config: true, svaGroup: "systems" });
    resetFoundryMock();
    initAutomation({});
    expect(game.settings._configs.has(id)).toBe(false);
  });
});

describe("GGA chat card parsing", () => {
  it("decodes utoa() base64 including non-ASCII names", () => {
    expect(atou(utoa('{"name":"Épée"}'))).toBe('{"name":"Épée"}');
  });

  it("reads the outcome spans of die-roll-chat-message.hbs", () => {
    expect(outcomeFromContent("<span class='crit success'>x</span>")).toBe(OUTCOMES.CRITICAL_SUCCESS);
    expect(outcomeFromContent('<span class="crit failure">x</span>')).toBe(OUTCOMES.CRITICAL_FAILURE);
    expect(outcomeFromContent("<span class='failure'>x</span>")).toBe(OUTCOMES.FAILURE);
    expect(outcomeFromContent("<span class='success'>x</span>")).toBe(OUTCOMES.SUCCESS);
    expect(outcomeFromContent("<div>no roll</div>")).toBeNull();
    expect(outcomeFromChatdata({ isCritSuccess: false, isCritFailure: false, failure: true })).toBe(OUTCOMES.FAILURE);
    expect(outcomeFromChatdata({ isCritSuccess: true })).toBe(OUTCOMES.CRITICAL_SUCCESS);
  });

  it("parses OtF strings when data-action is missing", () => {
    expect(parseOtf("@hero@M:&quot;Broadsword&quot; (Swing)")).toMatchObject({
      type: "attack",
      name: "Broadsword (Swing)",
      isMelee: true,
      isRanged: false,
      sourceId: "hero"
    });
    expect(parseOtf('!R:"Composite Bow"')).toMatchObject({ type: "attack", isMelee: false, isRanged: true });
    expect(parseOtf('Sp:"Fireball"')).toMatchObject({ type: "skill-spell", name: "Fireball", isSpellOnly: true });
    expect(parseOtf('P:"Broadsword"')).toMatchObject({ type: "weapon-parry" });
    expect(parseOtf("+3 bonus")).toBeNull();
  });

  it("lists the GGA actions of a card in order", () => {
    const hero = makeHero();
    const msg = rollMessage({
      actor: hero,
      action: attackAction(hero, "M", "Broadsword (Swing)"),
      thing: "Broadsword"
    });
    expect(actionsInContent(msg.content).map((a) => a.type)).toEqual(["attack", "modifier", "attackdamage"]);
  });
});

describe("GURPS attack rolls → ATTACK", () => {
  it.each([
    ["success", OUTCOMES.SUCCESS],
    ["criticalSuccess", OUTCOMES.CRITICAL_SUCCESS],
    ["failure", OUTCOMES.FAILURE],
    ["criticalFailure", OUTCOMES.CRITICAL_FAILURE]
  ])("a melee attack %s", (outcome, expected) => {
    const { emit, hero, send } = setup();
    const msg = rollMessage({
      actor: hero,
      action: attackAction(hero, "M", "Broadsword (Swing)"),
      thing: "Broadsword",
      outcome
    });
    send(msg);
    expect(emit).toHaveBeenCalledTimes(1);
    const event = emit.mock.calls[0][0];
    expect(event).toMatchObject({
      id: `${msg.id}:attack`,
      type: EVENT_TYPES.ATTACK,
      source: { tokenId: "tok-hero", actorId: "hero" },
      targets: [{ tokenId: "tok-orc", outcome: expected }],
      outcome: expected,
      itemUuid: "Actor.hero.Item.eq-broadsword",
      userId: game.user.id
    });
    expect(event.descriptors).toMatchObject({
      name: "Broadsword",
      key: "broadsword",
      type: "weapon",
      attackKind: "melee",
      weaponGroup: "sword",
      damageTypes: ["slashing"]
    });
    expect(event.descriptors.traits).toEqual(expect.arrayContaining(["cut", "swing"]));
  });

  it("resolves the attack mode (thrust = crushing)", () => {
    const { emit, hero, send } = setup();
    send(rollMessage({ actor: hero, action: attackAction(hero, "M", "Broadsword (Thrust)"), thing: "Broadsword" }));
    expect(emit.mock.calls[0][0].descriptors.damageTypes).toEqual(["bludgeoning"]);
  });

  it("a ranged bow attack", () => {
    const { emit, hero, send } = setup();
    send(rollMessage({ actor: hero, action: attackAction(hero, "R", "Composite Bow"), thing: "Composite Bow" }));
    expect(emit.mock.calls[0][0].descriptors).toMatchObject({
      attackKind: "ranged",
      weaponGroup: "bow",
      range: 25,
      damageTypes: ["piercing"]
    });
  });

  it("a thrown knife from the ranged list, and A: finds the melee usage first", () => {
    const { emit, hero, send } = setup();
    send(rollMessage({ actor: hero, action: attackAction(hero, "R", "Large Knife (Thrown)"), thing: "Large Knife" }));
    expect(emit.mock.calls[0][0].descriptors).toMatchObject({ attackKind: "thrown", weaponGroup: "knife" });
    send(rollMessage({ actor: hero, action: attackAction(hero, "A", "Large Knife"), thing: "Large Knife" }));
    expect(emit.mock.calls[1][0].descriptors).toMatchObject({ attackKind: "melee", weaponGroup: "knife" });
  });

  it("a missile spell thrown as an attack is a spell-flavoured ranged attack", () => {
    const { emit, hero, send } = setup();
    send(rollMessage({ actor: hero, action: attackAction(hero, "R", "Fireball"), thing: "Fireball" }));
    const d = emit.mock.calls[0][0].descriptors;
    expect(d).toMatchObject({ type: "weapon", attackKind: "ranged", damageTypes: ["fire"] });
    expect(d.traits).toEqual(expect.arrayContaining(["burn", "spell"]));
  });

  it("uses GURPS.findAttack when the system exposes it", () => {
    const { emit, hero, send } = setup();
    globalThis.GURPS = { findAttack: vi.fn((sys, name, melee) => (melee ? (sys.melee["00000"] ?? null) : null)) };
    try {
      send(rollMessage({ actor: hero, action: attackAction(hero, "M", "Broad*"), thing: "Broadsword" }));
      expect(globalThis.GURPS.findAttack).toHaveBeenCalledWith(hero.system, "Broad*", true, false);
      expect(emit.mock.calls[0][0].descriptors.name).toBe("Broadsword");
    } finally {
      delete globalThis.GURPS;
    }
  });

  it("only attaches the outcome to the target when there is one target", () => {
    const { emit, hero, send } = setup({ targets: ["tok-orc", "tok-hero"] });
    send(rollMessage({ actor: hero, action: attackAction(hero, "M", "Punch"), thing: "Punch" }));
    expect(emit.mock.calls[0][0].targets).toEqual([{ tokenId: "tok-orc" }, { tokenId: "tok-hero" }]);
  });

  it("hides the outcome of blind rolls", () => {
    const { emit, hero, send } = setup();
    send(
      rollMessage({
        actor: hero,
        action: attackAction(hero, "M", "Punch"),
        thing: "Punch",
        blind: true,
        outcome: "criticalSuccess"
      })
    );
    expect(emit.mock.calls[0][0].outcome).toBe(OUTCOMES.NONE);
  });

  it("falls back to data-otf, then to the 3d6[thing] flavor", () => {
    const { emit, hero, send } = setup();
    send(rollMessage({ actor: hero, otfOnly: "@hero@R:&quot;Composite Bow&quot;", thing: "Composite Bow" }));
    expect(emit.mock.calls[0][0].descriptors).toMatchObject({ name: "Composite Bow", attackKind: "ranged" });
    send(rollMessage({ actor: hero, thing: "Punch" }));
    expect(emit.mock.calls[1][0]).toMatchObject({ type: EVENT_TYPES.ATTACK, descriptors: { weaponGroup: "brawling" } });
  });

  it("uses the @actorId@ source when a GM rolls from another speaker", () => {
    const { emit, hero, orc, send } = setup();
    const msg = rollMessage({ actor: orc, action: attackAction(hero, "M", "Broadsword (Swing)"), thing: "Broadsword" });
    msg.speaker = { actor: null, token: null, scene: "scene1" };
    send(msg);
    expect(emit.mock.calls[0][0].source).toEqual({ tokenId: "tok-hero", actorId: "hero" });
  });
});

describe("GURPS spells and healing", () => {
  it("a spell roll → CAST with the spell descriptors", () => {
    const { emit, hero, send } = setup();
    const msg = rollMessage({ actor: hero, action: skillSpellAction(hero, "Sp", "Fireball"), thing: "Fireball" });
    send(msg);
    expect(emit.mock.calls[0][0]).toMatchObject({
      id: `${msg.id}:cast`,
      type: EVENT_TYPES.CAST,
      outcome: OUTCOMES.SUCCESS,
      targets: [{ tokenId: "tok-orc" }],
      descriptors: { name: "Fireball", key: "fireball", type: "spell", attackKind: null, damageTypes: ["fire"] }
    });
    expect(emit.mock.calls[0][0].descriptors.traits).toEqual(expect.arrayContaining(["spell", "fire", "missile"]));
  });

  it("S: resolves to a spell when the actor knows one by that name", () => {
    const { emit, hero, send } = setup();
    send(rollMessage({ actor: hero, action: skillSpellAction(hero, "S", "Blink"), thing: "Blink" }));
    expect(emit.mock.calls[0][0]).toMatchObject({ type: EVENT_TYPES.CAST, descriptors: { key: "blink" } });
  });

  it("a healing spell → HEALING only (never CAST too), on the caster when nobody is targeted", () => {
    const { emit, hero, send } = setup({ targets: [] });
    send(rollMessage({ actor: hero, action: skillSpellAction(hero, "Sp", "Minor Healing"), thing: "Minor Healing" }));
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({
      type: EVENT_TYPES.HEALING,
      targets: [{ tokenId: "tok-hero" }],
      descriptors: { isHealing: true }
    });
    expect(emit.mock.calls[0][0].descriptors.traits).toContain("healing");
  });

  it("First Aid → HEALING; other skills are ignored", () => {
    const { emit, hero, send } = setup();
    send(rollMessage({ actor: hero, action: skillSpellAction(hero, "Sk", "First Aid"), thing: "First Aid" }));
    send(rollMessage({ actor: hero, action: skillSpellAction(hero, "Sk", "Stealth"), thing: "Stealth" }));
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({
      type: EVENT_TYPES.HEALING,
      descriptors: { type: "action", isHealing: true }
    });
  });

  it("skips failed casts when the world setting is off", async () => {
    const { emit, hero, send } = setup();
    initAutomation({});
    await game.settings.set("sargas-visual-automation", SETTING_FAILED_CASTS, false);
    send(
      rollMessage({ actor: hero, action: skillSpellAction(hero, "Sp", "Shield"), thing: "Shield", outcome: "failure" })
    );
    expect(emit).not.toHaveBeenCalled();
    // Failed attacks still animate (as misses).
    send(rollMessage({ actor: hero, action: attackAction(hero, "M", "Punch"), thing: "Punch", outcome: "failure" }));
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe("GURPS damage rolls → DAMAGE", () => {
  it("describes the damage as the actor's last attack", () => {
    const { emit, hero, send } = setup();
    send(rollMessage({ actor: hero, action: attackAction(hero, "M", "Broadsword (Swing)"), thing: "Broadsword" }));
    const msg = damageMessage({ actor: hero, damageType: "cut", userTarget: "tok-orc" });
    send(msg);
    expect(emit.mock.calls[1][0]).toMatchObject({
      id: `${msg.id}:damage`,
      type: EVENT_TYPES.DAMAGE,
      source: { actorId: "hero", tokenId: "tok-hero" },
      targets: [{ tokenId: "tok-orc" }],
      outcome: OUTCOMES.NONE,
      itemUuid: "Actor.hero.Item.eq-broadsword",
      descriptors: { name: "Broadsword", weaponGroup: "sword", damageTypes: ["slashing"] }
    });
  });

  it("uses generic damage descriptors when no recent attack exists", () => {
    const { adapter, emit, hero, send } = setup({ targets: [] });
    send(rollMessage({ actor: hero, action: attackAction(hero, "M", "Punch"), thing: "Punch" }));
    adapter._lastAttacks.get("hero").at -= LAST_ATTACK_WINDOW_MS + 1;
    send(damageMessage({ actor: hero, damageType: "burn" }));
    expect(emit.mock.calls[1][0]).toMatchObject({
      type: EVENT_TYPES.DAMAGE,
      itemUuid: null,
      targets: [],
      descriptors: { name: "burn damage", key: "burn-damage", type: "other", damageTypes: ["fire"], traits: ["burn"] }
    });
  });
});

describe("GURPS emission rules", () => {
  it("only the user who created the message emits, once per message", () => {
    const { emit, hero, send } = setup();
    const msg = rollMessage({ actor: hero, action: attackAction(hero, "M", "Punch"), thing: "Punch" });
    send(msg, "someone-else");
    expect(emit).not.toHaveBeenCalled();
    send(msg);
    send(msg);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("ignores defenses, attribute rolls and non-GGA messages", () => {
    const { emit, hero, send } = setup();
    const parry = { orig: 'P:"Broadsword"', type: "weapon-parry", name: "Broadsword", isMelee: true, sourceId: "hero" };
    send(rollMessage({ actor: hero, action: parry, thing: "Broadsword" }));
    const dodge = { orig: "Dodge", type: "attribute", name: "Dodge", path: "currentdodge", sourceId: "hero" };
    send(rollMessage({ actor: hero, action: dodge, thing: "Dodge" }));
    send({ id: "plain", content: "<p>Hello</p>", speaker: { actor: "hero" }, rolls: [], flags: {} });
    expect(emit).not.toHaveBeenCalled();
  });

  it("never throws on malformed messages", () => {
    const { emit, send } = setup();
    expect(() =>
      send({
        id: "bad",
        content: "<div class='roll-message'><span class='gurpslink' data-action='!!!'>x</span></div>",
        speaker: {}
      })
    ).not.toThrow();
    expect(() => send(null)).not.toThrow();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("GURPS item sheet header", () => {
  it("adds one Animation button for owners that opens the item config", () => {
    const openItemConfig = vi.fn();
    const api = { ui: { openItemConfig } };
    const item = { documentName: "Item", isOwner: true, name: "Broadsword" };
    const buttons = [];
    addHeaderButton(api, { document: item }, buttons);
    addHeaderButton(api, { document: item }, buttons);
    expect(buttons).toHaveLength(1);
    buttons[0].onclick();
    expect(openItemConfig).toHaveBeenCalledWith(item);

    game.user.isGM = false;
    const none = [];
    addHeaderButton(api, { document: { documentName: "Item", isOwner: false } }, none);
    expect(none).toHaveLength(0);
  });
});
