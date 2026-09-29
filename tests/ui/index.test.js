import { describe, expect, it } from "vitest";
import { MODULE_ID } from "../../src/constants.js";
import * as ui from "../../src/ui/index.js";

describe("ui area init", () => {
  it("attaches api.ui and registers the favourites setting", () => {
    const api = {};
    ui.init(api);
    expect(typeof api.ui.openBrowser).toBe("function");
    expect(game.settings.get(MODULE_ID, "uiFavourites")).toEqual([]);
  });

  it("returns null instead of throwing outside Foundry", () => {
    const api = {};
    ui.init(api);
    expect(api.ui.openBrowser()).toBeNull();
  });
});
