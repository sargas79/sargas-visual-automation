/**
 * Pure helpers for keeping the item recipe editor in sync with its item (#68).
 */

/** Stable JSON: object keys sorted, so key order never counts as a change. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = stable(value[key]);
    }
    return out;
  }
  return value;
}

/** Deep equality of two plain JSON values (recipes). `null` and `undefined` are equal. */
export function sameJson(a, b) {
  return JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null));
}

/**
 * Whether two references point at the same item document (uuid first, then id + parent).
 * @returns {boolean}
 */
export function isSameItem(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.uuid && b.uuid) return a.uuid === b.uuid;
  return !!a.id && a.id === b.id && (a.parent?.id ?? null) === (b.parent?.id ?? null);
}

/**
 * What the editor does when its item is updated elsewhere.
 * - "ignore":   another item, or our own save (which re-renders by itself)
 * - "reload":   no unsaved edits → reload the draft from the item and re-render
 * - "prompt":   unsaved edits → keep them and show an "item changed, reload?" notice
 * @param {{editing: object, updated: object, draft: any, baseline: any, saving?: boolean}} state
 * @returns {"ignore"|"reload"|"prompt"}
 */
export function itemUpdateAction({ editing, updated, draft, baseline, saving = false }) {
  if (saving || !isSameItem(editing, updated)) return "ignore";
  return sameJson(draft, baseline) ? "reload" : "prompt";
}
