import { describe, expect, it } from "vitest";
import { itemDisableToggle } from "../../src/ui/models/item-config-model.js";

describe("item config model", () => {
  it("describes the instant disable toggle like the overview row toggle", () => {
    expect(itemDisableToggle(false)).toEqual({
      disabled: false,
      pressed: "false",
      cssClass: "sva-disable-toggle",
      icon: "fa-toggle-on",
      label: "SVA.UI.ItemConfig.Disabled",
      tooltip: "SVA.UI.Overview.Disable"
    });
    expect(itemDisableToggle(true)).toMatchObject({
      disabled: true,
      pressed: "true",
      cssClass: "sva-disable-toggle sva-active",
      icon: "fa-toggle-off",
      label: "SVA.UI.ItemConfig.Enable",
      tooltip: "SVA.UI.Overview.Enable"
    });
    expect(itemDisableToggle(undefined).disabled).toBe(false);
  });
});
