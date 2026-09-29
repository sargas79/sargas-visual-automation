/**
 * "Animation" header button on GGA item sheets → api.ui.openItemConfig(item).
 *
 * GGA item sheets are ApplicationV1 (`GurpsItemSheet extends ItemSheet`, module/item-sheet.js, v0.18.23), so the
 * button comes from the V1 hook `getGurpsItemSheetHeaderButtons` (Application#_getHeaderButtons fires
 * `get<ClassName>HeaderButtons` for every class in the chain). Hooking the GGA class name keeps the button off other
 * sheets. Attacks and spells that are only actor data (no Item) are configured through world rules instead.
 * VERIFY(gurps|v14): hook name if GGA moves its item sheet to ApplicationV2.
 */
export const HOOK = "getGurpsItemSheetHeaderButtons";
const BUTTON_CLASS = "sva-item-config";

function localize(key, fallback) {
  const text = globalThis.game?.i18n?.localize?.(key);
  return text && text !== key ? text : fallback;
}

export function addHeaderButton(api, app, buttons) {
  const item = app?.document ?? app?.item ?? app?.object;
  if (!item || item.documentName !== "Item" || !Array.isArray(buttons)) return;
  const user = globalThis.game?.user;
  if (!(user?.isGM || item.isOwner)) return;
  if (buttons.some((b) => b.class === BUTTON_CLASS)) return;
  buttons.unshift({
    label: localize("SVA.Gurps.HeaderButton", "Animation"),
    class: BUTTON_CLASS,
    icon: "fa-solid fa-wand-magic-sparkles",
    onclick: () => {
      const open = api?.ui?.openItemConfig;
      if (typeof open === "function") open.call(api.ui, item);
      else
        globalThis.ui?.notifications?.warn?.(
          localize("SVA.Gurps.ItemConfigUnavailable", "The item animation editor is not available.")
        );
    }
  });
}

/** @returns {() => void} unregister */
export function registerSheetControls(api) {
  const fn = (app, buttons) => addHeaderButton(api, app, buttons);
  Hooks.on(HOOK, fn);
  return () => Hooks.off?.(HOOK, fn);
}
