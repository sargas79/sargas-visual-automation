/**
 * Lookups in GGA actor data: attack / spell / skill entries by name, and the Item document behind an entry.
 *
 * Sources (crnormand/gurps, tag v0.18.23):
 *  - module/gurps.js#findAttack / findSkillSpell   name matching with an optional "(mode)" suffix, exposed on the
 *                                                  `GURPS` global; used first when available
 *  - lib/utilities.js#recurselist                  lists are objects keyed "00000"...; children in `contains` / `collapsed`
 *  - module/dierolls/dieroll.js#doRoll             `actor.items.get(entry.fromItem || entry.itemid)` is the Item behind
 *                                                  an attack / spell entry
 */
import { splitMode } from "./descriptors.js";

/** Visit every entry of a GGA list (depth first, like GGA's recurselist). */
export function walkList(list, fn) {
  if (!list || typeof list !== "object") return false;
  for (const value of Object.values(list)) {
    if (!value || typeof value !== "object") continue;
    if (fn(value) === true) return true;
    if (walkList(value.contains, fn) || walkList(value.collapsed, fn)) return true;
  }
  return false;
}

function lower(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

/** Name comparison: exact (case-insensitive), or a GGA "*" wildcard prefix ("Broad*"). */
function nameMatches(entryName, wanted) {
  const a = lower(entryName);
  const b = lower(wanted);
  if (!a || !b) return false;
  if (b.endsWith("*")) return a.startsWith(b.slice(0, -1));
  return a === b;
}

/** Find an entry of `list` by "Name" or "Name (Mode)". */
export function findInList(list, name) {
  const { name: bare, mode } = splitMode(name);
  let found = null;
  walkList(list, (e) => {
    const full = e.mode ? `${e.name} (${e.mode})` : e.name;
    const nameOk = nameMatches(e.name, bare) || nameMatches(e.originalName, bare);
    if ((nameOk && (!mode || lower(e.mode) === lower(mode))) || nameMatches(full, name)) {
      found = e;
      return true;
    }
    return false;
  });
  return found;
}

function gurpsGlobal() {
  return globalThis.GURPS ?? null;
}

/**
 * Find a melee/ranged attack entry.
 * @returns {{entry: object, list: "melee"|"ranged"}|null}
 */
export function findAttack(actor, name, { melee = true, ranged = true } = {}) {
  const sys = actor?.system;
  if (!sys || !name) return null;
  const G = gurpsGlobal();
  for (const list of ["melee", "ranged"]) {
    if ((list === "melee" && !melee) || (list === "ranged" && !ranged)) continue;
    let entry = null;
    if (typeof G?.findAttack === "function") {
      try {
        // VERIFY(gurps): GURPS.findAttack(actorOrSystem, name, isMelee, isRanged) (module/gurps.js)
        entry = G.findAttack(sys, name, list === "melee", list === "ranged") ?? null;
      } catch {
        entry = null;
      }
    }
    entry ??= findInList(sys[list], name);
    if (entry) return { entry, list };
  }
  return null;
}

export function findSpell(actor, name) {
  return actor?.system && name ? findInList(actor.system.spells, name) : null;
}

export function findSkill(actor, name) {
  return actor?.system && name ? findInList(actor.system.skills, name) : null;
}

/** Item document behind an entry (equipment for weapon attacks, spell item for spells), or null. */
export function itemForEntry(actor, entry) {
  const id = entry?.fromItem || entry?.itemid;
  if (!id || !actor?.items?.get) return null;
  try {
    return actor.items.get(id) ?? null;
  } catch {
    return null;
  }
}

/** Speaker actor of a message: the token's (synthetic) actor first, then the world actor. */
export function resolveActor({ actorId, tokenId, sceneId } = {}) {
  const G = globalThis;
  if (tokenId) {
    const token = G.canvas?.tokens?.get?.(tokenId) ?? G.canvas?.tokens?.placeables?.find?.((t) => t.id === tokenId);
    if (token?.actor) return token.actor;
    const scene = sceneId ? G.game?.scenes?.get?.(sceneId) : null;
    const doc = scene?.tokens?.get?.(tokenId);
    if (doc?.actor) return doc.actor;
  }
  return actorId ? (G.game?.actors?.get?.(actorId) ?? null) : null;
}

/** A token of `actor` on the viewed scene, or null. */
export function tokenIdForActor(actor, actorId = actor?.id) {
  const active = actor?.getActiveTokens?.(true, true)?.[0] ?? actor?.getActiveTokens?.()?.[0];
  if (active) return active.id ?? active.document?.id ?? null;
  if (!actorId) return null;
  const token = globalThis.canvas?.tokens?.placeables?.find?.((t) => (t.actor?.id ?? t.document?.actorId) === actorId);
  return token?.id ?? token?.document?.id ?? null;
}
