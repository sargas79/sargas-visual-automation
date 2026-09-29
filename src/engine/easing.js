/**
 * Named easing functions t ∈ [0, 1] → [0, 1] (pure). Names follow easings.net ("easeInOutCubic"...) and also accept
 * Foundry's CanvasAnimation names ("easeInOutCosine", "easeInCircle", "easeOutCircle"). Unknown names are linear.
 */

const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;

function bounceOut(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

/** Build in / out / inOut variants from an ease-in function. */
function family(easeIn) {
  const easeOut = (t) => 1 - easeIn(1 - t);
  const easeInOut = (t) => (t < 0.5 ? easeIn(2 * t) / 2 : 1 - easeIn(2 - 2 * t) / 2);
  return [easeIn, easeOut, easeInOut];
}

const [easeInQuad, easeOutQuad, easeInOutQuad] = family((t) => t * t);
const [easeInCubic, easeOutCubic, easeInOutCubic] = family((t) => t * t * t);
const [easeInQuart, easeOutQuart, easeInOutQuart] = family((t) => t ** 4);
const [easeInQuint, easeOutQuint, easeInOutQuint] = family((t) => t ** 5);
const [easeInSine, easeOutSine, easeInOutSine] = family((t) => 1 - Math.cos((t * Math.PI) / 2));
const [easeInExpo, easeOutExpo, easeInOutExpo] = family((t) => (t === 0 ? 0 : 2 ** (10 * t - 10)));
const [easeInCirc, easeOutCirc, easeInOutCirc] = family((t) => 1 - Math.sqrt(1 - t * t));

export const EASINGS = Object.freeze({
  linear: (t) => t,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInQuart,
  easeOutQuart,
  easeInOutQuart,
  easeInQuint,
  easeOutQuint,
  easeInOutQuint,
  easeInSine,
  easeOutSine,
  easeInOutSine,
  easeInExpo,
  easeOutExpo,
  easeInOutExpo,
  easeInCirc,
  easeOutCirc,
  easeInOutCirc,
  easeInBack: (t) => c3 * t ** 3 - c1 * t * t,
  easeOutBack: (t) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  easeInOutBack: (t) =>
    t < 0.5 ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2 : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2,
  easeInElastic: (t) => (t === 0 || t === 1 ? t : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * c4)),
  easeOutElastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1),
  easeInOutElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return t < 0.5
      ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
      : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
  },
  easeInBounce: (t) => 1 - bounceOut(1 - t),
  easeOutBounce: bounceOut,
  easeInOutBounce: (t) => (t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2),
  // Foundry CanvasAnimation names
  easeInOutCosine: easeInOutSine,
  easeInCircle: easeInCirc,
  easeOutCircle: easeOutCirc
});

/** @returns {(t: number) => number} */
export function getEasing(name) {
  return EASINGS[name] ?? EASINGS.linear;
}

/** Eased progress of `elapsed` over `duration`, clamped to [0, 1] on the input. */
export function easedProgress(elapsed, duration, ease) {
  if (!(duration > 0)) return 1;
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return getEasing(ease)(t);
}
