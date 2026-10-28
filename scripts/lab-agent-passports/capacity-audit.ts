/** One-off read-only audit. No model mutation, retention, timer or notification. */
import { Pool } from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { activeModelSize, modelSizeBudget } from "../../server/projectModel/sizeBudget";
import { unpackModel } from "../../server/projectModel/history";
import { readHypothesis } from "../../server/projectModel/hypotheses";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const out = "generated-artifacts/model-capacity";
function active(value: any): any {
  if (Array.isArray(value)) return value.map(active);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== "__modelHistoryV1").map(([k, v]) => [k,
    Array.isArray(v) && (["revisions", "researchHistory", "mapVersions", "operations"].includes(k) ||
      (k === "decisions" && value.schema === 1)) ? (k === "decisions" ? [] : active(v.slice(-1))) : active(v)]));
}
const length = (x: any) => JSON.stringify(x).length;
const parts = (x: any) => Object.entries(x ?? {}).map(([key, value]) => ({
  key, units: length(value), count: Array.isArray(value) ? value.length : undefined,
})).sort((a, b) => b.units - a.units);
function stamp(model: any) {
  const dates: string[] = [];
  for (const object of [model, model.decisions?.at(-1), model.operatingModel?.revisions?.at(-1),
      ...(model.documents ?? [])])
    for (const key of ["at", "createdAt", "updatedAt", "timestamp", "savedAt"])
      if (typeof object?.[key] === "string" && /^\d{4}-\d\d-\d\dT/.test(object[key]))
        dates.push(object[key]);
  return dates.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}
try {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev audit only");
  const db = await pool.connect();
  try {
    await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await db.query("SET LOCAL statement_timeout='90s'");
    const rows = await db.query(`SELECT owner_key,revision,state,updated_at,pg_column_size(state) stored_bytes
      FROM talkhint_project_models WHERE EXISTS
      (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) h WHERE h->>'id'='new-country')`);
    assert.equal(rows.rowCount, 1);
    const row = rows.rows[0];
    const root = await unpackModel(db, row.owner_key, row.state);
    const selected = readHypothesis(root, "new-country"), view = active(selected);
    assert.equal(length(view), activeModelSize(selected), "Attribution must match actual guard");
    assert.equal(activeModelSize(readHypothesis(active(row.state), "new-country")), activeModelSize(selected),
      "Packed-snapshot size calculation must match hydrated guard");
    const storage = await db.query(`SELECT count(*)::int chunks,
      count(*) FILTER (WHERE key LIKE 'r:%')::int revision_snapshots,
      sum(pg_column_size(payload))::text stored_payload_bytes,
      sum(pg_column_size(payload)) FILTER (WHERE key LIKE 'r:%')::text snapshot_bytes,
      sum(pg_column_size(payload)) FILTER (WHERE key LIKE 'h:%')::text history_chunk_bytes
      FROM talkhint_project_model_history WHERE owner_key=$1`, [row.owner_key]);
    const tables = await db.query(`SELECT relname,pg_total_relation_size(relid)::text total_relation_bytes
      FROM pg_catalog.pg_statio_user_tables WHERE relname IN
      ('talkhint_project_models','talkhint_project_model_history','call_lab_jobs')`);
    const keys = await db.query(`SELECT key FROM talkhint_project_model_history
      WHERE owner_key=$1 AND key LIKE 'r:%' ORDER BY substring(key FROM 3)::int`, [row.owner_key]);
    const all = keys.rows.map(r => r.key);
    const chosen = Array.from(new Set([...all.slice(-24), ...Array.from({ length: 10 }, (_, i) =>
      all[Math.floor(i * (all.length - 1) / 9)])])).filter(Boolean);
    const samples: any[] = [];
    for (const key of chosen) {
      const r = await db.query("SELECT payload FROM talkhint_project_model_history WHERE owner_key=$1 AND key=$2", [row.owner_key, key]);
      const packed = r.rows[0].payload;
      const snapshot = active(packed);
      if (!snapshot.alternatives?.some((a: any) => a.id === "new-country")) continue;
      const hypothesis = readHypothesis(snapshot, "new-country");
      samples.push({ revision: Number(key.slice(2)), at: stamp(readHypothesis(packed, "new-country")) ?? stamp(packed),
        units: activeModelSize(hypothesis), documents: hypothesis.documents.length });
    }
    samples.sort((a, b) => a.revision - b.revision);
    const occurrences: Record<string, { id: string; occurrences: number; textUnits: number }> = {};
    function countDocs(value: any) {
      if (!value || typeof value !== "object") return;
      if (typeof value.id === "string" && value.id.startsWith("DOC-") && typeof value.text === "string") {
        const d = occurrences[value.id] ??= { id: value.id, occurrences: 0, textUnits: 0 };
        d.occurrences++; d.textUnits += value.text.length;
      }
      Object.values(value).forEach(countDocs);
    }
    countDocs(view);
    const result = {
      capturedAt: new Date().toISOString(), environment: "development", hypothesis: "new-country",
      revision: row.revision, updatedAt: row.updated_at, units: "JavaScript UTF-16 code units, not bytes",
      active: { occupied: activeModelSize(selected), limit: modelSizeBudget(selected),
        free: modelSizeBudget(selected) - activeModelSize(selected),
        percent: activeModelSize(selected) / modelSizeBudget(selected) * 100 },
      envelope: { occupied: activeModelSize(root), limit: modelSizeBudget(root) },
      topLevel: parts(view), operating: parts(view.operatingModel),
      latestOperatingSnapshot: parts(view.operatingModel?.revisions?.at(-1)?.data),
      largestOperatingNodes: (view.operatingModel?.revisions?.at(-1)?.data?.nodes ?? [])
        .map((n: any) => ({ id: n.id, code: n.code, type: n.kind ?? n.type, units: length(n) }))
        .sort((a: any, b: any) => b.units - a.units).slice(0, 10),
      latestModelRevision: parts(view.revisions?.at(-1)), revisionFields: Object.keys(view.revisions?.at(-1) ?? {}),
      documents: selected.documents.map(d => ({ id: d.id, title: d.title, textUnits: d.text.length,
        objectUnits: length(d) })).sort((a, b) => b.objectUnits - a.objectUnits),
      documentOccurrences: Object.values(occurrences).sort((a, b) => b.textUnits - a.textUnits),
      rootStoredBytes: row.stored_bytes, history: storage.rows[0], tables: tables.rows,
      revisionSamples: samples, timeBasis: "Latest model-side decision/document/op timestamp; not SQL COMMIT time",
      sqlReadOnly: true, modelWrites: 0,
    };
    await db.query("COMMIT");
    await mkdir(out, { recursive: true });
    await writeFile(`${out}/FACTS.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { db.release(); }
} finally { await pool.end(); }
