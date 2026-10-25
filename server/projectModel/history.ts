import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ProjectModelState } from "../../shared/projectModel";
import { ModelError } from "./modelError";

type Json = any;
type Queryable = Pick<Pool | PoolClient, "query">;
const marker = "__modelHistoryV1";
const digest = (value: unknown) => `h:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
function archiveHeads(value: Json, heads: string[] = []): string[] {
  if (!value || typeof value !== "object") return heads;
  if (value[marker]) Object.values(value[marker]).forEach((ref: any) => heads.push(ref.head));
  Object.entries(value).forEach(([k, v]) => { if (k !== marker) archiveHeads(v, heads); });
  return heads;
}
// jsonb reorders object keys; hashes must not depend on insertion order.
function canonical(value: Json): Json {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
function historical(parent: Json, key: string) {
  return key === "revisions" || key === "researchHistory" || key === "mapVersions" || key === "operations" ||
    (key === "decisions" && parent.schema === 1);
}

/** Same domain model, immutable history chunks. No second card/crew catalogue. */
export function packModel(state: ProjectModelState) {
  const chunks = new Map<string, Json>();
  function walk(value: Json): Json {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const result: Json = {}, archives: Json = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === marker) throw new ModelError(503, "Модель должна быть прочитана вместе с архивом перед записью.");
      if (Array.isArray(child) && historical(value, key) && child.length > 1) {
        // Stable boundaries deduplicate earlier chunks on subsequent writes.
        const prefix = child.slice(0, -1);
        let previous: string | null = null;
        for (let i = 0; i < prefix.length; i += 16) {
          const items = prefix.slice(i, i + 16).map(walk);
          const payload = canonical({ previous, items, refs: archiveHeads(items) });
          const hash = digest(payload);
          chunks.set(hash, payload); previous = hash;
        }
        archives[key] = { head: previous, count: prefix.length };
        result[key] = walk(child.slice(-1));
      } else result[key] = walk(child);
    }
    if (Object.keys(archives).length) result[marker] = archives;
    return result;
  }
  return { state: walk(state) as ProjectModelState, chunks };
}

/** Guard the working set, not immutable history. Never mutate or discard input. */
export function activeModelSize(state: ProjectModelState): number {
  function walk(value: Json): Json {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) =>
      [key, Array.isArray(child) && historical(value, key) ?
        (key === "decisions" && value.schema === 1 ? [] : walk(child.slice(-1))) : walk(child)]));
  }
  return JSON.stringify(walk(state)).length;
}

export async function ensureModelHistory(db: Queryable) {
  await db.query(`CREATE TABLE IF NOT EXISTS talkhint_project_model_history (
    owner_key text NOT NULL REFERENCES talkhint_project_models(owner_key),
    key text NOT NULL, payload jsonb NOT NULL,
    PRIMARY KEY(owner_key,key)
  )`);
}

export async function unpackModel(db: Queryable, owner: string, packed: ProjectModelState): Promise<ProjectModelState> {
  const heads = archiveHeads(packed);
  if (!heads.length) return structuredClone(packed); // Legacy JSON needs no migration.
  const rows = await db.query(`WITH RECURSIVE history AS (
    SELECT key,payload FROM talkhint_project_model_history WHERE owner_key=$1 AND key=ANY($2::text[])
    UNION
    SELECT p.key,p.payload FROM history h
      CROSS JOIN LATERAL jsonb_array_elements_text(
        coalesce(h.payload->'refs','[]'::jsonb) || jsonb_build_array(h.payload->>'previous')
      ) refs(key)
      JOIN talkhint_project_model_history p ON p.key=refs.key AND p.owner_key=$1
  ) SELECT key,payload FROM history`, [owner, heads]);
  const chunks = new Map(rows.rows.map(row => [row.key, row.payload]));
  function walk(value: Json): Json {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const result: Json = Object.fromEntries(Object.entries(value).filter(([k]) => k !== marker).map(([k, v]) => [k, walk(v)]));
    for (const [key, ref] of Object.entries(value[marker] ?? {}) as [string, any][]) {
      let head = ref.head;
      const batches: Json[][] = [], seen = new Set<string>();
      while (head) {
        const chunk = chunks.get(head);
        if (!chunk || seen.has(head) || digest(canonical(chunk)) !== head)
          throw new ModelError(503, "Архив модели недоступен или повреждён; запись остановлена, история не удалена.");
        seen.add(head); batches.push(chunk.items); head = chunk.previous;
      }
      const prefix = batches.reverse().flat();
      if (prefix.length !== ref.count || !Array.isArray(result[key]))
        throw new ModelError(503, "Неполная история модели; запись остановлена.");
      result[key] = [...prefix.map(walk), ...result[key]];
    }
    return result;
  }
  return walk(packed);
}

/** Must be called in the SAME owner-locked transaction as the current-row write. */
export async function archiveModel(db: Queryable, owner: string, state: ProjectModelState) {
  const packed = packModel(state);
  const rows = Array.from(packed.chunks, ([key, payload]) => ({ key, payload }));
  rows.push({ key: `r:${state.revision}`, payload: canonical(packed.state) });
  // Bound SQL request size too; a large legacy archive must not become one huge INSERT.
  for (let i = 0; i < rows.length; i += 16)
    await db.query(`INSERT INTO talkhint_project_model_history(owner_key,key,payload)
      SELECT $1,x.key,x.payload FROM jsonb_to_recordset($2::jsonb) AS x(key text,payload jsonb)
      ON CONFLICT(owner_key,key) DO NOTHING`, [owner, JSON.stringify(rows.slice(i, i + 16))]);
  return packed.state;
}
