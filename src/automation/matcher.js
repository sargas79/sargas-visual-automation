/**
 * Rule matching against ItemDescriptors. Pure and deterministic:
 * enabled rules are ordered by priority (desc), then specificity (desc), then
 * their original order; the first rule whose every criterion matches wins.
 *
 * Criteria (all given ones must match):
 *   key, name, type, attackKind, weaponGroup, baseItem  string | string[] (any of, case-insensitive)
 *   regex                                     "pattern" | { pattern, flags } tested against the name (default flag "i")
 *   traits                                    string | string[] (all required)
 *   actorTraits                               string | string[] (all required; traits of the actor carrying the item:
 *                                             creature type such as "dragon", "undead", or "size:large")
 */
import { isPlainObject } from "./schema.js";

const lower = (v) => (v === null || v === undefined ? null : String(v).trim().toLowerCase());
const list = (v) => (Array.isArray(v) ? v : [v]).map(lower);

const SPECIFICITY = {
  key: 16,
  name: 8,
  baseItem: 6,
  regex: 4,
  weaponGroup: 2,
  traits: 2,
  actorTraits: 2,
  attackKind: 1,
  type: 1
};

export function specificity(match = {}) {
  let score = 0;
  for (const key of Object.keys(match)) {
    const weight = SPECIFICITY[key] ?? 0;
    score += key === "traits" || key === "actorTraits" ? weight * list(match[key]).length : weight;
  }
  return score;
}

function anyOf(label, expected, actual) {
  const wanted = list(expected);
  const got = lower(actual);
  return wanted.includes(got)
    ? { ok: true, reason: `${label} "${actual}" matches` }
    : { ok: false, reason: `${label} "${actual ?? ""}" is not ${wanted.map((w) => `"${w}"`).join(" or ")}` };
}

/**
 * @param {{match: object}} rule
 * @param {object} descriptors ItemDescriptors
 * @returns {{matched: boolean, reasons: string[]}}
 */
export function matchRule(rule, descriptors = {}) {
  const match = rule?.match ?? {};
  const reasons = [];
  let matched = Object.keys(match).length > 0;
  for (const [key, expected] of Object.entries(match)) {
    let result;
    switch (key) {
      case "key":
      case "name":
      case "type":
      case "attackKind":
      case "weaponGroup":
      case "baseItem":
        result = anyOf(key, expected, descriptors[key]);
        break;
      case "regex": {
        const pattern = isPlainObject(expected) ? expected.pattern : expected;
        const flags = isPlainObject(expected) ? (expected.flags ?? "i") : "i";
        let ok;
        try {
          ok = new RegExp(pattern, flags).test(descriptors.name ?? "");
        } catch {
          ok = false;
        }
        result = {
          ok,
          reason: `name "${descriptors.name ?? ""}" ${ok ? "matches" : "does not match"} /${pattern}/${flags}`
        };
        break;
      }
      case "traits":
      case "actorTraits": {
        const have = new Set((descriptors[key] ?? []).map(lower));
        const missing = list(expected).filter((t) => !have.has(t));
        const label = key === "traits" ? "traits" : "actor traits";
        result = missing.length
          ? { ok: false, reason: `missing ${label} ${missing.join(", ")}` }
          : { ok: true, reason: `has ${label} ${list(expected).join(", ")}` };
        break;
      }
      default:
        result = { ok: false, reason: `unknown criterion "${key}"` };
    }
    reasons.push(result.reason);
    if (!result.ok) matched = false;
  }
  if (!Object.keys(match).length) reasons.push("rule has no criteria");
  return { matched, reasons };
}

/** Enabled rules in evaluation order. */
export function orderRules(rules = []) {
  return rules
    .map((rule, index) => ({ rule, index, score: specificity(rule.match) }))
    .filter(({ rule }) => rule.enabled !== false)
    .sort((a, b) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0) || b.score - a.score || a.index - b.index)
    .map(({ rule }) => rule);
}

/**
 * Evaluate rules in order.
 * @returns {{winner: {rule: object, reasons: string[]}|null, candidates: {rule: object, matched: boolean, reasons: string[]}[]}}
 */
export function findRule(rules, descriptors) {
  const candidates = orderRules(rules).map((rule) => ({ rule, ...matchRule(rule, descriptors) }));
  const winner = candidates.find((c) => c.matched) ?? null;
  return { winner, candidates };
}
