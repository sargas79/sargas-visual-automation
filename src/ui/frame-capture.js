/**
 * On-demand preview frames for animations without a JB2A thumbnail (#67).
 * A muted, detached <video> loads the file, seeks to a representative moment and
 * is drawn into a small canvas; the result is kept as an object URL for the session.
 *
 * JB2A videos often start on an empty (transparent) frame, so the capture point is a
 * fraction of the duration rather than the literal first frame.
 */
import { log } from "../logger.js";

/** Fraction of the duration to capture (the effect is usually fully visible here). */
export const CAPTURE_AT = 0.4;
export const CAPTURE_WIDTH = 240;
export const CAPTURE_TIMEOUT_MS = 10000;
export const MAX_CONCURRENT = 2;
export const MAX_CACHED = 300;

/**
 * Seconds to seek to for a video of `duration` seconds.
 * @returns {number}
 */
export function captureTime(duration, fraction = CAPTURE_AT) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const f = Math.min(Math.max(Number(fraction) || 0, 0), 1);
  // Stay clear of the very end: some browsers can't decode the last frame.
  return Math.max(0, Math.min(duration * f, duration - 0.05));
}

/** Canvas size keeping the video's aspect ratio, `width` wide (never upscaled). */
export function captureSize(videoWidth, videoHeight, width = CAPTURE_WIDTH) {
  if (!(videoWidth > 0) || !(videoHeight > 0)) return null;
  const w = Math.max(1, Math.round(Math.min(width, videoWidth)));
  return { width: w, height: Math.max(1, Math.round((w * videoHeight) / videoWidth)) };
}

/**
 * Small LRU of object URLs; evicted URLs are revoked.
 * @param {number} max
 * @param {(url: string) => void} [revoke]
 */
export function createUrlCache(max = MAX_CACHED, revoke = (url) => globalThis.URL?.revokeObjectURL?.(url)) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);
      return value;
    },
    has: (key) => map.has(key),
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > max) {
        const [oldKey, oldValue] = map.entries().next().value;
        map.delete(oldKey);
        if (oldValue) revoke(oldValue);
      }
    },
    get size() {
      return map.size;
    },
    clear() {
      for (const value of map.values()) if (value) revoke(value);
      map.clear();
    }
  };
}

/**
 * Runs async tasks with a concurrency limit, in FIFO order.
 * @param {number} limit
 */
export function createLimiter(limit = MAX_CONCURRENT) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= limit || !waiting.length) return;
    active++;
    const { task, resolve, reject } = waiting.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (task) =>
    new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      next();
    });
}

/** Whether the URL is on another origin (needs CORS to read the pixels back). */
function isCrossOrigin(url) {
  try {
    return new URL(url, globalThis.location?.href).origin !== globalThis.location?.origin;
  } catch {
    return false;
  }
}

/**
 * Draws one frame of `file` into an image and returns its object URL (null on failure,
 * e.g. an S3 bucket without CORS headers, which taints the canvas).
 * @param {string} file
 * @returns {Promise<string|null>}
 */
export function grabFrame(file, { fraction = CAPTURE_AT, width = CAPTURE_WIDTH, timeout = CAPTURE_TIMEOUT_MS } = {}) {
  const doc = globalThis.document;
  if (!doc?.createElement || !file) return Promise.resolve(null);
  return new Promise((resolve) => {
    const video = doc.createElement("video");
    let done = false;
    const finish = (url) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load?.();
      resolve(url);
    };
    const timer = setTimeout(() => finish(null), timeout);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    if (isCrossOrigin(file)) video.crossOrigin = "anonymous";
    video.addEventListener("error", () => finish(null), { once: true });
    video.addEventListener(
      "loadedmetadata",
      () => {
        video.currentTime = captureTime(video.duration, fraction);
      },
      { once: true }
    );
    video.addEventListener(
      "seeked",
      () => {
        try {
          const size = captureSize(video.videoWidth, video.videoHeight, width);
          if (!size) return finish(null);
          const canvas = doc.createElement("canvas");
          Object.assign(canvas, size);
          canvas.getContext("2d").drawImage(video, 0, 0, size.width, size.height);
          canvas.toBlob((blob) => finish(blob ? URL.createObjectURL(blob) : null), "image/webp", 0.8);
        } catch (err) {
          // SecurityError: cross-origin video without CORS.
          log.debug(`Could not capture a frame of ${file}`, err);
          finish(null);
        }
      },
      { once: true }
    );
    video.src = file;
  });
}

/**
 * Session-wide capture service: de-duplicates requests, limits concurrency and caches.
 * @param {{grab?: typeof grabFrame, limit?: number, max?: number}} [options]
 */
export function createFrameCapture({ grab = grabFrame, limit = MAX_CONCURRENT, max = MAX_CACHED } = {}) {
  const cache = createUrlCache(max);
  const pending = new Map();
  const run = createLimiter(limit);
  return {
    /** Cached result: a URL, null (capture failed) or undefined (not tried yet). */
    peek: (key) => cache.get(key),
    /**
     * @param {string} key   Cache key (the db path).
     * @param {string} file  Video URL.
     * @returns {Promise<string|null>}
     */
    capture(key, file) {
      if (cache.has(key)) return Promise.resolve(cache.get(key));
      if (pending.has(key)) return pending.get(key);
      const promise = run(() => grab(file))
        .catch(() => null)
        .then((url) => {
          pending.delete(key);
          cache.set(key, url ?? null);
          return url ?? null;
        });
      pending.set(key, promise);
      return promise;
    },
    clear: () => cache.clear()
  };
}

let shared = null;
/** The capture service shared by every browser window. */
export function frameCapture() {
  shared ??= createFrameCapture();
  return shared;
}
