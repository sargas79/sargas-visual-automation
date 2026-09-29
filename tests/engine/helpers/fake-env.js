import { vi } from "vitest";

/** Minimal sprite: lives `lifetime` ms, ends `fade` ms after requestEnd. */
export class FakeSprite {
  constructor(params, { lifetime = 1000, fade = 100 } = {}) {
    this.params = params;
    this.descriptor = params.descriptor;
    this.lifetime = params.descriptor.persist ? Infinity : lifetime;
    this.fade = fade;
    this.elapsed = 0;
    this.display = null;
    this.destroyed = false;
  }
  async mount() {
    this.display = {};
  }
  update(dt) {
    this.elapsed += dt;
    return this.elapsed < this.lifetime;
  }
  requestEnd({ immediate } = {}) {
    this.lifetime = immediate ? this.elapsed : Math.min(this.lifetime, this.elapsed + this.fade);
  }
  destroy() {
    this.destroyed = true;
    this.display = null;
  }
}

/** Fake EngineEnvironment with a manual ticker (`env.tick(ms)`). */
export function createFakeEnv({ sceneId = "scene1", userId = "user1", ready = true, sprite = {} } = {}) {
  const tickers = new Set();
  const env = {
    sprites: [],
    ready,
    scene: sceneId,
    isReady: () => env.ready,
    sceneId: () => env.scene,
    userId: () => userId,
    createContext: () => ({}),
    createSprite: vi.fn((params) => {
      const s = new FakeSprite(params, sprite);
      env.sprites.push(s);
      return s;
    }),
    addTicker: vi.fn((fn) => tickers.add(fn)),
    removeTicker: vi.fn((fn) => tickers.delete(fn)),
    wait: vi.fn(async () => {}),
    tickers,
    tick(ms) {
      for (const fn of [...tickers]) fn(ms);
    }
  };
  return env;
}
