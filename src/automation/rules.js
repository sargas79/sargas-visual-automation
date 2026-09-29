/**
 * Rule storage: world rules (world setting `automationRules`) and the active
 * system's rule pack. `api.automation.rules`.
 *
 * World rules shadow system rules with the same id, so a GM can override or
 * disable (enabled: false) a default rule by saving a rule with its id.
 */
import { MODULE_ID } from "../constants.js";
import { randomId } from "../shared/descriptors.js";
import { log } from "../logger.js";
import { RULEPACK_VERSION, RecipeError, isPlainObject, normalizeRule } from "./schema.js";

export const SETTING_RULES = "automationRules";

/** Default value of the world setting. */
export const EMPTY_RULES = Object.freeze({ version: RULEPACK_VERSION, rules: [] });

const clone = (v) => JSON.parse(JSON.stringify(v));

export function createRulesStore() {
  let systemRules = [];
  let systemId = null;

  function readRaw() {
    let value;
    try {
      value = game.settings.get(MODULE_ID, SETTING_RULES);
    } catch {
      return [];
    }
    if (Array.isArray(value)) return value;
    return Array.isArray(value?.rules) ? value.rules : [];
  }

  async function write(rules) {
    await game.settings.set(MODULE_ID, SETTING_RULES, { version: RULEPACK_VERSION, rules });
  }

  function worldRules() {
    const out = [];
    for (const raw of readRaw()) {
      try {
        out.push(normalizeRule(raw));
      } catch (err) {
        log.warn(`Ignoring invalid world rule: ${err.message}`);
      }
    }
    return out;
  }

  const store = {
    /** World rules (normalized copies). */
    list() {
      return worldRules();
    },

    /** Rules of the active system's pack (normalized copies). */
    systemRules() {
      return clone(systemRules);
    },

    /** Id of the system whose pack is loaded, or null. */
    get systemId() {
      return systemId;
    },

    /** Replace the system rule pack (called by the pack loader). */
    setSystemRules(rules, id = null) {
      systemRules = clone(rules ?? []);
      systemId = id;
    },

    /**
     * World + system rules as used by resolution, tagged with `source`.
     * System rules shadowed by a world rule with the same id are dropped.
     */
    all() {
      const world = worldRules().map((r) => ({ ...r, source: "world" }));
      const ids = new Set(world.map((r) => r.id));
      const system = systemRules.filter((r) => !ids.has(r.id)).map((r) => ({ ...clone(r), source: "system" }));
      return [...world, ...system];
    },

    /** Create or replace a world rule (by id). Returns the stored rule. GM only. */
    async save(rule) {
      const normalized = normalizeRule({ ...rule, id: rule?.id || randomId() });
      const rules = worldRules();
      const index = rules.findIndex((r) => r.id === normalized.id);
      if (index < 0) rules.push(normalized);
      else rules[index] = normalized;
      await write(rules);
      return clone(normalized);
    },

    /** Delete a world rule. Returns true when something was removed. GM only. */
    async delete(id) {
      const rules = worldRules();
      const next = rules.filter((r) => r.id !== id);
      if (next.length === rules.length) return false;
      await write(next);
      return true;
    },

    /** World rules as a RulePack JSON string. */
    exportJSON() {
      return JSON.stringify({ system: "world", version: RULEPACK_VERSION, rules: worldRules() }, null, 2);
    },

    /**
     * Import rules from a RulePack (or a bare array of rules), as JSON text or object.
     * Rules with an existing id replace it; others are appended.
     * @param {string|object} json
     * @param {{replace?: boolean}} [opts] replace: drop all current world rules first.
     * @returns {Promise<{imported: number, errors: string[]}>}
     */
    async importJSON(json, { replace = false } = {}) {
      let data = json;
      if (typeof json === "string") {
        try {
          data = JSON.parse(json);
        } catch (err) {
          throw new RecipeError("Invalid JSON", [err.message]);
        }
      }
      const incoming = Array.isArray(data)
        ? data
        : isPlainObject(data) && Array.isArray(data.rules)
          ? data.rules
          : null;
      if (!incoming) throw new RecipeError("Invalid rule pack", ["expected { rules: [...] } or an array of rules"]);
      if (isPlainObject(data) && data.version !== undefined && data.version !== RULEPACK_VERSION) {
        throw new RecipeError("Invalid rule pack", [`version must be ${RULEPACK_VERSION}`]);
      }
      const errors = [];
      const byId = new Map((replace ? [] : worldRules()).map((r) => [r.id, r]));
      let imported = 0;
      incoming.forEach((rule, i) => {
        try {
          const normalized = normalizeRule({ ...rule, id: rule?.id || randomId() });
          byId.set(normalized.id, normalized);
          imported += 1;
        } catch (err) {
          errors.push(`rules[${i}]: ${err.message}`);
        }
      });
      if (imported || replace) await write([...byId.values()]);
      return { imported, errors };
    }
  };
  return store;
}
