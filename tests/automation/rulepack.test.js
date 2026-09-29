import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SystemAdapter } from "../../src/shared/adapter.js";
import { loadRulePack } from "../../src/automation/rulepack.js";
import { createRulesStore } from "../../src/automation/rules.js";
import { PRESET_IDS, STAGE_IDS, checkRulePack } from "../../src/automation/schema.js";
import { EVENT_TYPES } from "../../src/shared/events.js";
import { DummyAdapter, fakeItem } from "./helpers/dummy-adapter.js";
import { bootAutomation } from "./helpers/setup.js";

const root = join(import.meta.dirname, "../..");
const recipe = { version: 1, preset: "ranged", animation: "jb2a.fire_bolt.orange" };
const pack = (extra = {}) => ({
  system: "dummy",
  version: 1,
  rules: [{ id: "bolt", match: { key: "fire-bolt" }, recipe }],
  ...extra
});
const respond = (body, status = 200) =>
  vi.fn(async () => ({ ok: status < 400, status, json: async () => structuredClone(body) }));

describe("loadRulePack", () => {
  it("loads, validates and installs the active system's pack", async () => {
    const rules = createRulesStore();
    const fetch = respond(pack());
    const res = await loadRulePack(new DummyAdapter({}), rules, { fetch });
    expect(fetch).toHaveBeenCalledWith("modules/sargas-visual-automation/rules/dummy.json");
    expect(res).toMatchObject({ loaded: 1, errors: [] });
    expect(rules.systemRules()[0]).toMatchObject({ id: "bolt", enabled: true, priority: 0 });
    expect(rules.systemId).toBe("dummy");
  });

  it("loads nothing without an adapter (unsupported system)", async () => {
    const rules = createRulesStore();
    const fetch = respond(pack());
    expect(await loadRulePack(null, rules, { fetch })).toMatchObject({ loaded: 0, url: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads nothing when the adapter has no pack", async () => {
    class NoPack extends SystemAdapter {
      static id = "nopack";
      get rulePackUrl() {
        return null;
      }
    }
    const fetch = respond(pack());
    expect((await loadRulePack(new NoPack({}), createRulesStore(), { fetch })).loaded).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("survives a missing file, network errors and invalid packs", async () => {
    const rules = createRulesStore();
    const adapter = new DummyAdapter({});
    expect((await loadRulePack(adapter, rules, { fetch: respond({}, 404) })).loaded).toBe(0);
    const boom = vi.fn(async () => {
      throw new Error("offline");
    });
    expect((await loadRulePack(adapter, rules, { fetch: boom })).errors).toEqual(["offline"]);
    expect((await loadRulePack(adapter, rules, { fetch: respond({ version: 1 }) })).loaded).toBe(0);
    expect(rules.systemRules()).toEqual([]);
  });

  it("keeps valid rules and reports invalid ones or a system mismatch", async () => {
    const rules = createRulesStore();
    const body = pack({ system: "other", rules: [...pack().rules, { id: "bad", match: {}, recipe }] });
    const res = await loadRulePack(new DummyAdapter({}), rules, { fetch: respond(body) });
    expect(res.loaded).toBe(1);
    expect(res.errors.join("\n")).toMatch(/rules\[1\]/);
    expect(res.errors.join("\n")).toMatch(/"other"/);
  });

  it("uses foundry.utils.getRoute for relative urls", async () => {
    globalThis.foundry = { utils: { getRoute: (p) => `/prefix/${p}` } };
    const fetch = respond(pack());
    await loadRulePack(new DummyAdapter({}), createRulesStore(), { fetch });
    expect(fetch).toHaveBeenCalledWith("/prefix/modules/sargas-visual-automation/rules/dummy.json");
    delete globalThis.foundry;
  });
});

describe("ready() merges the pack with world rules", () => {
  it("activates the adapter, loads its pack and resolves through it", async () => {
    globalThis.fetch = respond(pack());
    const { ready } = await import("../../src/automation/index.js");
    const { api } = bootAutomation();
    api.systems.deactivate();
    await ready(api);
    const item = fakeItem({ name: "Fire Bolt", sva: { key: "fire-bolt" } });
    expect(api.automation.resolveRecipe(item)).toMatchObject({ source: "system", ruleId: "bolt" });
    await api.automation.rules.save({ id: "bolt", match: { key: "fire-bolt" }, recipe, enabled: false });
    expect(api.automation.rules.all().filter((r) => r.id === "bolt")).toHaveLength(1);
    expect(api.automation.resolveRecipe(item)).toBeNull();
    delete globalThis.fetch;
  });
});

describe("rules/ documentation", () => {
  const schema = JSON.parse(readFileSync(join(root, "rules/rulepack.schema.json"), "utf8"));

  it("the JSON schema agrees with the validator's enums", () => {
    const defs = schema.$defs;
    expect(defs.recipe.properties.preset.enum).toEqual([...PRESET_IDS]);
    expect(Object.keys(defs.stages.properties)).toEqual([...STAGE_IDS]);
    expect(defs.recipe.properties.triggers.items.enum.sort()).toEqual(Object.values(EVENT_TYPES).sort());
    expect(Object.keys(defs.match.properties).sort()).toEqual(
      ["attackKind", "key", "name", "regex", "traits", "type", "weaponGroup"].sort()
    );
  });

  it("the README example is a valid pack", () => {
    const readme = readFileSync(join(root, "rules/README.md"), "utf8");
    const example = JSON.parse(readme.match(/```json\n([\s\S]*?)```/)[1]);
    const { pack: parsed, errors } = checkRulePack(example);
    expect(errors).toEqual([]);
    expect(parsed.rules).toHaveLength(1);
  });
});
