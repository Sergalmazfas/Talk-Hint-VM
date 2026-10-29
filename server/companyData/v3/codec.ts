import { semanticHash } from "../valueTree";

/**
 * A versioned structural contract, not a copy of a JSON document. Values live
 * either in typed business columns or in the typed scalar store. Arrays are
 * persistent ropes: prepending a revision never renumbers its old descendants.
 */
export const CONTRACT_VERSION = 1;
export type Frame =
  | { kind: "scalar"; value: string | number | boolean | null }
  | { kind: "column"; table: string; record: string; column: string }
  | { kind: "object"; keys: string[]; children: string[] }
  | { kind: "array"; children: string[]; length: number }
  | { kind: "concat"; children: [string, string]; length: number }
  | { kind: "snapshot"; child: string };
export interface StoredFrame { version: number; frame: Frame }
export const frameHash = (frame: Frame) => semanticHash({ version: CONTRACT_VERSION, frame });
export function checkFrame(hash: string, value: StoredFrame): Frame {
  if (value.version !== CONTRACT_VERSION) throw new Error(`Unsupported company contract: ${value.version}`);
  if (frameHash(value.frame) !== hash) throw new Error("Company frame digest mismatch");
  const f = value.frame;
  if (f.kind === "object" && (f.keys.length !== f.children.length ||
      new Set(f.keys).size !== f.keys.length ||
      f.keys.some(k => ["__proto__", "prototype", "constructor"].includes(k))))
    throw new Error("Invalid company object contract");
  if ((f.kind === "concat" && f.children.length !== 2) ||
      (f.kind === "array" && f.length !== f.children.length)) throw new Error("Invalid array contract");
  return f;
}

export interface FrameStore {
  get(hash: string): Promise<Frame>;
  put(frame: Frame): Promise<string>;
  column(table: string, record: string, column: string): Promise<unknown>;
}
export async function encode(value: any, store: FrameStore,
  columns: Map<string, Frame> = new Map(), path = ""): Promise<string> {
  const column = columns.get(path);
  if (column) return store.put(column);
  if (value === null || typeof value !== "object") {
    if (!["string", "number", "boolean"].includes(typeof value) && value !== null)
      throw new Error("Non-JSON company value");
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite company number");
    return store.put({ kind: "scalar", value });
  }
  const part = (k: string | number) => `${path}/${String(k).replace(/~/g, "~0").replace(/\//g, "~1")}`;
  if (Array.isArray(value)) {
    const children: string[] = [];
    for (let i = 0; i < value.length; i++) children.push(await encode(value[i], store, columns, part(i)));
    return buildArray(children, store);
  }
  const keys = Object.keys(value).sort(), children: string[] = [];
  for (const k of keys) children.push(await encode(value[k], store, columns, part(k)));
  const result = await store.put({ kind: "object", keys, children });
  return result;
}
export async function buildArray(children: string[], store: FrameStore): Promise<string> {
  if (children.length <= 32) return store.put({ kind: "array", children, length: children.length });
  const half = Math.floor(children.length / 2);
  return store.put({ kind: "concat", length: children.length,
    children: [await buildArray(children.slice(0, half), store), await buildArray(children.slice(half), store)] });
}
export async function arrayLength(hash: string, store: FrameStore): Promise<number> {
  const f = await store.get(hash);
  if (f.kind !== "array" && f.kind !== "concat") throw new Error("Expected company array");
  return f.length;
}
export async function arrayAt(hash: string, index: number, store: FrameStore): Promise<string> {
  const f = await store.get(hash);
  if ((f.kind !== "array" && f.kind !== "concat") || index < 0 || index >= f.length)
    throw new Error("Company array index outside bounds");
  if (f.kind === "array") return f.children[index];
  const left = await arrayLength(f.children[0], store);
  return index < left ? arrayAt(f.children[0], index, store) : arrayAt(f.children[1], index - left, store);
}
export async function arrayInsert(hash: string, index: number, child: string, store: FrameStore): Promise<string> {
  const f = await store.get(hash);
  if ((f.kind !== "array" && f.kind !== "concat") || index < 0 || index > f.length)
    throw new Error("Company array insertion outside bounds");
  if (f.kind === "array") {
    const children = [...f.children]; children.splice(index, 0, child);
    return buildArray(children, store);
  }
  const left = await arrayLength(f.children[0], store);
  const children: [string, string] = [...f.children];
  if (index <= left) children[0] = await arrayInsert(children[0], index, child, store);
  else children[1] = await arrayInsert(children[1], index - left, child, store);
  return store.put({ kind: "concat", children, length: f.length + 1 });
}
export async function at(hash: string, path: string[], store: FrameStore): Promise<string> {
  for (const key of path) {
    const f = await store.get(hash);
    if (f.kind === "object") {
      const index = f.keys.indexOf(key);
      if (index < 0) throw new Error(`Missing company field: ${key}`);
      hash = f.children[index];
    } else hash = await arrayAt(hash, Number(key), store);
  }
  return hash;
}
export async function replace(hash: string, path: string[], child: string, store: FrameStore): Promise<string> {
  if (!path.length) return child;
  const [key, ...rest] = path, f = await store.get(hash);
  if (f.kind === "object") {
    const keys = [...f.keys], children = [...f.children], index = keys.indexOf(key);
    if (index < 0) {
      if (rest.length) throw new Error("Missing company parent");
      keys.push(key); children.push(child);
    } else children[index] = await replace(children[index], rest, child, store);
    return store.put({ kind: "object", keys, children });
  }
  if (f.kind === "array") {
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= f.length) throw new Error("Invalid array replacement");
    const children = [...f.children]; children[index] = await replace(children[index], rest, child, store);
    return store.put({ kind: "array", children, length: f.length });
  }
  if (f.kind === "concat") {
    const index = Number(key), left = await arrayLength(f.children[0], store);
    const children: [string, string] = [...f.children];
    const side = index < left ? 0 : 1;
    children[side] = await replace(children[side], [String(index < left ? index : index - left), ...rest], child, store);
    return store.put({ kind: "concat", children, length: f.length });
  }
  throw new Error("Cannot descend through a company scalar");
}
export async function decode(hash: string, store: FrameStore): Promise<any> {
  const f = await store.get(hash);
  switch (f.kind) {
    case "scalar": return f.value;
    case "column": return store.column(f.table, f.record, f.column);
    case "snapshot": return decode(f.child, store);
    case "object": {
      const out: Record<string, any> = {};
      for (let i = 0; i < f.keys.length; i++) out[f.keys[i]] = await decode(f.children[i], store);
      return out;
    }
    case "array": {
      const out: any[] = [];
      for (const child of f.children) out.push(await decode(child, store));
      return out;
    }
    case "concat": {
      const a = await decode(f.children[0], store), b = await decode(f.children[1], store);
      if (a.length + b.length !== f.length) throw new Error("Company array length mismatch");
      return a.concat(b);
    }
  }
}
