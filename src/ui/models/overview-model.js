/**
 * Pure view-model helpers for the actor animation overview (#74): which items are listed, what
 * animation each one resolves to and why, grouping, filtering and the recipe saved by "Change".
 * No Foundry globals here; the app (src/ui/apps/actor-overview.js) passes everything in.
 */
import { cloneJson } from "./form-utils.js";
import { SOURCES } from "./explain-model.js";

/** Group order (ItemDescriptors.type values). Unknown types go to "other". */
export const GROUP_ORDER = ["spell", "weapon", "action", "feat", "consumable", "effect", "condition", "other"];

/** Row status filters of the toolbar select. */
export const FILTERS = ["all", "animated", "none", "item", "disabled"];

/**
 * Event types probed when `explain(item)` alone finds nothing: the generic fallback only answers
 * for a concrete event type, so we ask the way the adapter would for this kind of item.
 * @param {object|null} descriptors ItemDescriptors
 * @returns {string[]}
 */
export function probeEventTypes(descriptors) {
  const d = descriptors ?? {};
  const traits = (d.traits ?? []).map((t) => String(t).toLowerCase());
  const out = [];
  if (d.attackKind || traits.includes("thrown")) out.push("attack");
  if (d.area) out.push("areaPlaced");
  if (d.type === "effect" || d.type === "condition" || traits.includes("aura")) out.push("effectApplied");
  if (d.isHealing) out.push("healing");
  if (!out.length) out.push("attack", "areaPlaced", "effectApplied");
  return out;
}

/**
 * Resolve an item for display. `explain(item)` first (item recipe, world and system rules); when it
 * has no result, probe the event types the generic fallback answers to.
 * @param {(item: object, opts?: object) => object} explain api.automation.explain (bound)
 * @param {object} item
 * @returns {{trace: object, result: object|null, triggers: string[], eventType: string|null}}
 */
export function resolveForOverview(explain, item) {
  const trace = explain(item) ?? {};
  const base = { trace, result: null, triggers: [], eventType: null };
  if (trace.disabled) return base;
  if (trace.result?.recipe) {
    return { ...base, result: trace.result, triggers: [...(trace.result.triggers ?? [])] };
  }
  const found = [];
  for (const eventType of probeEventTypes(trace.descriptors)) {
    let probe;
    try {
      probe = explain(item, { eventType });
    } catch {
      continue;
    }
    if (probe?.result?.recipe && probe.result.triggered !== false) found.push({ probe, eventType });
  }
  if (!found.length) return base;
  const [first] = found;
  return {
    trace: first.probe,
    result: first.probe.result,
    triggers: found.map((f) => f.eventType),
    eventType: first.eventType
  };
}

/** Is `path` a JB2A database path (not a direct file URL)? */
function isDbPath(path) {
  return typeof path === "string" && path.length > 0 && !path.includes("/");
}

/**
 * Thumbnail and catalog status of an animation path.
 * @param {object|null} db api.db
 * @param {string} path
 * @returns {{thumbnail: string|null, missing: boolean}}
 */
export function animationThumbnail(db, path) {
  if (!path) return { thumbnail: null, missing: false };
  if (!isDbPath(path)) return { thumbnail: null, missing: false };
  if (!db?.available || typeof db.getEntry !== "function") return { thumbnail: null, missing: false };
  let entry;
  try {
    entry = db.getEntry(path);
  } catch {
    entry = null;
  }
  return { thumbnail: entry?.thumbnail ?? null, missing: !entry };
}

/**
 * One overview row.
 * @param {object} item Foundry Item (only id/uuid/name/img/type/flags are read)
 * @param {ReturnType<typeof resolveForOverview>} resolution
 * @param {{db?: object, presets?: object, hasOwnRecipe?: boolean}} [opts]
 */
export function buildRow(item, resolution, { db = null, presets = {}, hasOwnRecipe = false } = {}) {
  const { trace, result, triggers, eventType } = resolution;
  const d = trace?.descriptors ?? {};
  const recipe = result?.recipe ?? null;
  const source = recipe ? String(result.source ?? "") : "none";
  const type = GROUP_ORDER.includes(d.type) ? d.type : "other";
  const animation = recipe?.animation ?? "";
  const preset = recipe?.preset ?? "";
  const { thumbnail, missing } = animationThumbnail(db, animation);
  const disabled = trace?.disabled === true;
  const reason = typeof result?.reason === "string" ? result.reason : (trace?.reasons ?? []).join("; ");
  const row = {
    id: item?.id ?? null,
    uuid: item?.uuid ?? null,
    name: item?.name ?? d.name ?? "",
    img: item?.img ?? "",
    itemType: item?.type ?? "",
    type,
    disabled,
    hasOwnRecipe: !!hasOwnRecipe,
    found: !!recipe,
    source: disabled ? "disabled" : source,
    sourceKey: disabled
      ? "SVA.UI.Overview.Disabled"
      : SOURCES.includes(source)
        ? `SVA.UI.Source.${source}`
        : "SVA.UI.Source.none",
    ruleId: result?.ruleId ?? null,
    reason,
    preset,
    presetLabel: preset ? (presets?.[preset]?.label ?? preset) : "",
    animation,
    thumbnail,
    missing,
    triggers: [...(triggers ?? [])],
    triggerKeys: (triggers ?? []).map((id) => ({ id, labelKey: `SVA.UI.Recipe.Triggers.${id}` })),
    eventType: eventType ?? null,
    recipe: recipe ? cloneJson(recipe) : null,
    descriptors: d
  };
  row.search = searchText(row);
  row.view = rowView(row);
  return row;
}

/** Template-only strings (Handlebars can't put blocks inside attributes). */
export function rowView(row) {
  return {
    rowClass: ["sva-overview-row", row.disabled && "sva-row-disabled", !row.found && "sva-row-none"]
      .filter(Boolean)
      .join(" "),
    thumbClass: row.thumbnail ? "sva-overview-thumb" : "sva-overview-thumb sva-thumb-none",
    noPreview: !row.found,
    noReset: !row.hasOwnRecipe,
    pressed: row.disabled ? "true" : "false",
    toggleClass: row.disabled ? "sva-icon-button sva-active" : "sva-icon-button",
    toggleIcon: row.disabled ? "fa-toggle-off" : "fa-toggle-on",
    toggleTooltip: row.disabled ? "SVA.UI.Overview.Enable" : "SVA.UI.Overview.Disable"
  };
}

/** Lower-case text a query is matched against. */
export function searchText(row) {
  return [row.name, row.itemType, row.type, row.animation, row.preset, row.presetLabel, row.source, row.ruleId]
    .concat(row.triggers ?? [])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Every whitespace-separated query term appears in the text. */
export function matchesQuery(text, query) {
  const terms = String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const haystack = String(text ?? "").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/** Does a row pass the status filter? */
export function matchesFilter(row, filter = "all") {
  switch (filter) {
    case "animated":
      return row.found && !row.disabled;
    case "none":
      return !row.found && !row.disabled;
    case "item":
      return row.hasOwnRecipe;
    case "disabled":
      return row.disabled;
    default:
      return true;
  }
}

/**
 * Is the row worth listing? Items of an animatable kind, or with something to show.
 * `showAll` lists every item.
 */
export function isListed(row, { showAll = false } = {}) {
  return showAll || row.type !== "other" || row.found || row.hasOwnRecipe || row.disabled;
}

/**
 * Filter and group rows for the template, groups in GROUP_ORDER, rows by name.
 * @param {object[]} rows buildRow() results
 * @param {{query?: string, filter?: string, showAll?: boolean}} [state]
 * @returns {{id: string, labelKey: string, count: number, rows: object[]}[]}
 */
export function groupRows(rows, { query = "", filter = "all", showAll = false } = {}) {
  const groups = new Map(GROUP_ORDER.map((g) => [g, []]));
  for (const row of rows) {
    if (!isListed(row, { showAll })) continue;
    if (!matchesFilter(row, filter) || !matchesQuery(row.search, query)) continue;
    groups.get(GROUP_ORDER.includes(row.type) ? row.type : "other").push(row);
  }
  return [...groups]
    .filter(([, list]) => list.length)
    .map(([id, list]) => ({
      id,
      labelKey: `SVA.UI.Overview.Groups.${id}`,
      count: list.length,
      rows: list.sort((a, b) => a.name.localeCompare(b.name))
    }));
}

/** Counts shown in the toolbar. */
export function summarize(rows, { showAll = false } = {}) {
  const listed = rows.filter((r) => isListed(r, { showAll }));
  return {
    total: listed.length,
    animated: listed.filter((r) => r.found && !r.disabled).length,
    none: listed.filter((r) => !r.found && !r.disabled).length,
    disabled: listed.filter((r) => r.disabled).length
  };
}

/**
 * A new recipe for an item with no resolved recipe, from its descriptors.
 * Areas → area, ranged/thrown attacks → ranged, melee → melee, auras → aura, otherwise onToken
 * (effects and conditions fire on effectApplied).
 * @param {object|null} descriptors
 * @param {string} animation
 */
export function recipeFromDescriptors(descriptors, animation) {
  const d = descriptors ?? {};
  const traits = (d.traits ?? []).map((t) => String(t).toLowerCase());
  const kind = d.attackKind ?? (traits.includes("thrown") ? "thrown" : null);
  const base = { version: 1, animation };
  if (d.area?.shape) return { ...base, preset: "area", options: { shape: d.area.shape } };
  if (kind === "ranged" || kind === "thrown") return { ...base, preset: "ranged" };
  if (kind === "melee") return { ...base, preset: "melee" };
  if ((d.type === "effect" || d.type === "condition") && traits.includes("aura")) return { ...base, preset: "aura" };
  if (d.type === "effect" || d.type === "condition") {
    return { ...base, preset: "onToken", triggers: ["effectApplied"] };
  }
  return { ...base, preset: "onToken" };
}

/**
 * Recipe saved on the item when an animation is picked with "Change": the resolved recipe
 * (preset, options, stages, outcomes, sound, triggers kept) with only `animation` replaced,
 * or a new recipe from the descriptors when nothing resolved. A fallback found by probing an
 * event type keeps that trigger explicitly, so the item recipe fires on the same event.
 * @param {object} row buildRow() result
 * @param {string} animation picked database path
 */
export function changedRecipe(row, animation) {
  if (row?.recipe) {
    const recipe = cloneJson(row.recipe);
    recipe.animation = animation;
    if (row.eventType && !recipe.triggers?.length) recipe.triggers = [...row.triggers];
    return recipe;
  }
  return recipeFromDescriptors(row?.descriptors, animation);
}

/**
 * Token to preview from: a controlled token of this actor, else one of its active tokens.
 * @param {object} actor
 * @param {object[]} controlled canvas.tokens.controlled
 * @param {object[]} [active] actor.getActiveTokens()
 */
export function pickSourceToken(actor, controlled = [], active = []) {
  const own = controlled.find((token) => isActorToken(actor, token));
  return own ?? active[0] ?? null;
}

/** Does a token belong to the actor (synthetic token actors compare by uuid)? */
export function isActorToken(actor, token) {
  if (!actor || !token) return false;
  const tokenActor = token.actor ?? token.document?.actor ?? null;
  if (tokenActor === actor) return true;
  if (tokenActor?.uuid && actor.uuid) return tokenActor.uuid === actor.uuid;
  return !!actor.id && (tokenActor?.id ?? token.document?.actorId) === actor.id;
}

/** Is `item` embedded in `actor`? (update/create/delete hook filter) */
export function isActorItem(actor, item) {
  const parent = item?.parent ?? item?.actor ?? null;
  if (!actor || !parent) return false;
  if (parent === actor) return true;
  if (parent.uuid && actor.uuid) return parent.uuid === actor.uuid;
  return !!actor.id && parent.id === actor.id;
}
