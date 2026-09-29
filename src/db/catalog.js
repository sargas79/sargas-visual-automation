/**
 * Flattened, read-only index of a JB2A database (`patreonDatabase`).
 * Builds dot-path nodes ("jb2a.fire_bolt.orange"), resolves partial paths,
 * arrays and distance variants, and searches playable entries.
 */
import {
  guessThumbnail,
  isDistanceGroup,
  isLeafValue,
  isMetaKey,
  leafFiles,
  parseMarkers,
  parseSize,
  parseTemplate,
  pickDistanceKey
} from "./metadata.js";
import { searchUnits } from "./search.js";

export const ROOT = "jb2a";

/**
 * @typedef {object} ResolvedFile
 * @property {string} path            Dot path of the chosen leaf (or of its distance group).
 * @property {string} file
 * @property {string|null} thumbnail  Best-guess `_Thumb.webp` (see metadata.thumbnailCandidates).
 * @property {{width:number,height:number}|null} size
 * @property {{name:string, gridSize:number, startPad:number, endPad:number}|null} template
 * @property {{loop?: {start:number,end:number}, forcedEnd?: number}|null} markers
 * @property {string|null} distance   Distance variant key ("30ft") or null.
 */

/**
 * @typedef {object} CatalogEntry
 * @property {string} path
 * @property {string} name            Last path segment.
 * @property {string} label           Human-readable label (JB2A `_metadata.name` of the nearest ancestor + name).
 * @property {boolean} isLeaf
 * @property {string[]} [children]    Child names (branches only).
 * @property {string[]} [distances]   Distance variant keys when the branch is a distance group.
 * @property {string|null} [thumbnail]
 */

/** Normalizes user input: trims, drops empty segments and adds the `jb2a.` root. */
export function normalizePath(path) {
  if (typeof path !== "string") return null;
  const parts = path
    .trim()
    .split(".")
    .filter((p) => p.length);
  if (!parts.length) return ROOT;
  if (parts[0] !== ROOT) parts.unshift(ROOT);
  return parts.join(".");
}

export class Catalog {
  /**
   * @param {object} database   Raw JB2A database object (`_templates` + categories).
   * @param {{random?: () => number}} [options]  `random` is injectable for tests.
   */
  constructor(database, { random = Math.random } = {}) {
    this.random = random;
    /** @type {Map<string, object>} */
    this.nodes = new Map();
    this.templates = database?._templates ?? {};
    const root = this.#addNode(ROOT, ROOT, null, { template: null, markers: null, label: "JB2A" });
    for (const [key, value] of Object.entries(database ?? {})) {
      if (isMetaKey(key) || value === null || value === undefined) continue;
      this.#build(key, value, root);
    }
    /** Playable units (leaves outside distance groups + distance groups), used by search. */
    this.units = [...this.nodes.values()].filter((n) => n.isUnit);
  }

  get size() {
    return this.nodes.size;
  }

  #addNode(path, name, parent, extra) {
    const node = { path, name, parent, children: [], isLeaf: false, files: null, ...extra };
    this.nodes.set(path, node);
    if (parent) parent.children.push(name);
    return node;
  }

  #build(name, value, parent) {
    const path = `${parent.path}.${name}`;
    if (isLeafValue(value)) {
      const files = leafFiles(value);
      if (!files.length) return;
      const node = this.#addNode(path, name, parent, {
        isLeaf: true,
        files,
        template: parent.template,
        markers: parent.markers,
        label: `${parent.label} ${name}`.trim(),
        distance: parent.isDistanceGroup ? name : null,
        isUnit: !parent.isDistanceGroup
      });
      node.thumbnail = guessThumbnail(files[0]);
      return;
    }
    if (typeof value !== "object") return;
    const childKeys = Object.keys(value).filter((k) => !isMetaKey(k));
    const templateName = typeof value._template === "string" ? value._template : null;
    const metaName = typeof value._metadata?.name === "string" ? value._metadata.name : null;
    const node = this.#addNode(path, name, parent, {
      template: templateName ? parseTemplate(this.templates, templateName) : parent.template,
      markers: value._markers ? parseMarkers(value._markers) : parent.markers,
      label: metaName ?? (parent.path === ROOT ? name : `${parent.label} ${name}`),
      isDistanceGroup: isDistanceGroup(childKeys),
      isUnit: false
    });
    node.isUnit = node.isDistanceGroup;
    for (const key of childKeys) this.#build(key, value[key], node);
    if (!node.children.length) {
      // Empty branch (e.g. all leaves were empty arrays) - drop it.
      this.nodes.delete(path);
      parent.children.splice(parent.children.indexOf(name), 1);
    }
  }

  /** @returns {object|null} internal node for a (normalized) path. */
  node(path) {
    return this.nodes.get(normalizePath(path)) ?? null;
  }

  has(path) {
    return this.node(path) !== null;
  }

  /** @returns {CatalogEntry|null} */
  getEntry(path) {
    const node = this.node(path);
    return node ? this.#entry(node) : null;
  }

  /**
   * Entries below a branch. depth 1 = direct children, 2 = children and grandchildren...
   * @returns {CatalogEntry[]}
   */
  list(prefix = ROOT, { depth = 1 } = {}) {
    const start = this.node(prefix ?? ROOT);
    if (!start || start.isLeaf) return [];
    const out = [];
    const walk = (node, level) => {
      for (const name of node.children) {
        const child = this.nodes.get(`${node.path}.${name}`);
        out.push(this.#entry(child));
        if (!child.isLeaf && level < depth) walk(child, level + 1);
      }
    };
    walk(start, 1);
    return out;
  }

  /** @returns {CatalogEntry[]} ranked playable entries (leaves and distance groups). */
  search(query, { limit = 50 } = {}) {
    return searchUnits(this.units, query, { limit }).map((node) => this.#entry(node));
  }

  /**
   * Resolve a path to a concrete file.
   * - branch: random playable unit below it (uniform over units)
   * - distance group: closest variant to `distance` (scene units)
   * - array leaf: random file; `path.N` picks element N
   * @param {string} path
   * @param {{distance?: number, gridDistance?: number}} [options]
   * @returns {ResolvedFile|null}
   */
  resolve(path, { distance, gridDistance } = {}) {
    let node = this.node(path);
    let index = null;
    if (!node) {
      // "jb2a.burrow.out.01.brown.1" → element 1 of the array leaf.
      const full = normalizePath(path);
      const cut = full?.lastIndexOf(".") ?? -1;
      const parent = cut > 0 ? this.nodes.get(full.slice(0, cut)) : null;
      const idx = cut > 0 ? Number(full.slice(cut + 1)) : NaN;
      if (!parent?.isLeaf || !Number.isInteger(idx) || !parent.files[idx]) return null;
      node = parent;
      index = idx;
    }
    if (!node.isLeaf && !node.isUnit) {
      const units = this.#unitsBelow(node);
      if (!units.length) return null;
      node = units[Math.floor(this.random() * units.length) % units.length];
    }
    let reportPath = node.path;
    if (node.isDistanceGroup) {
      const key = pickDistanceKey(node.children, distance, gridDistance);
      node = this.nodes.get(`${node.path}.${key}`);
    } else if (node.distance) {
      reportPath = node.parent.path;
    }
    if (!node?.isLeaf) return null;
    const file = index ?? Math.floor(this.random() * node.files.length) % node.files.length;
    const chosen = node.files[file];
    return {
      path: reportPath,
      file: chosen,
      thumbnail: guessThumbnail(chosen),
      size: parseSize(chosen),
      template: node.template ? { ...node.template } : null,
      markers: parseMarkers(node.markers),
      distance: node.distance
    };
  }

  #unitsBelow(node) {
    if (!node.unitCache) {
      const out = [];
      const walk = (n) => {
        if (n.isUnit) return out.push(n);
        for (const name of n.children) walk(this.nodes.get(`${n.path}.${name}`));
      };
      walk(node);
      node.unitCache = out;
    }
    return node.unitCache;
  }

  #firstLeaf(node) {
    let n = node;
    while (n && !n.isLeaf) n = this.nodes.get(`${n.path}.${n.children[0]}`);
    return n;
  }

  #entry(node) {
    const entry = { path: node.path, name: node.name, label: node.label, isLeaf: node.isLeaf };
    if (!node.isLeaf) {
      entry.children = [...node.children];
      if (node.isDistanceGroup) entry.distances = [...node.children];
    }
    entry.thumbnail = node.isLeaf ? node.thumbnail : (this.#firstLeaf(node)?.thumbnail ?? null);
    return entry;
  }
}
