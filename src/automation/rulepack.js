/**
 * System rule pack loader. Fetches `adapter.rulePackUrl` (rules/<systemId>.json
 * by default), validates it (see rules/README.md and rules/rulepack.schema.json)
 * and installs its rules as the "system" tier of resolution, under world rules.
 */
import { log } from "../logger.js";
import { checkRulePack } from "./schema.js";

/** VERIFY(v14): foundry.utils.getRoute adds the server route prefix. */
function routed(url) {
  if (/^[a-z]+:\/\//i.test(url) || url.startsWith("/")) return url;
  return globalThis.foundry?.utils?.getRoute?.(url) ?? url;
}

/**
 * @param {import("../shared/adapter.js").SystemAdapter|null} adapter
 * @param {ReturnType<import("./rules.js").createRulesStore>} rules
 * @param {{fetch?: typeof fetch}} [opts]
 * @returns {Promise<{loaded: number, errors: string[], url: string|null}>}
 */
export async function loadRulePack(adapter, rules, { fetch: fetchFn = globalThis.fetch } = {}) {
  rules.setSystemRules([], null);
  const url = adapter?.rulePackUrl ?? null;
  if (!adapter || !url) return { loaded: 0, errors: [], url: null };
  let data;
  try {
    const response = await fetchFn(routed(url));
    if (!response.ok) {
      if (response.status !== 404) log.warn(`Rule pack ${url}: HTTP ${response.status}`);
      else log.info(`No rule pack for "${adapter.id}" at ${url}`);
      return { loaded: 0, errors: [`HTTP ${response.status}`], url };
    }
    data = await response.json();
  } catch (err) {
    log.warn(`Could not load rule pack ${url}`, err);
    return { loaded: 0, errors: [err.message], url };
  }
  const { pack, errors } = checkRulePack(data);
  if (!pack) {
    log.warn(`Invalid rule pack ${url}: ${errors.join("; ")}`);
    return { loaded: 0, errors, url };
  }
  if (pack.system !== adapter.id) {
    errors.push(`pack is for "${pack.system}", active system is "${adapter.id}"`);
    log.warn(`Rule pack ${url} declares system "${pack.system}" but "${adapter.id}" is active`);
  }
  for (const e of errors) log.warn(`Rule pack ${url}: ${e}`);
  rules.setSystemRules(pack.rules, adapter.id);
  log.info(`Loaded ${pack.rules.length} automation rules for "${adapter.id}"`);
  return { loaded: pack.rules.length, errors, url };
}
