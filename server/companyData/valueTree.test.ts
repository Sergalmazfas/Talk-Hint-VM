import { describe, expect, it } from "vitest";
import { flatten, inflate, semanticHash, assign } from "./valueTree";

describe("lossless typed auxiliary fields", () => {
  it("preserves null/missing, empty containers, exact Unicode, pointers and array order", () => {
    const source = { a: null, b: [], c: {}, "a/b~c": ["😀", "e\u0301", "é", "", 0, false], x: [{ n: 1.25 }] };
    expect(inflate(flatten(source, new Set()))).toEqual(source);
    expect(semanticHash(inflate(flatten(source, new Set())))).toBe(semanticHash(source));
  });
  it("leaves mapped source values to explicit tables", () => {
    const source = { n: "explicit", items: [null, false] };
    const tree = inflate(flatten(source, new Set(["/n", "/items/0"])));
    assign(tree, "/n", "explicit"); assign(tree, "/items/0", null);
    expect(tree).toEqual(source);
  });
  it("does not confuse numeric object keys with array containers", () => {
    const source = { obj: { "0": { "1": false } }, arr: [{ "0": "" }] };
    expect(inflate(flatten(source, new Set()))).toEqual(source);
  });
  it("rejects prototype writes and unsupported JSON values", () => {
    expect(() => assign({}, "/__proto__/x", true)).toThrow();
    expect(() => assign({}, "/ok/constructor", true)).toThrow();
    expect(() => flatten({ n: NaN }, new Set())).toThrow();
    expect(() => flatten({ n: undefined }, new Set())).toThrow();
    expect(({} as any).x).toBeUndefined();
  });
});
