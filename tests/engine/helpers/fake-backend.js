import { vi } from "vitest";

/** In-memory TextureBackend that counts loads and live "video elements". */
export function createFakeBackend({ duration = 2000, width = 400, height = 400, fail = [] } = {}) {
  const live = new Set();
  let nextId = 0;
  const backend = {
    live,
    load: vi.fn(async (src) => {
      if (fail.includes(src)) throw new Error(`missing ${src}`);
      return { src, texture: { id: `proto:${src}` }, video: { src }, width, height, duration };
    }),
    clone: vi.fn(async (proto) => {
      const video = { id: nextId++, src: proto.src, currentTime: 0 };
      live.add(video);
      return { texture: { video }, video, width, height, duration };
    }),
    reset: vi.fn((clone) => {
      clone.video.currentTime = 0;
      return true;
    }),
    destroyClone: vi.fn((clone) => live.delete(clone.video)),
    unload: vi.fn()
  };
  return backend;
}
