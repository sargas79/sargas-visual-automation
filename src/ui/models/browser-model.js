/**
 * Pure view-model helpers for the animation browser (#36). No Foundry access:
 * everything that needs the database takes it (or a lister function) as input.
 */

/** Root path of the JB2A catalog. */
export const ROOT = "jb2a";
export const DEFAULT_PAGE_SIZE = 48;
/** Minimum query length before the database is searched. */
export const MIN_QUERY_LENGTH = 2;
/** Upper bound for a single db.search call. */
export const MAX_SEARCH_RESULTS = 2000;

/** Last segment of a dot path. */
export function lastSegment(path) {
  const str = String(path ?? "");
  const i = str.lastIndexOf(".");
  return i === -1 ? str : str.slice(i + 1);
}

/** Human-friendly label for a node name ("fire_bolt" → "fire bolt"). */
export function prettyName(name) {
  return String(name ?? "").replaceAll("_", " ");
}

/** Path without the leading "jb2a." for compact display. */
export function shortPath(path) {
  const str = String(path ?? "");
  return str.startsWith(`${ROOT}.`) ? str.slice(ROOT.length + 1) : str;
}

/** Breadcrumb trail for a path: [{path, name}] from the root down. */
export function breadcrumbs(path) {
  if (!path) return [];
  const parts = String(path).split(".");
  return parts.map((name, i) => ({ path: parts.slice(0, i + 1).join("."), name: prettyName(name) }));
}

/**
 * Wraps a lister (e.g. `(p) => db.list(p)`) with a cache so repeated renders
 * never re-query the database. Errors and non-arrays yield [].
 * @param {(path: string) => object[]} lister
 */
export function createChildCache(lister) {
  const cache = new Map();
  const get = (path) => {
    if (!cache.has(path)) {
      let children = [];
      try {
        const result = lister(path);
        if (Array.isArray(result)) children = result;
      } catch {
        children = [];
      }
      cache.set(path, children);
    }
    return cache.get(path);
  };
  get.clear = () => cache.clear();
  return get;
}

/** True when a CatalogEntry is a branch with (possibly) children. */
function isBranch(entry) {
  return entry && !entry.isLeaf;
}

/**
 * Flatten the expanded part of the branch tree into rows for rendering.
 * Only branches appear in the tree (leaves are shown in the grid), and only
 * expanded branches are visited, so this stays cheap for ~12k leaves.
 * @param {(path: string) => object[]} listChildren  cached lister
 * @param {{root?: string, expanded?: Set<string>, selected?: string|null, maxRows?: number}} options
 * @returns {{path: string, name: string, depth: number, expanded: boolean, selected: boolean, leafCount: number}[]}
 */
export function flattenTree(listChildren, { root = ROOT, expanded = new Set(), selected = null, maxRows = 5000 } = {}) {
  const rows = [];
  const visit = (path, depth) => {
    for (const entry of listChildren(path)) {
      if (!isBranch(entry)) continue;
      if (rows.length >= maxRows) return;
      const isOpen = expanded.has(entry.path);
      rows.push({
        path: entry.path,
        name: prettyName(entry.name ?? lastSegment(entry.path)),
        depth,
        expanded: isOpen,
        selected: entry.path === selected,
        indent: depth * 12,
        cssClass: entry.path === selected ? "sva-tree-row sva-selected" : "sva-tree-row",
        caret: isOpen ? "fa-caret-down" : "fa-caret-right"
      });
      if (isOpen) visit(entry.path, depth + 1);
    }
  };
  visit(root, 0);
  return rows;
}

/**
 * Expand every ancestor of `path` (so a selection deep in the tree is visible).
 * @returns {Set<string>} a new set
 */
export function expandTo(expanded, path) {
  const next = new Set(expanded);
  const parts = String(path ?? "").split(".");
  for (let i = 2; i < parts.length; i++) next.add(parts.slice(0, i).join("."));
  return next;
}

/** Toggle a path in a set, returning a new set. */
export function toggleInSet(set, value) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * Slice a list into a page.
 * @returns {{items: any[], page: number, pageCount: number, total: number, hasPrev: boolean, hasNext: boolean}}
 */
export function paginate(items, page = 0, pageSize = DEFAULT_PAGE_SIZE) {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(0, page), pageCount - 1);
  return {
    items: items.slice(current * pageSize, (current + 1) * pageSize),
    page: current,
    pageCount,
    total,
    hasPrev: current > 0,
    hasNext: current < pageCount - 1
  };
}

/** Trimmed query, or "" when it is too short to search. */
export function normalizeQuery(query) {
  const q = String(query ?? "").trim();
  return q.length >= MIN_QUERY_LENGTH ? q : "";
}

/**
 * Run one page of a database search. Asks for one extra result so we know
 * whether a next page exists without counting every match.
 * @param {{search: Function}} db
 */
export function searchPage(db, query, page = 0, pageSize = DEFAULT_PAGE_SIZE) {
  const q = normalizeQuery(query);
  const empty = { items: [], page: 0, pageCount: 1, total: 0, hasPrev: false, hasNext: false, query: q };
  if (!q || typeof db?.search !== "function") return empty;
  const safePage = Math.max(0, page);
  const limit = Math.min(MAX_SEARCH_RESULTS, (safePage + 1) * pageSize + 1);
  let results;
  try {
    results = db.search(q, { limit }) ?? [];
  } catch {
    results = [];
  }
  const start = safePage * pageSize;
  const items = results.slice(start, start + pageSize);
  return {
    items,
    page: safePage,
    pageCount: null,
    total: results.length > start + pageSize ? null : results.length,
    hasPrev: safePage > 0,
    hasNext: results.length > start + pageSize,
    query: q
  };
}

/** Entries shown when browsing a branch: sub-branches first, then leaves, both by name. */
export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (!!a.isLeaf !== !!b.isLeaf) return a.isLeaf ? 1 : -1;
    return String(a.name ?? a.path).localeCompare(String(b.name ?? b.path), undefined, { numeric: true });
  });
}

/**
 * Turn catalog entries into grid cards.
 * @param {object[]} entries CatalogEntry[]
 * @param {{favourites?: string[], resolveThumbnail?: (path: string) => string|null, pickMode?: boolean}} options
 */
export function toCards(entries, { favourites = [], resolveThumbnail, pickMode = false } = {}) {
  const favs = new Set(favourites);
  return entries.map((entry) => {
    let thumbnail = entry.thumbnail ?? null;
    if (!thumbnail && entry.isLeaf && resolveThumbnail) {
      try {
        thumbnail = resolveThumbnail(entry.path) ?? null;
      } catch {
        thumbnail = null;
      }
    }
    const favourite = favs.has(entry.path);
    return {
      path: entry.path,
      name: prettyName(entry.name ?? lastSegment(entry.path)),
      label: shortPath(entry.path),
      isLeaf: !!entry.isLeaf,
      thumbnail,
      favourite,
      pickMode,
      cssClass: entry.isLeaf ? "sva-card sva-card-leaf" : "sva-card sva-card-branch",
      favClass: favourite ? "sva-active" : "",
      favIcon: favourite ? "fa-solid fa-star" : "fa-regular fa-star"
    };
  });
}

/** Entries for the favourites view; unknown paths are kept as leaf placeholders. */
export function favouriteEntries(favourites, getEntry) {
  return (favourites ?? []).map((path) => {
    let entry;
    try {
      entry = getEntry?.(path) ?? null;
    } catch {
      entry = null;
    }
    return entry ?? { path, name: lastSegment(path), isLeaf: true, thumbnail: null };
  });
}

/** Add or remove a favourite, returning a new array (order preserved, no duplicates). */
export function toggleFavourite(favourites, path) {
  const list = Array.isArray(favourites) ? favourites.filter((p) => typeof p === "string") : [];
  return list.includes(path) ? list.filter((p) => p !== path) : [...list, path];
}
