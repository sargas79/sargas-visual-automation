import { describe, expect, it, vi } from "vitest";
import { playOnTokens } from "../../src/ui/actions.js";

function createSequenceMock() {
  const effects = [];
  const play = vi.fn(async () => {});
  const sequence = vi.fn(() => ({
    effect() {
      const calls = {};
      const builder = {};
      for (const name of ["file", "atLocation", "stretchTo"]) {
        builder[name] = (value) => {
          calls[name] = value;
          return builder;
        };
      }
      effects.push(calls);
      return builder;
    },
    play
  }));
  return { sequence, effects, play };
}

describe("playOnTokens", () => {
  it("plays at each source token, locally by default", async () => {
    const { sequence, effects, play } = createSequenceMock();
    const ok = await playOnTokens({ sequence, db: { resolve: () => ({ template: null }) } }, "jb2a.x", {
      sources: ["t1", "t2"],
      targets: ["t3"]
    });
    expect(ok).toBe(true);
    expect(effects).toEqual([
      { file: "jb2a.x", atLocation: "t1" },
      { file: "jb2a.x", atLocation: "t2" }
    ]);
    expect(play).toHaveBeenCalledWith({ broadcast: false });
  });

  it("stretches ranged animations to the first target", async () => {
    const { sequence, effects, play } = createSequenceMock();
    await playOnTokens({ sequence, db: { resolve: () => ({ template: { gridSize: 200 } }) } }, "jb2a.bolt", {
      sources: ["t1"],
      targets: ["t3"],
      broadcast: true
    });
    expect(effects[0]).toEqual({ file: "jb2a.bolt", atLocation: "t1", stretchTo: "t3" });
    expect(play).toHaveBeenCalledWith({ broadcast: true });
  });

  it("does nothing without the sequence api or sources", async () => {
    expect(await playOnTokens({}, "jb2a.x", { sources: ["t1"] })).toBe(false);
    const { sequence } = createSequenceMock();
    expect(await playOnTokens({ sequence }, "jb2a.x", { sources: [] })).toBe(false);
  });
});
