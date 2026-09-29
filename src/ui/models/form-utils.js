/**
 * Small, dependency-free helpers to turn HTML form controls into plain objects.
 */

/**
 * Read named form controls into a flat `{ "a.b": value }` object.
 * Checkboxes → boolean, number/range → number ("" when empty), multi-selects → array.
 * @param {Iterable<{name?: string, type?: string, value?: string, checked?: boolean, disabled?: boolean, multiple?: boolean, selectedOptions?: Iterable<{value: string}>}>} elements
 */
export function readFormElements(elements) {
  const out = {};
  for (const el of elements ?? []) {
    if (!el?.name || el.disabled) continue;
    const type = String(el.type ?? "").toLowerCase();
    if (type === "button" || type === "submit" || type === "reset" || type === "file") continue;
    if (type === "checkbox") out[el.name] = !!el.checked;
    else if (type === "radio") {
      if (el.checked) out[el.name] = el.value;
    } else if (type === "number" || type === "range") {
      out[el.name] = el.value === "" || el.value == null ? "" : Number(el.value);
    } else if (el.multiple && el.selectedOptions) {
      out[el.name] = [...el.selectedOptions].map((o) => o.value);
    } else out[el.name] = el.value ?? "";
  }
  return out;
}

/** Expand `{ "a.b": 1 }` into `{ a: { b: 1 } }`. */
export function expandFlat(flat) {
  const out = {};
  for (const [key, value] of Object.entries(flat ?? {})) {
    const parts = key.split(".");
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
      node = node[part];
    }
    node[parts.at(-1)] = value;
  }
  return out;
}

/** Deep clone of plain JSON data. */
export function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** True for null/undefined/""/empty object/empty array. */
export function isEmptyValue(value) {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** Copy of an object without empty values (shallow). */
export function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) if (!isEmptyValue(v)) out[k] = v;
  return out;
}

/** Pretty JSON for a textarea ("" for empty values). */
export function toJsonText(value) {
  return isEmptyValue(value) ? "" : JSON.stringify(value, null, 2);
}

/**
 * Parse a JSON textarea value.
 * @returns {{value: any, error: string|null}}
 */
export function parseJsonText(text) {
  const str = String(text ?? "").trim();
  if (!str) return { value: undefined, error: null };
  try {
    return { value: JSON.parse(str), error: null };
  } catch (err) {
    return { value: undefined, error: err.message };
  }
}

/** Split a comma/whitespace separated list into trimmed, non-empty lower-case strings. */
export function parseList(text, { lower = true } = {}) {
  if (Array.isArray(text)) return text.map(String).filter(Boolean);
  return String(text ?? "")
    .split(",")
    .map((s) => (lower ? s.trim().toLowerCase() : s.trim()))
    .filter(Boolean);
}
