/**
 * `api.automation`: event handling, recipe resolution, per-item flags and preview.
 *
 * Resolution priority (first hit wins):
 *   1. item flag  flags["sargas-visual-automation"].recipe          source "item"
 *   2. world rules (setting automationRules)                          source "world"
 *   3. active system's rule pack (rules/<systemId>.json)              source "system"
 *   4. generic fallback from ItemDescriptors                          source "fallback"
 * flags["sargas-visual-automation"].disabled === true turns an item off.
 */
import { MODULE_ID } from "../constants.js";
import { log } from "../logger.js";
import { SystemAdapter } from "../shared/adapter.js";
import { EVENT_TYPES, OUTCOMES, createAutomationEvent } from "../shared/events.js";
import { compile } from "./compile.js";
import { fallbackRecipe } from "./fallback.js";
import { findRule } from "./matcher.js";
import { PRESETS, auraName, defaultTriggers } from "./presets.js";
import { checkRecipe, normalizeRecipe } from "./schema.js";

export const SETTING_ENABLED = "automationEnabled";
/** Events without an `id`: identical events within this window are dropped (double hooks, re-renders). */
export const DEDUPE_MS = 1000;
/** Events with an `id`: how many handled ids are remembered (oldest forgotten first). */
export const DEDUPE_IDS = 500;

/** Adapter-independent descriptors, used when no adapter is active. */
const genericAdapter = new SystemAdapter({});

/** Effective triggers of a recipe. */
export function triggersOf(recipe) {
  return recipe?.triggers?.length ? [...recipe.triggers] : defaultTriggers(recipe?.preset);
}

function flagsOf(item) {
  return item?.flags?.[MODULE_ID] ?? {};
}

function tokenIdOf(token) {
  if (!token) return null;
  if (typeof token === "string") return token;
  return token.document?.id ?? token.id ?? null;
}

function actorIdOf(token) {
  if (!token || typeof token === "string") return null;
  return token.actor?.id ?? token.document?.actorId ?? token.actorId ?? null;
}

/** VERIFY(v14): global fromUuid (also foundry.utils.fromUuid). */
async function resolveUuid(uuid) {
  const fn = globalThis.fromUuid ?? globalThis.foundry?.utils?.fromUuid;
  if (!uuid || typeof fn !== "function") return null;
  try {
    return await fn(uuid);
  } catch (err) {
    log.debug(`Could not resolve ${uuid}`, err);
    return null;
  }
}

function dedupeKey(event) {
  const targets = (event.targets ?? [])
    .map((t) => `${t.tokenId}:${t.outcome ?? ""}`)
    .sort()
    .join(",");
  return [
    event.type,
    event.itemUuid,
    event.source?.tokenId,
    event.source?.actorId,
    targets,
    event.outcome,
    event.effectUuid,
    event.area?.documentUuid
  ].join("|");
}

/**
 * @param {object} api   the shared module api
 * @param {ReturnType<import("./rules.js").createRulesStore>} rules
 */
export function createAutomation(api, rules) {
  const recent = new Map();
  const seenIds = new Set();

  /** Same id → duplicate, whatever the delay. No id → identical event within DEDUPE_MS. */
  function isDuplicate(event) {
    if (event.id !== null && event.id !== undefined && event.id !== "") {
      const id = `${event.systemId ?? ""}|${event.id}`;
      if (seenIds.has(id)) return true;
      seenIds.add(id);
      if (seenIds.size > DEDUPE_IDS) seenIds.delete(seenIds.values().next().value);
      return false;
    }
    const now = Date.now();
    for (const [key, at] of recent) if (now - at > DEDUPE_MS) recent.delete(key);
    const key = dedupeKey(event);
    if (recent.has(key)) return true;
    recent.set(key, now);
    return false;
  }

  function descriptorsFor(item, given) {
    if (given) return given;
    const adapter = api.systems?.active ?? genericAdapter;
    try {
      return adapter.getItemDescriptors(item);
    } catch (err) {
      log.warn("getItemDescriptors failed", err);
      return genericAdapter.getItemDescriptors(item);
    }
  }

  function enabled() {
    try {
      return game.settings.get(MODULE_ID, SETTING_ENABLED) !== false;
    } catch {
      return true;
    }
  }

  /**
   * Full resolution trace.
   * @param {object|null} item
   * @param {{eventType?: string, descriptors?: object, area?: object}} [opts]
   */
  function explain(item, { eventType, descriptors, area } = {}) {
    const d = descriptorsFor(item, descriptors);
    const trace = { descriptors: d, disabled: false, result: null, candidates: [], reasons: [] };
    const finish = (result) => {
      if (result) {
        const triggers = triggersOf(result.recipe);
        result.triggers = triggers;
        result.triggered = !eventType || triggers.includes(eventType);
        if (!result.triggered) trace.reasons.push(`recipe does not trigger on "${eventType}" (${triggers.join(", ")})`);
      }
      trace.result = result;
      return trace;
    };

    if (flagsOf(item).disabled === true) {
      trace.disabled = true;
      trace.reasons.push("automation disabled on this item");
      return finish(null);
    }

    const flagRecipe = flagsOf(item).recipe;
    if (flagRecipe) {
      const { recipe, errors } = checkRecipe(flagRecipe);
      trace.candidates.push({
        source: "item",
        ruleId: null,
        matched: !!recipe,
        reasons: recipe ? ["item flag"] : errors
      });
      if (recipe) {
        trace.reasons.push("item has its own recipe");
        return finish({ recipe, source: "item", ruleId: null, reason: "item flag" });
      }
      trace.reasons.push(`item recipe is invalid: ${errors.join("; ")}`);
    }

    const all = rules.all();
    for (const source of ["world", "system"]) {
      const { winner, candidates } = findRule(
        all.filter((r) => r.source === source),
        d
      );
      for (const c of candidates) {
        trace.candidates.push({
          source,
          ruleId: c.rule.id,
          label: c.rule.label,
          priority: c.rule.priority,
          matched: c.matched,
          reasons: c.reasons
        });
      }
      if (winner) {
        const reason = `${source} rule "${winner.rule.label}": ${winner.reasons.join(", ")}`;
        trace.reasons.push(reason);
        return finish({ recipe: winner.rule.recipe, source, ruleId: winner.rule.id, reason });
      }
    }

    const fb = fallbackRecipe(d, { eventType, area });
    trace.candidates.push({
      source: "fallback",
      ruleId: null,
      matched: !!fb,
      reasons: [fb?.reason ?? "no generic match"]
    });
    if (fb) {
      trace.reasons.push(`generic fallback: ${fb.reason}`);
      return finish({ recipe: normalizeRecipe(fb.recipe), source: "fallback", ruleId: null, reason: fb.reason });
    }
    trace.reasons.push("no recipe found");
    return finish(null);
  }

  /**
   * @returns {{recipe: object, source: string, ruleId: string|null, reason: string}|null}
   *   null when disabled, unmatched, or (with eventType) when the recipe does not trigger on it.
   */
  function resolveRecipe(item, opts = {}) {
    const { result } = explain(item, opts);
    if (!result || !result.triggered) return null;
    const { recipe, source, ruleId, reason } = result;
    return { recipe, source, ruleId, reason };
  }

  async function playAll(sequences, options) {
    if (typeof api.playSequence !== "function") {
      log.warn("api.playSequence is not available; cannot play automation");
      return false;
    }
    for (const seq of sequences) await api.playSequence(seq, options);
    return sequences.length > 0;
  }

  function effectExists(name) {
    try {
      const found = api.effects?.list?.({ name });
      return Array.isArray(found) && found.length > 0;
    } catch {
      return false;
    }
  }

  async function endAura(event) {
    const name = auraName(event);
    if (!api.effects?.end) return false;
    if (api.effects.list && !effectExists(name)) return false;
    log.debug(`Ending ${name}`);
    await api.effects.end({ name });
    return true;
  }

  const automation = {
    presets: PRESETS,
    compile,

    /**
     * Entry point for adapters (ctx.emit). Resolves with true when something played.
     * @param {object} partial AutomationEvent
     */
    async handle(partial) {
      let event;
      try {
        event = createAutomationEvent(partial);
      } catch (err) {
        log.warn(err.message);
        return false;
      }
      if (event.userId !== game.user?.id) return false;
      if (!enabled()) return false;
      if (isDuplicate(event)) {
        log.debug("Duplicate automation event dropped", event);
        return false;
      }

      const item = await resolveUuid(event.itemUuid);
      if (!item && !event.descriptors) {
        log.debug("Automation event without item or descriptors", event);
        return false;
      }
      event = { ...event, descriptors: descriptorsFor(item, event.descriptors) };

      if (event.type === EVENT_TYPES.EFFECT_REMOVED) return endAura(event);

      const resolved = resolveRecipe(item, { eventType: event.type, descriptors: event.descriptors, area: event.area });
      if (!resolved) {
        log.debug(`No recipe for "${event.descriptors?.name}" on ${event.type}`);
        return false;
      }
      log.debug(`Recipe for "${event.descriptors?.name}" (${event.type}): ${resolved.reason}`);
      if (resolved.recipe.preset === "aura" && effectExists(auraName(event))) return false;

      let sequences;
      try {
        sequences = compile(resolved.recipe, event);
      } catch (err) {
        log.error(`Could not compile recipe (${resolved.reason})`, err);
        return false;
      }
      return playAll(sequences);
    },

    resolveRecipe,
    explain,

    /**
     * Play a recipe locally only (no broadcast, nothing persisted).
     * @param {object} recipe
     * @param {{sourceToken?: any, targetTokens?: any[], outcome?: string, area?: object, descriptors?: object, eventType?: string}} [opts]
     */
    async preview(recipe, { sourceToken, targetTokens = [], outcome, area = null, descriptors, eventType } = {}) {
      const normalized = normalizeRecipe(recipe);
      const event = createAutomationEvent({
        type: eventType ?? triggersOf(normalized)[0] ?? EVENT_TYPES.CAST,
        source: sourceToken ? { tokenId: tokenIdOf(sourceToken), actorId: actorIdOf(sourceToken) } : null,
        targets: targetTokens.map((t) => ({ tokenId: tokenIdOf(t) })).filter((t) => t.tokenId),
        outcome: outcome ?? OUTCOMES.SUCCESS,
        area,
        descriptors: descriptors ?? { key: "preview", name: "Preview", area: null }
      });
      const sequences = compile(normalized, event).map((seq) => ({
        ...seq,
        steps: seq.steps.map((step) => {
          if (step.type !== "effect" || !step.effect.persist) return step;
          const effect = { ...step.effect };
          delete effect.persist;
          delete effect.name;
          return { ...step, effect };
        })
      }));
      return playAll(sequences, { broadcast: false });
    },

    /** The item's own recipe (migrated), or null. */
    getItemRecipe(item) {
      const raw = flagsOf(item).recipe;
      if (!raw) return null;
      const { recipe, errors } = checkRecipe(raw);
      if (!recipe) log.warn(`Invalid recipe on item "${item?.name}": ${errors.join("; ")}`);
      return recipe;
    },

    /** Store (or clear with null) the item's own recipe. */
    async setItemRecipe(item, recipe) {
      if (recipe === null || recipe === undefined) return item.unsetFlag(MODULE_ID, "recipe");
      const normalized = normalizeRecipe(recipe);
      // setFlag merges objects; clear first so removed keys (stages, outcomes...) do not linger.
      // VERIFY(v14): alternatively update({"flags.<id>.==recipe": normalized}) (ForcedReplacement).
      if (flagsOf(item).recipe !== undefined) await item.unsetFlag(MODULE_ID, "recipe");
      return item.setFlag(MODULE_ID, "recipe", normalized);
    },

    /** Turn automation off (true) or back on (false) for one item. */
    async setItemDisabled(item, disabled) {
      return disabled ? item.setFlag(MODULE_ID, "disabled", true) : item.unsetFlag(MODULE_ID, "disabled");
    },

    /** True when automation is turned off for this item. */
    isItemDisabled(item) {
      return flagsOf(item).disabled === true;
    },

    rules
  };
  return automation;
}
