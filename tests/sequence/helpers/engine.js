import { vi } from "vitest";

/**
 * Mock of the api.engine public surface. Every played effect gets a handle
 * whose `finished` promise is resolved by `finish(id)` (or automatically
 * after `autoFinishMs` when given).
 */
export function createMockEngine({ autoFinishMs = null } = {}) {
  const handles = new Map();
  const log = [];
  const engine = {
    log,
    handles,
    play: vi.fn(async (effect) => {
      let resolve;
      const finished = new Promise((r) => (resolve = r));
      const handle = {
        id: effect.id,
        descriptor: effect,
        finished,
        _resolve: () => {
          handles.delete(effect.id);
          resolve();
        },
        end: vi.fn(async () => handle._resolve())
      };
      handles.set(effect.id, handle);
      log.push(`play:${effect.id}`);
      if (autoFinishMs !== null) setTimeout(() => handle._resolve(), autoFinishMs);
      return handle;
    }),
    get: vi.fn((id) => handles.get(id)),
    active: vi.fn(() => [...handles.values()]),
    end: vi.fn(async (id) => {
      log.push(`end:${id}`);
      handles.get(id)?._resolve();
    }),
    endAll: vi.fn(async () => {
      for (const h of [...handles.values()]) h._resolve();
    }),
    preload: vi.fn(async () => {}),
    finish(id) {
      handles.get(id)?._resolve();
    }
  };
  return engine;
}

/** Minimal Token placeable / TokenDocument shapes. */
export function mockTokenDocument(id, sceneId = "scene1") {
  return { documentName: "Token", id, parent: { id: sceneId } };
}
export function mockToken(id, sceneId = "scene1") {
  return { id, x: 100, y: 200, document: mockTokenDocument(id, sceneId) };
}
