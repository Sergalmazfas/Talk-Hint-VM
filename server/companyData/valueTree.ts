/** Reversible typed leaves. Never stores JSON text as a substitute for core tables. */
import { createHash } from "node:crypto";
export type Json = any;
export const canonical = (v: Json): Json => Array.isArray(v) ? v.map(canonical) :
  v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
/** Same canonical JSON digest without allocating a second copy of a large model. */
export function semanticHash(value: Json): string {
  const hash = createHash("sha256");
  function walk(v: Json) {
    if (v === null || typeof v !== "object") {
      const text = JSON.stringify(v);
      if (text === undefined) throw new Error("Non-JSON value");
      hash.update(text);
    } else if (Array.isArray(v)) {
      hash.update("[");
      v.forEach((item, i) => { if (i) hash.update(","); walk(item); });
      hash.update("]");
    } else {
      hash.update("{");
      Object.keys(v).sort().forEach((k, i) => {
        if (i) hash.update(",");
        hash.update(JSON.stringify(k)); hash.update(":"); walk(v[k]);
      });
      hash.update("}");
    }
  }
  walk(value);
  return hash.digest("hex");
}
export const textHash = (v: string) => createHash("sha256").update(v).digest("hex");
export const escapePointer = (v: string) => v.replace(/~/g, "~0").replace(/\//g, "~1");
export const child = (p: string, k: string | number) => `${p}/${escapePointer(String(k))}`;
export function parts(p: string): string[] {
  if (p === "") return [];
  if (!p.startsWith("/")) throw new Error("Invalid source pointer");
  return p.slice(1).split("/").map(k => k.replace(/~1/g, "/").replace(/~0/g, "~"));
}
export function assign(root: Json, path: string, value: Json) {
  const keys = parts(path);
  if (!keys.length) throw new Error("Root must be a container");
  let at = root;
  for (const [i, k] of Array.from(keys.slice(0, -1).entries())) {
    if (["__proto__", "prototype", "constructor"].includes(k)) throw new Error("Unsafe pointer");
    if (!Object.hasOwn(at, k)) at[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    at = at[k];
    if (!at || typeof at !== "object") throw new Error("Pointer crosses scalar");
  }
  const last = keys.at(-1)!;
  if (["__proto__", "prototype", "constructor"].includes(last)) throw new Error("Unsafe pointer");
  at[last] = value;
}
export interface Leaf {
  source_path: string; value_type: "string" | "number" | "boolean" | "null" | "array" | "object";
  string_value: string | null; number_value: number | null; boolean_value: boolean | null; child_count: number | null;
}
export function flatten(value: Json, mapped: Set<string>): Leaf[] {
  const result: Leaf[] = [];
  function walk(v: Json, path: string) {
    if (mapped.has(path)) return;
    const type = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    if (!["string", "number", "boolean", "null", "array", "object"].includes(type))
      throw new Error("Unsupported value type");
    if (type === "number" && !Number.isFinite(v)) throw new Error("Non-finite number");
    result.push({ source_path: path, value_type: type as Leaf["value_type"],
      string_value: type === "string" ? v : null, number_value: type === "number" ? v : null,
      boolean_value: type === "boolean" ? v : null,
      child_count: type === "array" ? v.length : type === "object" ? Object.keys(v).length : null });
    if (v && typeof v === "object")
      Object.entries(v).forEach(([k, item]) => walk(item, child(path, k)));
  }
  walk(value, "");
  return result;
}
export function inflate(leaves: Leaf[]): Json {
  const root = leaves.find(v => v.source_path === "");
  if (!root || !["array", "object"].includes(root.value_type)) throw new Error("Missing root");
  const output: Json = root.value_type === "array" ? [] : {};
  for (const leaf of [...leaves].sort((a, b) => parts(a.source_path).length - parts(b.source_path).length)) {
    if (!leaf.source_path) continue;
    const value = leaf.value_type === "array" ? [] : leaf.value_type === "object" ? {} :
      leaf.value_type === "null" ? null : leaf.value_type === "string" ? leaf.string_value :
      leaf.value_type === "boolean" ? leaf.boolean_value : Number(leaf.number_value);
    assign(output, leaf.source_path, value);
  }
  return output;
}
