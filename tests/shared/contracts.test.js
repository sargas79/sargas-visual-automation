import { describe, expect, it } from "vitest";
import { createSequence, LAYERS, normalizeEffect } from "../../src/shared/descriptors.js";
import { createAutomationEvent, EVENT_TYPES, OUTCOMES } from "../../src/shared/events.js";
import { SystemAdapter } from "../../src/shared/adapter.js";

describe("descriptors", () => {
  it("normalizes effects with defaults and an id", () => {
    const e = normalizeEffect({ file: "jb2a.fire_bolt.orange", atLocation: { tokenId: "a" } });
    expect(e).toMatchObject({ opacity: 1, layer: LAYERS.ABOVE_TOKENS });
    expect(e.id).toBeTypeOf("string");
  });

  it("rejects effects without file or location", () => {
    expect(() => normalizeEffect({ atLocation: { x: 0, y: 0 } })).toThrow();
    expect(() => normalizeEffect({ file: "x" })).toThrow();
  });

  it("builds JSON-safe sequences", () => {
    const seq = createSequence(
      [
        { type: "effect", effect: { file: "f", atLocation: { x: 1, y: 2 } } },
        { type: "wait", ms: 100 }
      ],
      {
        sceneId: "s",
        userId: "u"
      }
    );
    expect(JSON.parse(JSON.stringify(seq))).toEqual(seq);
    expect(seq.steps[0].effect.id).toBeTypeOf("string");
  });
});

describe("events", () => {
  it("fills defaults", () => {
    const ev = createAutomationEvent({ type: EVENT_TYPES.ATTACK });
    expect(ev).toMatchObject({ outcome: OUTCOMES.NONE, targets: [], userId: "user1" });
  });

  it("rejects unknown types", () => {
    expect(() => createAutomationEvent({ type: "nope" })).toThrow();
  });
});

describe("SystemAdapter", () => {
  class TestAdapter extends SystemAdapter {
    static id = "pf2e";
  }

  it("activates by system id", () => {
    expect(TestAdapter.isActive()).toBe(true);
  });

  it("derives keys and rule pack url", () => {
    const a = new TestAdapter({});
    expect(a.getItemKey({ name: "Force Barrage!" })).toBe("force-barrage");
    expect(a.rulePackUrl).toBe("modules/sargas-visual-automation/rules/pf2e.json");
  });
});
