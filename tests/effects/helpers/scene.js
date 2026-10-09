import { vi } from "vitest";
import { MODULE_ID } from "../../../src/constants.js";

function setPath(target, path, value) {
  const keys = path.split(".");
  let node = target;
  for (const key of keys.slice(0, -1)) node = node[key] ??= {};
  node[keys.at(-1)] = structuredClone(value);
}

function deletePath(target, path) {
  const keys = path.split(".");
  let node = target;
  for (const key of keys.slice(0, -1)) {
    node = node?.[key];
    if (!node) return;
  }
  delete node[keys.at(-1)];
}

/**
 * Scene document stand-in with flags, `update` (dot paths, "-=key" deletions) and `unsetFlag`.
 * `onUpdate(scene)` is called after every change, like the updateScene hook.
 */
export function createMockScene(id = "scene1", { onUpdate = () => {} } = {}) {
  const scene = {
    id,
    flags: {},
    update: vi.fn(async (changes) => {
      for (const [path, value] of Object.entries(changes)) {
        // Foundry deletion syntax: "flags.x.-=key" removes `key`.
        const last = path.split(".").at(-1);
        if (last.startsWith("-=")) deletePath(scene, `${path.slice(0, -last.length)}${last.slice(2)}`);
        else setPath(scene, path, value);
      }
      onUpdate(scene);
      return scene;
    }),
    unsetFlag: vi.fn(async (scope, key) => {
      deletePath(scene.flags, `${scope}.${key}`);
      onUpdate(scene);
      return scene;
    }),
    /** Test helper: put descriptors straight into the flag. */
    _store(...effects) {
      scene.flags[MODULE_ID] ??= {};
      scene.flags[MODULE_ID].effects ??= {};
      for (const e of effects) scene.flags[MODULE_ID].effects[e.id] = structuredClone(e);
    }
  };
  return scene;
}
