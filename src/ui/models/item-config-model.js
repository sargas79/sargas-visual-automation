/**
 * View-model helpers for the item recipe editor (#37).
 */

/**
 * Header toggle that turns automation of the item off/on immediately
 * (same behaviour and look as the per-row toggle of the actor overview).
 * @param {boolean} disabled  current `flags[module].disabled` of the item
 */
export function itemDisableToggle(disabled) {
  const off = disabled === true;
  return {
    disabled: off,
    pressed: off ? "true" : "false",
    cssClass: off ? "sva-disable-toggle sva-active" : "sva-disable-toggle",
    icon: off ? "fa-toggle-off" : "fa-toggle-on",
    label: off ? "SVA.UI.ItemConfig.Enable" : "SVA.UI.ItemConfig.Disabled",
    tooltip: off ? "SVA.UI.Overview.Enable" : "SVA.UI.Overview.Disable"
  };
}
