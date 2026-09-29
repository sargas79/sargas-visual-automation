/**
 * UI actions that talk to other areas through the public api only.
 */

/**
 * Play a database path on every source token. When targets are given and
 * the animation is a ranged one (it has a JB2A `_template`), the effect is
 * stretched from each source to the first target instead.
 * @param {object} api module api (needs api.sequence, optionally api.db)
 * @param {string} path JB2A database path
 * @param {{sources: object[], targets?: object[], broadcast?: boolean}} options
 * @returns {Promise<boolean>} false when nothing could be played
 */
export async function playOnTokens(api, path, { sources, targets = [], broadcast = false }) {
  if (typeof api?.sequence !== "function" || !path || !sources?.length) return false;
  let ranged;
  try {
    ranged = !!api.db?.resolve?.(path)?.template;
  } catch {
    ranged = false;
  }
  const sequence = api.sequence();
  for (const source of sources) {
    const effect = sequence.effect().file(path).atLocation(source);
    if (ranged && targets.length && targets[0] !== source) effect.stretchTo(targets[0]);
  }
  await sequence.play({ broadcast });
  return true;
}
