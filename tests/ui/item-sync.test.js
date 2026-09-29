import { describe, expect, it } from "vitest";
import { isSameItem, itemUpdateAction, sameJson } from "../../src/ui/models/item-sync.js";

describe("item sync model", () => {
  it("compares recipes ignoring key order and undefined fields", () => {
    expect(sameJson({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1, d: undefined })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson({ c: [1, 2] }, { c: [2, 1] })).toBe(false);
    expect(sameJson(null, undefined)).toBe(true);
    expect(sameJson(null, {})).toBe(false);
  });

  it("identifies the same item by uuid, then by id and parent", () => {
    const a = { uuid: "Actor.x.Item.y", id: "y" };
    expect(isSameItem(a, { uuid: "Actor.x.Item.y" })).toBe(true);
    expect(isSameItem(a, { uuid: "Actor.z.Item.y", id: "y" })).toBe(false);
    expect(isSameItem({ id: "y", parent: { id: "x" } }, { id: "y", parent: { id: "x" } })).toBe(true);
    expect(isSameItem({ id: "y", parent: { id: "x" } }, { id: "y" })).toBe(false);
    expect(isSameItem(a, null)).toBe(false);
    expect(isSameItem(a, a)).toBe(true);
  });

  it("reloads a clean editor, prompts a dirty one and ignores other items and own saves", () => {
    const editing = { uuid: "Item.a" };
    const base = { preset: "ranged", animation: "jb2a.x" };
    const state = { editing, updated: { uuid: "Item.a" }, draft: { ...base }, baseline: base };
    expect(itemUpdateAction(state)).toBe("reload");
    expect(itemUpdateAction({ ...state, draft: { ...base, animation: "jb2a.y" } })).toBe("prompt");
    expect(itemUpdateAction({ ...state, updated: { uuid: "Item.b" } })).toBe("ignore");
    expect(itemUpdateAction({ ...state, saving: true })).toBe("ignore");
  });
});
