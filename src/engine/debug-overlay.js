/**
 * Debug overlay (#19): a small text block in the canvas overlay (screen space) with engine counters and FPS.
 * Toggled by the `engineDebugOverlay` client setting or `SVA.engine.debug.overlay(true)`.
 */

const REFRESH_MS = 500;

/** Text shown by the overlay (pure). */
export function formatStats(stats, fps) {
  const t = stats.textures ?? {};
  return [
    `SVA effects  ${stats.active}/${stats.max}  (shown ${stats.mounted}, loading ${stats.loading}, persistent ${stats.persistent})`,
    `played ${stats.played}  skipped ${stats.skipped}  evicted ${stats.evicted}  failed ${stats.failed}  peak ${stats.peak}`,
    `files cached ${t.cached ?? 0}  loads ${t.loads ?? 0}  hits ${t.hits ?? 0}  videos live ${t.liveInstances ?? 0} (pooled ${t.pooled ?? 0})`,
    `fps ${Number.isFinite(fps) ? fps.toFixed(0) : "?"}`
  ].join("\n");
}

export class DebugOverlay {
  #text = null;
  #timer = null;

  /** @param {() => object} getStats */
  constructor(getStats) {
    this.getStats = getStats;
    this.enabled = false;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (this.enabled) this.show();
    else this.hide();
  }

  /** (Re)create the text on the current canvas. Safe to call on every canvasReady. */
  show() {
    if (!this.enabled || !canvas?.ready || !canvas.overlay) return;
    if (!this.#text || this.#text.destroyed || this.#text.parent !== canvas.overlay) {
      this.#text = new PIXI.Text("", {
        fontFamily: "monospace",
        fontSize: 12,
        fill: 0xffffff,
        stroke: 0x000000,
        strokeThickness: 3
      });
      this.#text.name = "sva-engine-debug";
      this.#text.eventMode = "none";
      this.#text.position.set(12, 12);
      canvas.overlay.addChild(this.#text);
    }
    this.#timer ??= setInterval(() => this.update(), REFRESH_MS);
    this.update();
  }

  update() {
    if (!this.#text || this.#text.destroyed) return;
    this.#text.text = formatStats(this.getStats(), canvas?.app?.ticker?.FPS);
  }

  hide() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    if (this.#text && !this.#text.destroyed) {
      this.#text.parent?.removeChild(this.#text);
      this.#text.destroy();
    }
    this.#text = null;
  }

  /** Canvas tear down: drop the text, keep the enabled state for the next canvas. */
  tearDown() {
    const enabled = this.enabled;
    this.hide();
    this.enabled = enabled;
  }
}
