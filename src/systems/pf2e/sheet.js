/**
 * "Animation" header control on PF2e item sheets → api.ui.openItemConfig(item).
 *
 * PF2e 8.5.1 item sheets are still ApplicationV1 (`ItemSheetPF2e extends foundry.appv1.sheets.ItemSheet`,
 * src/module/item/base/sheet/sheet.ts), so the header button comes from the V1 hook `getItemSheetHeaderButtons`
 * (fired for every class in the sheet's inheritance chain by Application#_getHeaderButtons).
 * For ApplicationV2 item sheets (future PF2e releases, other sheet modules) we also hook
 * `getHeaderControlsDocumentSheetV2` (fired per class by ApplicationV2#_getHeaderControls).
 */
export const HEADER_ACTION = "svaItemConfig";
const ICON = "fa-solid fa-wand-magic-sparkles";

function localize(key, fallback) {
  const text = globalThis.game?.i18n?.localize?.(key);
  return text && text !== key ? text : fallback;
}

function canConfigure(item) {
  if (!item || item.documentName !== "Item") return false;
  const user = globalThis.game?.user;
  return !!(user?.isGM || item.isOwner);
}

function openConfig(api, item) {
  const open = api?.ui?.openItemConfig;
  if (typeof open !== "function") {
    globalThis.ui?.notifications?.warn?.(
      localize("SVA.Pf2e.ItemConfigUnavailable", "Item animation editor unavailable.")
    );
    return;
  }
  open.call(api.ui, item);
}

/** V1 hook handler: (app, buttons) */
export function addV1HeaderButton(api, app, buttons) {
  const item = app?.document ?? app?.item ?? app?.object;
  if (!canConfigure(item) || !Array.isArray(buttons)) return;
  if (buttons.some((b) => b.class === "sva-item-config")) return;
  buttons.unshift({
    label: localize("SVA.Pf2e.HeaderButton", "Animation"),
    class: "sva-item-config",
    icon: ICON,
    onclick: () => openConfig(api, item)
  });
}

/** V2 hook handler: (app, controls) */
export function addV2HeaderControl(api, app, controls) {
  const item = app?.document;
  if (!canConfigure(item) || !Array.isArray(controls)) return;
  if (controls.some((c) => c.action === HEADER_ACTION)) return;
  // VERIFY(v14): header controls dispatch through `app.options.actions[action]`; `options` is frozen shallowly
  // so the nested actions object stays writable. `onClick` is set too for runtimes that support it.
  try {
    const actions = app.options?.actions;
    if (actions && !actions[HEADER_ACTION]) actions[HEADER_ACTION] = () => openConfig(api, item);
  } catch {
    // actions not writable - rely on onClick
  }
  controls.push({
    icon: ICON,
    label: localize("SVA.Pf2e.HeaderButton", "Animation"),
    action: HEADER_ACTION,
    visible: true,
    onClick: () => openConfig(api, item)
  });
}

/** @returns {() => void} unregister */
export function registerSheetControls(api) {
  const v1 = (app, buttons) => addV1HeaderButton(api, app, buttons);
  const v2 = (app, controls) => addV2HeaderControl(api, app, controls);
  const hooks = [
    ["getItemSheetHeaderButtons", v1],
    ["getHeaderControlsDocumentSheetV2", v2]
  ];
  for (const [hook, fn] of hooks) Hooks.on(hook, fn);
  return () => {
    for (const [hook, fn] of hooks) Hooks.off?.(hook, fn);
  };
}
