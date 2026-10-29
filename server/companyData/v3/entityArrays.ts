import type { Frame, FrameStore } from "./codec";
import { arrayAt, buildArray, encode } from "./codec";
import type { DeltaEdit } from "./repository";
import { semanticHash } from "../valueTree";

/**
 * Entity identity is stable, but array membership/order and item content are
 * independent changes. A growing array can still contain modified old items.
 */
export async function entityArrayEdits(options: {
  old: any[]; next: any[]; oldArray: string; path: string[]; store: FrameStore;
  columnsFor: (id: string) => Map<string, Frame>; documentHypothesis?: string;
}): Promise<DeltaEdit[]> {
  const { old, next, oldArray, path, store, columnsFor, documentHypothesis } = options;
  const indices = new Map(old.map((item, i) => [item.id, i]));
  const prefixPreserved = next.length >= old.length && old.every((item, i) => next[i].id === item.id);
  const edits: DeltaEdit[] = [], refs: string[] = [], changedDocuments: DeltaEdit[] = [];
  for (let i = 0; i < next.length; i++) {
    const item = next[i], oldIndex = indices.get(item.id);
    const unchanged = oldIndex !== undefined && semanticHash(old[oldIndex]) === semanticHash(item);
    const document = documentHypothesis === undefined ? undefined : { hypothesis: documentHypothesis, id: item.id };
    if (prefixPreserved) {
      if (unchanged) continue;
      const edit: DeltaEdit = { path: [...path, String(i)], value: item, columns: columnsFor(item.id), document };
      if (i >= old.length) edits.push({ ...edit, path, insertAt: i });
      else edits.push(edit);
    } else {
      // Deletion, replacement or reorder: retain every unchanged item's frame,
      // but encode changed/new items even when the final array length is equal.
      const ref = unchanged ? await arrayAt(oldArray, oldIndex!, store) : await encode(item, store, columnsFor(item.id));
      refs.push(ref);
      if (!unchanged && document) changedDocuments.push({ path: [...path, String(i)], referenceHash: ref, document });
    }
  }
  if (!prefixPreserved) {
    edits.push({ path, referenceHash: await buildArray(refs, store) });
    // Register direct document heads using item frames, not the array frame.
    edits.push(...changedDocuments);
  }
  return edits;
}
