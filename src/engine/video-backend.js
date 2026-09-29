/**
 * Foundry v14 / PIXI 7 glue for the texture cache (#13). Not unit tested (needs a browser + Foundry).
 *
 * Loading: `foundry.canvas.loadTexture(src)` goes through Foundry's TextureLoader and PIXI.Assets. For videos PIXI's
 * `loadVideo` parser fetches the file ONCE into a Blob and builds a `<video>` on a `blob:` URL. That element is the
 * prototype; it is shared with anything else in Foundry that uses the same file, so it is never played by us.
 *
 * Instances: every effect plays its own clone of the prototype `<video>` (same blob URL, so no new download), wrapped
 * in its own PIXI.VideoResource / BaseTexture. This mirrors `game.video.cloneTexture`, but strips the `autoplay`
 * attribute PIXI puts on the prototype (otherwise the clone would start by itself) and mutes the clone so playback is
 * allowed before the first user gesture.
 */

/** @returns {HTMLVideoElement|null} */
function videoOf(texture) {
  // VERIFY(v14): game.video.getVideoSource(texture) returns the <video> behind a texture.
  const video = game.video?.getVideoSource?.(texture);
  if (video) return video;
  const source = texture?.baseTexture?.resource?.source;
  return source?.tagName === "VIDEO" ? source : null;
}

function videoDurationMs(video) {
  const d = video?.duration;
  return Number.isFinite(d) ? d * 1000 : 0;
}

/** @type {import("./texture-cache.js").TextureBackend} */
export const foundryTextureBackend = {
  async load(src) {
    const wasCached = !!PIXI.Assets.cache?.has?.(src);
    const texture = await foundry.canvas.loadTexture(src);
    if (!texture?.valid) throw new Error(`Could not load ${src}`);
    const video = videoOf(texture);
    // PIXI's loadVideo autoplays freshly loaded prototypes; we only ever play clones.
    if (video && !wasCached) video.pause();
    return {
      src,
      texture,
      video,
      owned: !wasCached,
      width: texture.width,
      height: texture.height,
      duration: videoDurationMs(video)
    };
  },

  async clone(proto) {
    if (!proto.video) {
      // Static image: instances share the base texture.
      return {
        texture: new PIXI.Texture(proto.texture.baseTexture),
        video: null,
        shared: true,
        width: proto.width,
        height: proto.height,
        duration: 0
      };
    }
    const el = proto.video.cloneNode(true);
    el.removeAttribute("autoplay");
    el.autoplay = false;
    el.muted = true;
    el.loop = false;
    el.playsInline = true;
    el.preload = "auto";
    const resource = new PIXI.VideoResource(el, { autoPlay: false });
    resource.internal = true;
    await resource.load();
    const base = new PIXI.BaseTexture(resource, { alphaMode: await PIXI.utils.detectVideoAlphaMode() });
    const texture = new PIXI.Texture(base);
    return { texture, video: el, width: texture.width, height: texture.height, duration: videoDurationMs(el) };
  },

  reset(clone) {
    const video = clone.video;
    if (!video) return true;
    video.pause();
    video.loop = false;
    video.playbackRate = 1;
    try {
      video.currentTime = 0;
    } catch {
      return false;
    }
    return !clone.texture.baseTexture?.destroyed;
  },

  destroyClone(clone) {
    if (clone.shared) {
      clone.texture.destroy(false);
      return;
    }
    const video = clone.video;
    video?.pause();
    // Destroys the BaseTexture and its VideoResource (which detaches listeners and empties the element).
    clone.texture.destroy(true);
    if (video) {
      video.removeAttribute("src");
      video.replaceChildren();
      video.load();
    }
  },

  unload(proto) {
    // Only unload what we loaded; files already cached by Foundry (tiles, tokens...) stay under its control.
    if (proto.owned) PIXI.Assets.unload(proto.src).catch(() => {});
  }
};
