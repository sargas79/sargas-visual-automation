import { vi } from "vitest";

const point = () => {
  const p = { x: 0, y: 0 };
  p.set = (x, y = x) => {
    p.x = x;
    p.y = y;
  };
  return p;
};

/** Stand-in for a PIXI display object as created by LayerManager#create. */
export function createFakeDisplay(group = "primary") {
  return {
    position: point(),
    scale: point(),
    anchor: point(),
    rotation: 0,
    alpha: 1,
    tint: 0xffffff,
    visible: true,
    elevation: 0,
    svaGroup: group,
    destroyed: false
  };
}

export function createFakeLayers(group = "primary") {
  return {
    displays: [],
    create: vi.fn(function () {
      const d = createFakeDisplay(group);
      this.displays.push(d);
      return d;
    }),
    setElevation: vi.fn((display, elevation) => (display.elevation = elevation)),
    release: vi.fn((display) => display && (display.destroyed = true))
  };
}

/** Token placeable stand-in. */
export function createFakeToken({ x = 0, y = 0, w = 100, h = 100, rotation = 0, elevation = 0, hidden = false } = {}) {
  return {
    mesh: { position: { x, y }, rotation },
    w,
    h,
    visible: !hidden,
    document: { hidden, elevation, rotation: 0 }
  };
}

/** SpriteContext stand-in. */
export function createFakeContext({ tokens = {}, gridSize = 100, isGM = true, tokenVision = false, group } = {}) {
  return {
    tokens,
    layers: createFakeLayers(group),
    getToken: (id) => tokens[id] ?? null,
    gridSize: () => gridSize,
    isGM: () => isGM,
    tokenVision: () => tokenVision,
    pointVisible: vi.fn(() => true),
    levelBase: () => 0,
    toScreen: (p) => ({ x: p.x / 2, y: p.y / 2 })
  };
}

/** A texture instance without a video (static image). */
export function createFakeInstance({ width = 400, height = 400, duration = 0, video = null } = {}) {
  return { texture: {}, video, width, height, duration };
}
