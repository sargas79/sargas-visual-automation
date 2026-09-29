/**
 * Normalizes api.automation.resolveRecipe / explain results for display.
 * The contract fixes `{ recipe, source, ruleId, reason }`; the candidate list
 * of `explain` is read defensively (`candidates` | `rules` | `matches`).
 */

export const SOURCES = ["item", "world", "system", "fallback"];

/** Normalize one candidate (a Rule, or `{rule, matched, reason, source, score}`). */
function normalizeCandidate(candidate, ruleId) {
  const rule = candidate?.rule ?? candidate ?? {};
  const id = rule.id ?? candidate?.ruleId ?? null;
  const matched = candidate?.matched ?? candidate?.match ?? candidate?.matches ?? (id !== null && id === ruleId);
  return {
    id,
    label: rule.label ?? id ?? "?",
    source: candidate?.source ?? rule.source ?? "",
    priority: rule.priority ?? candidate?.priority ?? "",
    matched: !!matched,
    winner: id !== null && id === ruleId,
    reason: typeof candidate?.reason === "string" ? candidate.reason : "",
    cssClass:
      id !== null && id === ruleId
        ? "sva-candidate sva-winner"
        : matched
          ? "sva-candidate sva-matched"
          : "sva-candidate"
  };
}

/**
 * @param {object|null} result resolveRecipe()/explain() result
 * @returns {{found: boolean, source: string, sourceKey: string, ruleId: string|null, reason: string, preset: string, animation: string, candidates: object[]}}
 */
export function summarizeResolution(result) {
  if (!result || typeof result !== "object") {
    return {
      found: false,
      source: "",
      sourceKey: "SVA.UI.Source.none",
      ruleId: null,
      reason: "",
      preset: "",
      animation: "",
      candidates: []
    };
  }
  const list = result.candidates ?? result.rules ?? result.matches ?? [];
  const source = String(result.source ?? "");
  return {
    found: !!result.recipe,
    source,
    sourceKey: SOURCES.includes(source) ? `SVA.UI.Source.${source}` : "SVA.UI.Source.none",
    ruleId: result.ruleId ?? null,
    reason: typeof result.reason === "string" ? result.reason : "",
    preset: result.recipe?.preset ?? "",
    animation: result.recipe?.animation ?? "",
    candidates: Array.isArray(list) ? list.map((c) => normalizeCandidate(c, result.ruleId ?? null)) : []
  };
}
