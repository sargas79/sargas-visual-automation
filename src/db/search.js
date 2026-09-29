/**
 * Ranked search over catalog units. Every query token must match a path segment
 * or label word (exact > prefix > substring). When nothing matches strictly, falls
 * back to a fuzzy subsequence match on the path so typos like "frbolt" still work.
 */

/** Splits text into lower-case words on dots, underscores, dashes and spaces. */
export function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[\s._\-/]+/)
    .filter((t) => t.length);
}

function haystack(node) {
  if (!node.searchWords) {
    const words = new Set([...tokenize(node.path).slice(1), ...tokenize(node.label)]);
    node.searchWords = [...words];
    node.searchText = node.path
      .slice(node.path.indexOf(".") + 1)
      .replace(/\./g, "_")
      .toLowerCase();
  }
  return node;
}

function tokenScore(token, words) {
  let best = 0;
  for (const word of words) {
    if (word === token) return 3;
    if (word.startsWith(token)) best = Math.max(best, 2);
    else if (word.includes(token)) best = Math.max(best, 1);
  }
  return best;
}

/** @returns {number} 0 when `query` is not a subsequence of `text`, higher = more compact match. */
export function fuzzyScore(query, text) {
  let qi = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) {
      if (first < 0) first = i;
      last = i;
      qi++;
    }
  }
  if (qi < query.length) return 0;
  return query.length / (last - first + 1);
}

/**
 * @param {object[]} units   Catalog nodes with `path` and `label`.
 * @param {string} query
 * @param {{limit?: number}} [options]
 * @returns {object[]} matching nodes, best first
 */
export function searchUnits(units, query, { limit = 50 } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const byScore = (a, b) => b.score - a.score || a.node.path.length - b.node.path.length;
  const phrase = tokens.join("_");
  let scored = [];
  for (const unit of units) {
    const node = haystack(unit);
    let score = 0;
    for (const token of tokens) {
      const s = tokenScore(token, node.searchWords);
      if (!s) {
        score = 0;
        break;
      }
      score += s;
    }
    if (!score) continue;
    if (node.searchText.includes(phrase)) score += 2;
    scored.push({ node, score });
  }
  if (!scored.length) {
    const compact = tokens.join("");
    for (const unit of units) {
      const node = haystack(unit);
      const score = fuzzyScore(compact, node.searchText.replace(/[._]/g, ""));
      if (score) scored.push({ node, score });
    }
  }
  scored.sort(byScore);
  return scored.slice(0, Math.max(0, limit)).map((s) => s.node);
}
