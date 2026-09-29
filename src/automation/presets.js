/**
 * Recipe presets. Each preset declares its UI metadata (label, stages,
 * optionsSchema, default triggers) and a `build(ctx)` that turns a normalized
 * recipe + AutomationEvent into SequenceSteps (see ../shared/descriptors.js).
 *
 * Timeline shared by every preset:
 *   sound → cast (source, waits for it) → onSource (source) + main animation(s)
 *   → impact / onTarget on each affected target (after the main animation).
 * Multi-target presets stagger each target by `options.stagger` ms.
 */
import { AREA_SHAPES, EVENT_TYPES } from "../shared/events.js";
import {
  LAYERS,
  defaultGrid,
  effectStep,
  getStage,
  isMiss,
  makeEffect,
  project,
  recipeForOutcome,
  tokenAnchor
} from "./steps.js";

const COMMON_OPTIONS = {
  scale: { type: "number", default: 1, min: 0.1, max: 10, step: 0.1 },
  layer: { type: "select", default: LAYERS.ABOVE_TOKENS, choices: Object.values(LAYERS) },
  tint: { type: "color", default: null },
  opacity: { type: "number", default: 1, min: 0, max: 1, step: 0.05 },
  playbackRate: { type: "number", default: 1, min: 0.1, max: 4, step: 0.1 },
  delay: { type: "number", default: 0, min: 0, step: 50 },
  fadeIn: { type: "number", default: 0, min: 0, step: 50 },
  fadeOut: { type: "number", default: 0, min: 0, step: 50 }
};

const ATTACK_OPTIONS = {
  stagger: { type: "number", default: 150, min: 0, step: 50 },
  impactOffset: { type: "number", default: -250, step: 50 }
};

/** Name of the persistent effect an aura recipe creates for an event. */
export function auraName(event) {
  const owner = event?.source?.actorId ?? event?.source?.tokenId ?? "unknown";
  const key = event?.descriptors?.key ?? "item";
  return `aura:${owner}:${key}`;
}

/* ------------------------------------------------------------------------ */
/*  Shared step builders                                                     */
/* ------------------------------------------------------------------------ */

function soundStep(recipe) {
  const s = recipe.sound;
  if (!s?.file) return [];
  const step = { type: "sound", file: s.file };
  if (s.volume !== undefined) step.volume = s.volume;
  if (s.delay !== undefined) step.delay = s.delay;
  return [step];
}

function sourceStage(recipe, id, sourceId, waitDefault) {
  const stage = getStage(recipe, id);
  if (!stage || !sourceId) return [];
  const opts = stage.options ?? {};
  const effect = makeEffect(stage.animation, opts, {
    atLocation: tokenAnchor(sourceId),
    scaleToObject: opts.scale ?? 1.5
  });
  return [effectStep(effect, waitDefault === undefined ? undefined : (opts.waitUntilFinished ?? waitDefault))];
}

/** sound, cast (waits), onSource. */
function preSteps(recipe, sourceId, { onSource = true } = {}) {
  return [
    ...soundStep(recipe),
    ...sourceStage(recipe, "cast", sourceId, -500),
    ...(onSource ? sourceStage(recipe, "onSource", sourceId) : [])
  ];
}

/** impact + onTarget on one target. */
function targetSteps(recipe, tokenId, delay) {
  const steps = [];
  for (const [id, scale] of [
    ["impact", 1],
    ["onTarget", 1.2]
  ]) {
    const stage = getStage(recipe, id);
    if (!stage || !tokenId) continue;
    const opts = stage.options ?? {};
    steps.push(
      effectStep(
        makeEffect(stage.animation, opts, {
          atLocation: tokenAnchor(tokenId),
          scaleToObject: opts.scale ?? scale,
          delay
        })
      )
    );
  }
  return steps;
}

/**
 * Order the steps so that the follow-ups (impacts) start when the FIRST main
 * effect ends: the other main effects are queued first (they start right away,
 * with their own stagger delay), then the first one with `waitUntilFinished`.
 */
function assemble(pre, main, post, offset) {
  if (!main.length) return [...pre, ...post];
  if (!post.length) return [...pre, ...main.map((e) => effectStep(e))];
  const [first, ...rest] = main;
  return [...pre, ...rest.map((e) => effectStep(e)), effectStep(first, offset ?? 0), ...post];
}

function stretchScale(opts) {
  return opts.scale !== undefined && opts.scale !== 1 ? { scale: opts.scale } : {};
}

/* ------------------------------------------------------------------------ */
/*  Presets                                                                 */
/* ------------------------------------------------------------------------ */

function buildAttack(ctx, { useProjectile, staggerDefault }) {
  const { event, sourceId } = ctx;
  const overall = recipeForOutcome(ctx.recipe, event.outcome);
  const opts = overall.options ?? {};
  const stagger = opts.stagger ?? staggerDefault;
  const main = [];
  const post = [];
  ctx.targets.forEach((target, i) => {
    const outcome = target.outcome ?? event.outcome;
    const r = recipeForOutcome(ctx.recipe, outcome);
    const ropts = r.options ?? {};
    const projectile = useProjectile ? getStage(r, "projectile") : null;
    const file = projectile?.animation ?? r.animation;
    const fileOpts = projectile ? { ...ropts, ...projectile.options } : ropts;
    const delay = i * stagger;
    const missed = isMiss(outcome);
    if (file) {
      const extra = sourceId
        ? { atLocation: tokenAnchor(sourceId), stretchTo: tokenAnchor(target.tokenId), ...stretchScale(fileOpts) }
        : { atLocation: tokenAnchor(target.tokenId), scaleToObject: fileOpts.scale ?? 1 };
      if (missed && sourceId) extra.missed = true;
      if (useProjectile && fileOpts.returnTrip && sourceId) extra.returnTrip = true;
      main.push(makeEffect(file, fileOpts, { ...extra, delay }));
    }
    if (!missed) post.push(...targetSteps(r, target.tokenId, delay));
  });
  return assemble(preSteps(overall, sourceId), main, post, opts.impactOffset ?? -250);
}

function buildOnToken(ctx) {
  const { event, sourceId } = ctx;
  const overall = recipeForOutcome(ctx.recipe, event.outcome);
  const opts = overall.options ?? {};
  const self = sourceId ? [{ tokenId: sourceId, outcome: event.outcome }] : [];
  const recipients = opts.target === "source" ? self : ctx.targets.length ? ctx.targets : self;
  const stagger = opts.stagger ?? 100;
  const main = [];
  const post = [];
  recipients.forEach((target, i) => {
    const r = recipeForOutcome(ctx.recipe, target.outcome ?? event.outcome);
    const ropts = r.options ?? {};
    const delay = i * stagger;
    if (r.animation) {
      const extra = { atLocation: tokenAnchor(target.tokenId), scaleToObject: ropts.scale ?? 1.5, delay };
      if (ropts.attach) extra.attachTo = { tokenId: target.tokenId };
      main.push(makeEffect(r.animation, ropts, extra));
    }
    post.push(...targetSteps(r, target.tokenId, delay));
  });
  return assemble(preSteps(overall, sourceId), main, post, opts.impactOffset ?? -250);
}

/** Resolve the area geometry from the event, the item descriptors or the options. */
function areaGeometry(ctx, opts) {
  const { event } = ctx;
  const area = event.area ?? null;
  const described = event.descriptors?.area ?? null;
  return {
    shape: area?.shape ?? described?.shape ?? opts.shape ?? AREA_SHAPES.BURST,
    distance: area?.distance ?? described?.size ?? opts.size ?? ctx.grid.distance * 2,
    origin: area?.origin ? { x: area.origin.x, y: area.origin.y } : null,
    direction: area?.direction ?? 0
  };
}

function buildArea(ctx) {
  const { event, sourceId, grid } = ctx;
  const recipe = recipeForOutcome(ctx.recipe, event.outcome);
  const opts = recipe.options ?? {};
  const geo = areaGeometry(ctx, opts);
  const scale = opts.scale ?? 1;
  const firstTarget = ctx.targets[0]?.tokenId ?? null;
  const squares = geo.distance / grid.distance;
  let extra = null;
  switch (geo.shape) {
    case AREA_SHAPES.CONE:
    case AREA_SHAPES.LINE:
      if (geo.origin) {
        extra = { atLocation: geo.origin, stretchTo: project(geo.origin, geo.direction, geo.distance, grid) };
      } else if (sourceId && firstTarget) {
        extra = { atLocation: tokenAnchor(sourceId), stretchTo: tokenAnchor(firstTarget) };
      }
      if (extra && scale !== 1) extra.scale = scale;
      break;
    case AREA_SHAPES.EMANATION: {
      const anchor = geo.origin ?? tokenAnchor(sourceId);
      const tokenSize = sourceId ? ctx.getTokenSize(sourceId) : 1;
      const side = (squares * 2 + tokenSize) * scale;
      if (anchor) extra = { atLocation: anchor, size: { width: side, height: side, gridUnits: true } };
      break;
    }
    case AREA_SHAPES.SQUARE: {
      const anchor = geo.origin ?? tokenAnchor(firstTarget ?? sourceId);
      const side = squares * scale;
      if (anchor) extra = { atLocation: anchor, size: { width: side, height: side, gridUnits: true } };
      break;
    }
    default: {
      const anchor = geo.origin ?? tokenAnchor(firstTarget ?? sourceId);
      const side = squares * 2 * scale;
      if (anchor) extra = { atLocation: anchor, size: { width: side, height: side, gridUnits: true } };
    }
  }
  const main = extra && recipe.animation ? [makeEffect(recipe.animation, opts, extra)] : [];
  const stagger = opts.stagger ?? 50;
  const post = ctx.targets.flatMap((t, i) =>
    targetSteps(recipeForOutcome(ctx.recipe, t.outcome ?? event.outcome), t.tokenId, i * stagger)
  );
  return assemble(preSteps(recipe, sourceId), main, post, opts.impactOffset ?? -500);
}

function buildAura(ctx) {
  const { event, sourceId, grid } = ctx;
  if (!sourceId) return [];
  const recipe = recipeForOutcome(ctx.recipe, event.outcome);
  const opts = recipe.options ?? {};
  const radius = opts.radius ?? event.descriptors?.area?.size ?? null;
  const extra = {
    atLocation: tokenAnchor(sourceId),
    attachTo: { tokenId: sourceId },
    persist: true,
    name: auraName(event),
    layer: opts.layer ?? LAYERS.BELOW_TOKENS
  };
  if (radius) {
    const side = ((radius / grid.distance) * 2 + ctx.getTokenSize(sourceId)) * (opts.scale ?? 1);
    extra.size = { width: side, height: side, gridUnits: true };
  } else {
    extra.scaleToObject = opts.scale ?? 2.5;
  }
  const main = recipe.animation ? [makeEffect(recipe.animation, opts, extra)] : [];
  return assemble(preSteps(recipe, sourceId), main, [], null);
}

function buildTeleport(ctx) {
  const { event, sourceId } = ctx;
  const recipe = recipeForOutcome(ctx.recipe, event.outcome);
  const opts = recipe.options ?? {};
  const scale = opts.scale ?? 1.5;
  const steps = preSteps(recipe, sourceId, { onSource: false });
  const departure = getStage(recipe, "onSource");
  const arrival = getStage(recipe, "onTarget");
  const departFile = departure?.animation ?? recipe.animation;
  if (sourceId && departFile) {
    const o = { ...opts, ...departure?.options };
    steps.push(effectStep(makeEffect(departFile, o, { atLocation: tokenAnchor(sourceId), scaleToObject: scale })));
  }
  const point = event.area?.origin ?? opts.destination ?? null;
  const dest = point ? { x: point.x, y: point.y } : tokenAnchor(ctx.targets[0]?.tokenId);
  const arriveFile = arrival?.animation ?? recipe.animation;
  if (dest && arriveFile) {
    const o = { ...opts, ...arrival?.options };
    const sizing = point
      ? (() => {
          const side = (sourceId ? ctx.getTokenSize(sourceId) : 1) * scale;
          return { size: { width: side, height: side, gridUnits: true } };
        })()
      : { scaleToObject: scale };
    steps.push(effectStep(makeEffect(arriveFile, o, { atLocation: dest, ...sizing, delay: opts.arrivalDelay ?? 400 })));
  }
  return steps;
}

/* ------------------------------------------------------------------------ */
/*  Registry                                                                */
/* ------------------------------------------------------------------------ */

const DEFINITIONS = {
  melee: {
    stages: ["cast", "onSource", "impact", "onTarget"],
    triggers: [EVENT_TYPES.ATTACK],
    options: { ...COMMON_OPTIONS, ...ATTACK_OPTIONS, stagger: { ...ATTACK_OPTIONS.stagger, default: 250 } },
    build: (ctx) => buildAttack(ctx, { useProjectile: false, staggerDefault: 250 })
  },
  ranged: {
    stages: ["cast", "onSource", "projectile", "impact", "onTarget"],
    triggers: [EVENT_TYPES.ATTACK],
    options: { ...COMMON_OPTIONS, ...ATTACK_OPTIONS, returnTrip: { type: "boolean", default: false } },
    build: (ctx) => buildAttack(ctx, { useProjectile: true, staggerDefault: 150 })
  },
  onToken: {
    stages: ["cast", "onSource", "impact", "onTarget"],
    triggers: [EVENT_TYPES.CAST, EVENT_TYPES.HEALING],
    options: {
      ...COMMON_OPTIONS,
      scale: { ...COMMON_OPTIONS.scale, default: 1.5 },
      target: { type: "select", default: "targets", choices: ["targets", "source"] },
      attach: { type: "boolean", default: false },
      stagger: { type: "number", default: 100, min: 0, step: 50 }
    },
    build: buildOnToken
  },
  area: {
    stages: ["cast", "onSource", "impact", "onTarget"],
    triggers: [EVENT_TYPES.AREA_PLACED],
    options: {
      ...COMMON_OPTIONS,
      shape: { type: "select", default: AREA_SHAPES.BURST, choices: Object.values(AREA_SHAPES) },
      size: { type: "number", default: null, min: 0, step: 5 }
    },
    build: buildArea
  },
  aura: {
    stages: ["cast", "onSource"],
    triggers: [EVENT_TYPES.EFFECT_APPLIED],
    options: {
      ...COMMON_OPTIONS,
      layer: { ...COMMON_OPTIONS.layer, default: LAYERS.BELOW_TOKENS },
      radius: { type: "number", default: null, min: 0, step: 5 }
    },
    build: buildAura
  },
  teleport: {
    stages: ["cast", "onSource", "onTarget"],
    triggers: [EVENT_TYPES.CAST],
    options: {
      ...COMMON_OPTIONS,
      scale: { ...COMMON_OPTIONS.scale, default: 1.5 },
      arrivalDelay: { type: "number", default: 400, min: 0, step: 50 }
    },
    build: buildTeleport
  }
};

const localize = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;

function withLabels(options) {
  const out = {};
  for (const [key, def] of Object.entries(options)) {
    const labelKey = `SVA.Automation.Options.${key}`;
    out[key] = {
      ...def,
      get label() {
        return localize(labelKey);
      }
    };
  }
  return out;
}

/** Public preset metadata (`api.automation.presets`). `label` is localized on read. */
export const PRESETS = Object.freeze(
  Object.fromEntries(
    Object.entries(DEFINITIONS).map(([id, def]) => [
      id,
      Object.freeze({
        id,
        get label() {
          return localize(`SVA.Automation.Presets.${id}`);
        },
        stages: [...def.stages],
        triggers: [...def.triggers],
        optionsSchema: withLabels(def.options)
      })
    ])
  )
);

/** Internal: the build function of a preset. */
export function getBuilder(presetId) {
  return DEFINITIONS[presetId]?.build ?? null;
}

/** Default triggers when a recipe does not set `triggers`. */
export function defaultTriggers(presetId) {
  return [...(DEFINITIONS[presetId]?.triggers ?? [])];
}

export { defaultGrid };
