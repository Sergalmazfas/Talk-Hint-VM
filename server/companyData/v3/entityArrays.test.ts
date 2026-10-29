import { describe, expect, it } from "vitest";
import { entityArrayEdits } from "./entityArrays";
import { arrayAt, arrayInsert, at, checkFrame, decode, encode, frameHash, replace, type Frame, type FrameStore } from "./codec";

class MemoryStore implements FrameStore {
  frames = new Map<string, Frame>();
  async put(frame: Frame) { const h = frameHash(frame); this.frames.set(h, frame); return h; }
  async get(h: string) { return checkFrame(h, { version: 1, frame: this.frames.get(h)! }); }
  async column() { throw new Error("No columns in structural fixture"); }
}
const a = { id: "a", text: "A" }, b = { id: "b", text: "B" }, c = { id: "c", text: "C" }, d = { id: "d", text: "D" };
const variants = [
  { name: "update old plus append", next: [{ ...a, text: "updated" }, b, c, d] },
  { name: "two updates plus append", next: [{ ...a, text: "first" }, { ...b, text: "second" }, c, d] },
  { name: "equal length reorder", next: [b, c, a] },
  { name: "equal length remove/update/append", next: [{ ...b, text: "updated" }, c, d] },
  { name: "shrink and update", next: [{ ...b, text: "updated" }, c] },
  { name: "insert/reorder/update", next: [d, { ...b, text: "updated" }, c, a] },
];
for (const key of ["elements", "relations", "documents", "proposals", "taskDrafts"]) describe(key, () => {
  for (const v of variants) it(v.name, async () => {
    const store = new MemoryStore(), old = [a, b, c], initial = await encode({ [key]: old }, store);
    const oldArray = await at(initial, [key], store);
    const edits = await entityArrayEdits({ old, next: v.next, oldArray, path: [key], store, columnsFor: () => new Map(),
      documentHypothesis: key === "documents" ? "new-country" : undefined });
    let root = initial;
    for (const edit of edits) {
      let node = edit.referenceHash ?? await encode(edit.value, store, edit.columns);
      if (edit.document) expect(await decode(node, store)).toEqual(v.next.find(item => item.id === edit.document!.id));
      if (edit.insertAt !== undefined) node = await arrayInsert(await at(root, edit.path, store), edit.insertAt, node, store);
      root = await replace(root, edit.path, node, store);
    }
    expect(await decode(root, store)).toEqual({ [key]: v.next });
    expect(await decode(initial, store)).toEqual({ [key]: old });
    for (const item of old) {
      const index = v.next.findIndex(n => n === item);
      if (index >= 0) expect(await arrayAt(await at(root, [key], store), index, store))
        .toBe(await arrayAt(oldArray, old.indexOf(item), store));
    }
  });
});
