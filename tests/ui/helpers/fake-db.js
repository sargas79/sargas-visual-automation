/** A tiny stand-in for api.db built from a nested object of paths (no media). */
const TREE = {
  fire_bolt: { dark: { leaf: true }, orange: true, purple: true },
  healing_generic: { "01": { yellow: true } }
};

function nodeAt(path) {
  const parts = path.split(".").slice(1);
  let node = TREE;
  for (const part of parts) node = node?.[part];
  return node;
}

export function createFakeDb() {
  const entry = (path, name, node) => ({
    path,
    name,
    isLeaf: node === true,
    thumbnail: node === true ? null : undefined,
    children: node === true ? undefined : Object.keys(node).map((k) => `${path}.${k}`)
  });
  return {
    available: true,
    provider: "JB2A_DnD5e",
    ready: Promise.resolve(),
    list(prefix) {
      const node = prefix === "jb2a" ? TREE : nodeAt(prefix);
      if (!node || node === true) return [];
      return Object.entries(node).map(([k, v]) => entry(`${prefix}.${k}`, k, v));
    },
    getEntry(path) {
      const node = nodeAt(path);
      return node ? entry(path, path.split(".").pop(), node) : null;
    },
    search(query, { limit = 50 } = {}) {
      const out = [];
      const walk = (prefix, node) => {
        for (const [k, v] of Object.entries(node)) {
          const path = `${prefix}.${k}`;
          if (v === true) {
            if (path.includes(query)) out.push(entry(path, k, v));
          } else walk(path, v);
        }
      };
      walk("jb2a", TREE);
      return out.slice(0, limit);
    },
    resolve(path) {
      return { path, file: `modules/jb2a/${path}.webm`, thumbnail: `modules/jb2a/${path}.webp`, template: null };
    },
    has(path) {
      return !!nodeAt(path);
    }
  };
}
