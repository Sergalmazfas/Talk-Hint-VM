import { describe, expect, it } from "vitest";
import { at, arrayInsert, checkFrame, decode, encode, frameHash, replace, type Frame, type FrameStore } from "./codec";

class Memory implements FrameStore {
  frames = new Map<string, Frame>();
  async put(f: Frame) { const id = frameHash(f); this.frames.set(id, f); return id; }
  async get(id: string) { const f = this.frames.get(id); if (!f) throw new Error("Missing frame"); return checkFrame(id, { version: 1, frame: f }); }
  async column() { throw new Error("Unexpected column"); }
}
describe("company v3 immutable contract", () => {
  it("preserves absent/null/empty/numeric keys/array order/exact strings", async () => {
    const s = new Memory(), value = { empty: {}, list: [], nil: null, object: { "0": "zero" },
      array: [null, "", "😀 e\u0301\r\n", { y: false, x: 1.25 }] };
    expect(await decode(await encode(value, s), s)).toEqual(value);
  });
  it("rejects unsupported contracts and corrupted frames", () => {
    expect(() => checkFrame("x", { version: 2, frame: { kind: "scalar", value: 1 } })).toThrow("Unsupported");
    expect(() => checkFrame("x", { version: 1, frame: { kind: "scalar", value: 1 } })).toThrow("digest");
  });
  it("prepends a revision without renumbering/copying its contents", async () => {
    const s = new Memory(), original = Array.from({ length: 1500 }, (_, i) => ({ id: `role-${i}`, n: i }));
    const root = await encode({ revisions: original }, s), before = s.frames.size;
    const revisions = await at(root, ["revisions"], s), entry = await encode({ id: "new", n: -1 }, s);
    const next = await replace(root, ["revisions"], await arrayInsert(revisions, 0, entry, s), s);
    expect(s.frames.size - before).toBeLessThan(20);
    expect(await decode(root, s)).toEqual({ revisions: original });
    expect(await decode(next, s)).toEqual({ revisions: [{ id: "new", n: -1 }, ...original] });
  });
  it("changes a single role with logarithmic structural overhead", async () => {
    const s = new Memory(), root = await encode({ roles: Array.from({ length: 1000 }, (_, i) => ({ id: i, name: "old" })) }, s);
    const before = s.frames.size;
    const next = await replace(root, ["roles", "666", "name"], await encode("new", s), s);
    expect(s.frames.size - before).toBeLessThan(15);
    expect((await decode(next, s)).roles[666].name).toBe("new");
    expect((await decode(root, s)).roles[666].name).toBe("old");
  });
});
