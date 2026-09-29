import { vi } from "vitest";

const RANGED = { gridSize: 200, startPad: 200, endPad: 200 };

/** Leaves of a tiny fake JB2A catalog, keyed by dot path. */
export const LEAVES = {
  "jb2a.fire_bolt.orange.05ft": {
    file: "jb2a/FireBolt_Orange_05ft_600x400.webm",
    size: { width: 600, height: 400 },
    template: RANGED,
    distance: "05ft"
  },
  "jb2a.fire_bolt.orange.30ft": {
    file: "jb2a/FireBolt_Orange_30ft_1600x400.webm",
    size: { width: 1600, height: 400 },
    template: RANGED,
    distance: "30ft"
  },
  "jb2a.fire_bolt.orange.60ft": {
    file: "jb2a/FireBolt_Orange_60ft_2800x400.webm",
    size: { width: 2800, height: 400 },
    template: RANGED,
    distance: "60ft"
  },
  "jb2a.aura.blue": {
    file: "jb2a/Aura_Blue_400x400.webm",
    size: { width: 400, height: 400 },
    template: { gridSize: 100, startPad: 0, endPad: 0 },
    markers: { loop: { start: 1000, end: 3000 } }
  }
};

function leaf(path) {
  const l = LEAVES[path];
  return l ? { path, thumbnail: null, template: null, markers: null, distance: null, ...l } : null;
}

/** Mock of the documented api.db surface. */
export function createMockDb({ ready = Promise.resolve() } = {}) {
  const children = (prefix) =>
    [...new Set(Object.keys(LEAVES).filter((k) => k.startsWith(`${prefix}.`)))].map((k) => {
      const next = k.slice(prefix.length + 1).split(".")[0];
      return `${prefix}.${next}`;
    });
  const db = {
    ready,
    available: true,
    provider: "jb2a_patreon",
    has: (path) => !!db.getEntry(path),
    getEntry: (path) => {
      if (LEAVES[path]) return { path, name: path.split(".").at(-1), isLeaf: true };
      const kids = [...new Set(children(path))];
      return kids.length ? { path, name: path.split(".").at(-1), isLeaf: false, children: kids } : null;
    },
    list: (prefix) => [...new Set(children(prefix))].map((p) => db.getEntry(p)),
    search: () => [],
    resolve: vi.fn((path, { distance } = {}) => {
      if (LEAVES[path]) return leaf(path);
      const leaves = Object.keys(LEAVES).filter((k) => k.startsWith(`${path}.`));
      if (!leaves.length) return null;
      if (distance === undefined) return leaf(leaves[0]);
      const ft = (k) => parseInt(LEAVES[k].distance, 10);
      leaves.sort((a, b) => Math.abs(ft(a) - distance) - Math.abs(ft(b) - distance));
      return leaf(leaves[0]);
    })
  };
  return db;
}
