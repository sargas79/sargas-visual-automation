/**
 * Converts the many ways a macro can name a place into a plain, JSON-safe
 * Anchor (see src/shared/descriptors.js).
 */

function isTokenDocument(value) {
  return value?.documentName === "Token";
}

function isTokenPlaceable(value) {
  return isTokenDocument(value?.document);
}

function isPoint(value) {
  return Number.isFinite(value?.x) && Number.isFinite(value?.y);
}

function cleanOffset(offset) {
  if (!offset) return undefined;
  if (!isPoint(offset)) throw new Error("Anchor offset must be {x, y}");
  return { x: offset.x, y: offset.y };
}

/** Token id for a Token, TokenDocument, id string or `{tokenId}`; null otherwise. */
export function toTokenId(value) {
  if (typeof value === "string" && value) return value;
  if (isTokenPlaceable(value)) return value.document.id;
  if (isTokenDocument(value)) return value.id;
  if (typeof value?.tokenId === "string") return value.tokenId;
  return null;
}

/**
 * @param {*} value  Token | TokenDocument | token id | {x, y} | Anchor
 * @param {{offset?: {x:number, y:number}}} [options]  Extra pixel offset (overrides the anchor's own).
 * @returns {import("../shared/descriptors.js").Anchor}
 */
export function toAnchor(value, { offset } = {}) {
  let anchor;
  const tokenId = toTokenId(value);
  if (tokenId) anchor = { tokenId };
  else if (isPoint(value)) anchor = { x: value.x, y: value.y };
  else throw new Error(`Cannot use ${JSON.stringify(value)} as an anchor`);
  const off = cleanOffset(offset ?? (typeof value === "object" ? value.offset : undefined));
  if (off) anchor.offset = off;
  return anchor;
}

/** User ids from User documents or ids. */
export function toUserIds(users) {
  return [users]
    .flat()
    .filter((u) => u !== undefined && u !== null)
    .map((u) => (typeof u === "string" ? u : u.id))
    .filter((id) => typeof id === "string" && id);
}
