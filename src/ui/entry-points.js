/**
 * System-agnostic entry points of the actor animation overview (#74):
 *  - token HUD button               (renderTokenHUD)
 *  - actor sheet header control      (ApplicationV1 getActorSheetHeaderButtons, ApplicationV2 getHeaderControlsActorSheetV2)
 *  - token controls button           (added in src/ui/index.js onGetSceneControlButtons)
 *
 * No generic Foundry hook exists for the item context menu of actor sheets (each system builds its own),
 * so there is no context-menu entry here; system adapters may add one with `api.ui.openActorOverview`.
 */
import { MODULE_ID } from "../constants.js";
import { controlledTokens, notify, t } from "./context.js";

export const OVERVIEW_ACTION = "svaActorOverview";
export const OVERVIEW_ICON = "fa-solid fa-wand-magic-sparkles";
export const TOKEN_HUD_SETTING = "uiTokenHud";

/** May the current user open the overview of this actor? */
export function canOpenOverview(actor) {
  if (!actor) return false;
  const user = globalThis.game?.user;
  return !!(user?.isGM || actor.isOwner);
}

function hudEnabled() {
  try {
    return globalThis.game.settings.get(MODULE_ID, TOKEN_HUD_SETTING) !== false;
  } catch {
    return true;
  }
}

/**
 * Actor of the first controlled token (for the token controls button).
 * @returns {object|null}
 */
export function controlledActor() {
  return controlledTokens().find((token) => token?.actor)?.actor ?? null;
}

/** Scene control handler: open the overview for the controlled token. */
export function openForControlled(open) {
  const actor = controlledActor();
  if (!actor) return notify("warn", "SVA.UI.Overview.SelectToken");
  return open(actor);
}

/**
 * `renderTokenHUD` handler: add a button to the right column.
 * VERIFY(v14): TokenHUD is an ApplicationV2 (`html` is an HTMLElement) with `.col.right` holding
 * `button.control-icon` entries; `hud.actor` / `hud.document.actor` is the token's actor.
 * @param {(actor: object) => any} open
 */
export function addTokenHudButton(open, hud, html) {
  if (!hudEnabled()) return false;
  const actor = hud?.actor ?? hud?.document?.actor ?? hud?.object?.actor ?? null;
  if (!canOpenOverview(actor)) return false;
  const root = typeof html?.querySelector === "function" ? html : (html?.[0] ?? hud?.element ?? null);
  const column = root?.querySelector?.(".col.right") ?? root?.querySelector?.(".col.left");
  if (!column || column.querySelector(`[data-sva-action="${OVERVIEW_ACTION}"]`)) return false;
  const button = (root.ownerDocument ?? globalThis.document).createElement("button");
  button.type = "button";
  button.className = "control-icon sva-hud-button";
  button.dataset.svaAction = OVERVIEW_ACTION;
  button.dataset.tooltip = t("SVA.UI.Overview.Open");
  button.setAttribute("aria-label", t("SVA.UI.Overview.Open"));
  button.innerHTML = `<i class="${OVERVIEW_ICON}" inert></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    open(actor);
  });
  column.append(button);
  return true;
}

/** Actor of a sheet application (V1 `object`/`actor`, V2 `document`). */
function sheetActor(app) {
  const doc = app?.document ?? app?.actor ?? app?.object ?? null;
  return doc?.documentName === "Actor" ? doc : null;
}

/** ApplicationV1 actor sheets: `getActorSheetHeaderButtons` (app, buttons). */
export function addV1HeaderButton(open, app, buttons) {
  const actor = sheetActor(app);
  if (!canOpenOverview(actor) || !Array.isArray(buttons)) return false;
  if (buttons.some((b) => b.class === "sva-actor-overview")) return false;
  buttons.unshift({
    label: t("SVA.UI.Overview.HeaderButton"),
    class: "sva-actor-overview",
    icon: OVERVIEW_ICON,
    onclick: () => open(actor)
  });
  return true;
}

/** ApplicationV2 actor sheets: `getHeaderControlsActorSheetV2` (app, controls). */
export function addV2HeaderControl(open, app, controls) {
  const actor = sheetActor(app);
  if (!canOpenOverview(actor) || !Array.isArray(controls)) return false;
  if (controls.some((c) => c.action === OVERVIEW_ACTION)) return false;
  // VERIFY(v14): header controls dispatch through `app.options.actions[action]`; `onClick` is set too.
  try {
    const actions = app.options?.actions;
    if (actions && !actions[OVERVIEW_ACTION]) actions[OVERVIEW_ACTION] = () => open(actor);
  } catch {
    // actions not writable - rely on onClick
  }
  controls.push({
    icon: OVERVIEW_ICON,
    label: t("SVA.UI.Overview.HeaderButton"),
    action: OVERVIEW_ACTION,
    visible: true,
    onClick: () => open(actor)
  });
  return true;
}

/**
 * Register the hooks. VERIFY(v14): hook names are `get${SheetClass.name}HeaderButtons` (V1, fired for every
 * class in the chain, so the core `ActorSheet` name covers system sheets) and `getHeaderControls${Class.name}`
 * (V2, `ActorSheetV2` covers every V2 actor sheet).
 * @param {(actor: object) => any} open
 * @returns {() => void} unregister
 */
export function registerOverviewEntryPoints(open) {
  const hooks = globalThis.Hooks;
  if (!hooks?.on) return () => {};
  const list = [
    ["renderTokenHUD", (hud, html) => addTokenHudButton(open, hud, html)],
    ["getActorSheetHeaderButtons", (app, buttons) => addV1HeaderButton(open, app, buttons)],
    ["getHeaderControlsActorSheetV2", (app, controls) => addV2HeaderControl(open, app, controls)]
  ];
  for (const [name, fn] of list) hooks.on(name, fn);
  return () => {
    for (const [name, fn] of list) hooks.off?.(name, fn);
  };
}
