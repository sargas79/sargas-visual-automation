import { describe, expect, it, vi } from "vitest";
import { toAnchor } from "../../src/sequence/anchors.js";
import { SequenceBuilder } from "../../src/sequence/builder.js";
import { mockToken, mockTokenDocument } from "./helpers/engine.js";

const newSequence = (api = {}, options = { sceneId: "scene1", userId: "user1" }) => new SequenceBuilder(api, options);

describe("toAnchor", () => {
  it("accepts tokens, token documents, ids, points and anchors", () => {
    expect(toAnchor(mockToken("t1"))).toEqual({ tokenId: "t1" });
    expect(toAnchor(mockTokenDocument("t2"))).toEqual({ tokenId: "t2" });
    expect(toAnchor("t3")).toEqual({ tokenId: "t3" });
    expect(toAnchor({ x: 5, y: 6 })).toEqual({ x: 5, y: 6 });
    expect(toAnchor({ tokenId: "t4", offset: { x: 1, y: 2 } })).toEqual({ tokenId: "t4", offset: { x: 1, y: 2 } });
    expect(toAnchor("t5", { offset: { x: 0, y: -10 } })).toEqual({ tokenId: "t5", offset: { x: 0, y: -10 } });
  });

  it("returns plain JSON", () => {
    const anchor = toAnchor(mockToken("t1"));
    expect(JSON.parse(JSON.stringify(anchor))).toEqual(anchor);
  });

  it("rejects garbage", () => {
    expect(() => toAnchor(null)).toThrow();
    expect(() => toAnchor({ foo: 1 })).toThrow();
    expect(() => toAnchor({ x: "a", y: 1 })).toThrow();
  });
});

describe("SequenceBuilder", () => {
  it("maps every EffectBuilder setter onto the descriptor", () => {
    const desc = newSequence()
      .effect()
      .file("jb2a.fire_bolt.orange")
      .atLocation(mockToken("src"))
      .stretchTo("tgt", { offset: { x: 1, y: 1 } })
      .rotateTowards({ x: 10, y: 20 })
      .attachTo(mockTokenDocument("src"), { followRotation: true })
      .scale(2)
      .scaleToObject(1.5)
      .size(2, 3, { gridUnits: true })
      .rotate(90)
      .mirrorX()
      .mirrorY(false)
      .opacity(0.5)
      .tint("#ff0000")
      .fadeIn(200, { ease: "easeOutQuad" })
      .fadeOut(300)
      .scaleIn(0, 400, { ease: "easeOutBack" })
      .scaleOut(0.5, 100)
      .duration(1500)
      .playbackRate(2)
      .startTime(100)
      .endTime(50)
      .delay(250)
      .layer("belowTokens")
      .zIndex(3)
      .missed()
      .returnTrip()
      .persist()
      .name("aura:a:b")
      .forUsers([{ id: "u1" }, "u2"])
      .waitUntilFinished(-200)
      .toDescriptor();

    expect(desc).toMatchObject({ version: 1, sceneId: "scene1", userId: "user1", users: [] });
    expect(desc.steps).toHaveLength(1);
    expect(desc.steps[0].waitUntilFinished).toBe(-200);
    expect(desc.steps[0].effect).toMatchObject({
      file: "jb2a.fire_bolt.orange",
      atLocation: { tokenId: "src" },
      stretchTo: { tokenId: "tgt", offset: { x: 1, y: 1 } },
      rotateTowards: { x: 10, y: 20 },
      attachTo: { tokenId: "src", followRotation: true },
      scale: 2,
      scaleToObject: 1.5,
      size: { width: 2, height: 3, gridUnits: true },
      rotation: 90,
      mirrorX: true,
      mirrorY: false,
      opacity: 0.5,
      tint: "#ff0000",
      fadeIn: { duration: 200, ease: "easeOutQuad" },
      fadeOut: { duration: 300 },
      scaleIn: { value: 0, duration: 400, ease: "easeOutBack" },
      scaleOut: { value: 0.5, duration: 100 },
      duration: 1500,
      playbackRate: 2,
      startTime: 100,
      endTime: 50,
      delay: 250,
      layer: "belowTokens",
      zIndex: 3,
      missed: true,
      returnTrip: true,
      persist: true,
      name: "aura:a:b",
      users: ["u1", "u2"]
    });
    expect(desc.steps[0].effect.id).toBeTypeOf("string");
    expect(JSON.parse(JSON.stringify(desc))).toEqual(desc);
  });

  it("chains effects, waits and sounds in order", () => {
    const desc = newSequence()
      .effect()
      .file("a")
      .atLocation("t1")
      .waitUntilFinished()
      .wait(500)
      .sound("sounds/boom.ogg", { volume: 0.5, delay: 100 })
      .effect({ file: "b", atLocation: mockToken("t2") })
      .toDescriptor();
    expect(desc.steps.map((s) => s.type)).toEqual(["effect", "wait", "sound", "effect"]);
    expect(desc.steps[0].waitUntilFinished).toBe(0);
    expect(desc.steps[1]).toEqual({ type: "wait", ms: 500 });
    expect(desc.steps[2]).toEqual({ type: "sound", file: "sounds/boom.ogg", volume: 0.5, delay: 100 });
    expect(desc.steps[3].effect.atLocation).toEqual({ tokenId: "t2" });
    expect(desc.steps[3].waitUntilFinished).toBeUndefined();
  });

  it("validates effects through normalizeEffect", () => {
    expect(() => newSequence().effect().file("a").toDescriptor()).toThrow();
    expect(() => newSequence().effect().atLocation("t").toDescriptor()).toThrow();
  });

  it("applies sequence-level scene and users", () => {
    const desc = newSequence().onScene("scene2").forUsers(["u9"]).wait(1).toDescriptor();
    expect(desc).toMatchObject({ sceneId: "scene2", users: ["u9"] });
  });

  it("play() hands the descriptor to api.playSequence", async () => {
    const api = { playSequence: vi.fn(async () => {}) };
    await newSequence(api).effect().file("a").atLocation("t").play({ broadcast: false });
    expect(api.playSequence).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }), { broadcast: false });
    await newSequence(api).wait(1).play();
    expect(api.playSequence).toHaveBeenLastCalledWith(expect.anything(), { broadcast: true });
  });
});
