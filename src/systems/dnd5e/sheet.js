/**
 * "Animation" header control on D&D 5e item sheets → api.ui.openItemConfig(item).
 *
 * dnd5e 6.x item sheets are ApplicationV2: `ItemSheet5e extends PrimarySheetMixin(DocumentSheet5e)` and
 * `DocumentSheet5e extends ApplicationV2Mixin(DocumentSheetV2)` (module/applications/item/item-sheet.mjs,
 * module/applications/api/document-sheet.mjs, release-6.0.5). ApplicationV2#_getHeaderControls fires
 * `getHeaderControls<ClassName>` for every class in the inheritance chain, so hooking `getHeaderControlsDocumentSheetV2`
 * also covers third-party V2 item sheets. The V1 hook `getItemSheetHeaderButtons` is kept for legacy sheet modules.
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
      localize("SVA.Dnd5e.ItemConfigUnavailable", "Item animation editor unavailable.")
    );
    return;
  }
  open.call(api.ui, item);
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
    label: localize("SVA.Dnd5e.HeaderButton", "Animation"),
    action: HEADER_ACTION,
    visible: true,
    onClick: () => openConfig(api, item)
  });
}

/** V1 hook handler: (app, buttons) */
export function addV1HeaderButton(api, app, buttons) {
  const item = app?.document ?? app?.item ?? app?.object;
  if (!canConfigure(item) || !Array.isArray(buttons)) return;
  if (buttons.some((b) => b.class === "sva-item-config")) return;
  buttons.unshift({
    label: localize("SVA.Dnd5e.HeaderButton", "Animation"),
    class: "sva-item-config",
    icon: ICON,
    onclick: () => openConfig(api, item)
  });
}

/** @returns {() => void} unregister */
export function registerSheetControls(api) {
  const v1 = (app, buttons) => addV1HeaderButton(api, app, buttons);
  const v2 = (app, controls) => addV2HeaderControl(api, app, controls);
  const hooks = [
    ["getHeaderControlsDocumentSheetV2", v2],
    ["getItemSheetHeaderButtons", v1]
  ];
  for (const [hook, fn] of hooks) Hooks.on(hook, fn);
  return () => {
    for (const [hook, fn] of hooks) Hooks.off?.(hook, fn);
  };
}
