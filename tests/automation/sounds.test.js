import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { SOUND_NAMES, soundName, withDefaultSound } from "../../src/automation/sounds.js";

const weapon = (extra) => ({ type: "weapon", attackKind: "melee", traits: [], damageTypes: ["slashing"], ...extra });

describe("default sounds", () => {
  it("picks attack sounds by weapon group, damage type and natural family", () => {
    expect(soundName(weapon({ weaponGroup: "sword" }), { eventType: "attack" })).toBe("melee-slash");
    expect(soundName(weapon({ weaponGroup: "hammer" }), { eventType: "attack" })).toBe("melee-blunt");
    expect(soundName(weapon({ damageTypes: ["piercing"] }), { eventType: "attack" })).toBe("melee-pierce");
    expect(soundName(weapon({ weaponGroup: "natural", name: "Jaws" }), { eventType: "attack" })).toBe("bite");
    expect(soundName(weapon({ weaponGroup: "natural", name: "Claw" }), { eventType: "attack" })).toBe("claw");
    expect(soundName(weapon({ weaponGroup: "natural", name: "Tail" }), { eventType: "attack" })).toBe("melee-blunt");
    expect(soundName(weapon({ attackKind: "ranged", weaponGroup: "crossbow" }), { eventType: "attack" })).toBe(
      "crossbow"
    );
    expect(soundName(weapon({ attackKind: "thrown", weaponGroup: "knife" }), { eventType: "attack" })).toBe("throw");
  });

  it("criticals get the heavy variant, melee misses a whoosh, ranged misses the shot", () => {
    const bow = weapon({ attackKind: "ranged", weaponGroup: "bow" });
    expect(soundName(bow, { eventType: "attack", outcome: "criticalSuccess" })).toBe("crit-bow");
    expect(soundName(bow, { eventType: "attack", outcome: "failure" })).toBe("bow");
    expect(soundName(weapon(), { eventType: "attack", outcome: "criticalFailure" })).toBe("miss");
  });

  it("magic by energy, healing and buffs", () => {
    const spell = { type: "spell", attackKind: "ranged", traits: ["attack"], damageTypes: ["fire"] };
    expect(soundName(spell, { eventType: "attack" })).toBe("magic-fire");
    expect(soundName(spell, { eventType: "attack", outcome: "criticalSuccess" })).toBe("magic-fire");
    expect(soundName({ type: "spell", damageTypes: ["lightning"] }, { eventType: "cast" })).toBe("magic-electricity");
    expect(soundName({ type: "spell", damageTypes: ["bludgeoning"] }, { eventType: "areaPlaced" })).toBe("magic");
    expect(soundName({ type: "spell", isHealing: true }, { eventType: "cast" })).toBe("healing");
    expect(soundName({ type: "consumable" }, { eventType: "healing" })).toBe("healing");
    expect(soundName({ type: "effect", traits: [] }, { eventType: "effectApplied" })).toBe("buff");
    expect(soundName({ type: "condition", traits: [] }, { eventType: "effectApplied" })).toBeNull();
    expect(soundName(weapon(), { eventType: "effectRemoved" })).toBeNull();
  });

  it("fills a recipe's sound and outcome sounds, leaving explicit ones alone", () => {
    const recipe = { version: 1, preset: "melee", animation: "x" };
    const event = { type: "attack", descriptors: weapon({ weaponGroup: "sword" }) };
    const out = withDefaultSound(recipe, event, { folder: "worlds/w/sfx/" });
    expect(out.sound).toEqual({ file: "worlds/w/sfx/melee-slash.wav", volume: 0.6 });
    expect(out.outcomes.criticalSuccess.sound.file).toBe("worlds/w/sfx/crit-melee-slash.wav");
    expect(out.outcomes.failure.sound.file).toBe("worlds/w/sfx/miss.wav");
    expect(withDefaultSound({ ...recipe, sound: null }, event).sound).toBeNull();
    const own = { ...recipe, sound: { file: "mine.ogg" }, outcomes: { failure: { sound: { file: "m.ogg" } } } };
    expect(withDefaultSound(own, event)).toBe(own);
    expect(withDefaultSound(recipe, { type: "effectRemoved", descriptors: weapon() }).sound).toBeUndefined();
  });

  it("every sound the selection can name ships in sounds/", () => {
    const files = new Set(readdirSync("sounds").map((f) => f.replace(/\.wav$/, "")));
    for (const name of SOUND_NAMES) expect(files.has(name), name).toBe(true);
  });
});
