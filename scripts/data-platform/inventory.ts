/** Checkpoint A: SELECT-only evidence. Never imports, creates tables, or touches Hint controls. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { unpackModel } from "../../server/projectModel/history";
import { readHypothesis } from "../../server/projectModel/hypotheses";
import { strategyEntries } from "../../shared/projectStrategy";

const out = "generated-artifacts/data-platform-A";
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const textSha = (v: string) => createHash("sha256").update(v).digest("hex");
function canonical(v: any): any {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
type Field = { path: string; types: string[]; observations: number; maxStringLength: number; target: string };
function destination(path: string): string {
  const p = path.replace(/\$\.alternatives\[\]\.model/g, "$");
  if (p.startsWith("$.alternatives")) return "company_hypotheses + company_extra_fields (ordered envelope metadata)";
  if (/^\$\.(schema|revision|primaryHypothesisId|hypothesisContext)/.test(p)) return "company_workspaces / company_hypotheses (view metadata recomputed)";
  if (p.startsWith("$.operatingModel.revisions[].data.nodes"))
    return "company_entities + company_roles/actions/resources + company_node_refs/inputs/metrics/schedules/reporting/register + company_extra_fields";
  if (p.startsWith("$.operatingModel.revisions[].data.links")) return "company_links + company_extra_fields (readiness)";
  if (p.startsWith("$.operatingModel.revisions[].data.customerPath")) return "company_customer_stages";
  if (p.startsWith("$.operatingModel.revisions[].data.stageReports")) return "company_stage_reports";
  if (p.startsWith("$.operatingModel")) return "company_operating_revisions + company_extra_fields (data metadata)";
  if (p.startsWith("$.elements")) return "company_legacy_elements + company_element_details + company_extra_fields (coordination)";
  if (p.startsWith("$.relations")) return "company_legacy_relations";
  if (p.startsWith("$.documents")) return "company_documents + company_document_versions + company_document_links";
  if (p.startsWith("$.decisions")) return "company_decisions + company_decision_refs + company_extra_fields (immutable before/after)";
  if (p.startsWith("$.proposals")) return "company_proposals + company_extra_fields (change)";
  if (p.startsWith("$.taskDrafts")) return "company_task_drafts + company_extra_fields (references)";
  return "company_extra_fields (typed, ordered, reversible auxiliary sections; no monolithic JSONB)";
}
function inventory(value: unknown, root = "$", map = new Map<string, Field>()): Field[] {
  function walk(v: any, path: string) {
    const type = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    const f = map.get(path) ?? { path, types: [], observations: 0, maxStringLength: 0, target: destination(path) };
    if (!f.types.includes(type)) f.types.push(type);
    f.observations++;
    if (typeof v === "string") f.maxStringLength = Math.max(f.maxStringLength, v.length);
    map.set(path, f);
    if (Array.isArray(v)) v.forEach(item => walk(item, `${path}[]`));
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, child]) => walk(child, `${path}.${k}`));
  }
  walk(value, root);
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
assert.equal(new URL(process.env.DATABASE_URL!).hostname, "helium", "Dev only");
const db = await pool.connect();
try {
  await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await db.query("SET LOCAL statement_timeout='90s'");
  const rows = await db.query(`SELECT owner_key,revision,state,updated_at FROM talkhint_project_models
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(state->'alternatives','[]'::jsonb)) a
      WHERE a->>'id'='new-country')`);
  assert.equal(rows.rowCount, 1, "Do not guess model owner");
  const row = rows.rows[0];
  const state = await unpackModel(db, row.owner_key, row.state);
  const hypotheses = [
    { id: "original", model: readHypothesis(state, "original") },
    ...(state.alternatives ?? []).map(a => ({ id: a.id, model: readHypothesis(state, a.id) })),
  ];
  const fieldInventory = inventory(state);
  const docs = [], findings = [], summaries = [], references: any[] = [];
  for (const { id, model } of hypotheses) {
    const op = model.operatingModel?.revisions.at(-1);
    const nodes = op?.data.nodes ?? [], links = op?.data.links ?? [];
    const nodeSet = new Set(nodes.map(n => n.id));
    const elementSet = new Set(model.elements.map(e => e.id));
    const documentSet = new Set(model.documents.map(d => d.id));
    const competitorSet = new Set(model.competitorDirectory?.records.map(c => c.id) ?? []);
    const strategySet = new Set(strategyEntries(model).map(s => s.key));
    const refStats: Record<string, number> = {};
    for (const n of nodes) {
      for (const field of ["parentId","managerId","clientId","roleId","executorId","recipientId","acceptorId","nextId","resourceIds"] as const) {
        const values = Array.isArray(n[field]) ? n[field] as string[] : [n[field] as string | null | undefined];
        for (const value of values) if (value && !nodeSet.has(value))
          findings.push({ hypothesis: id, kind: "unresolved_node_ref", nodeId: n.id, field, target: value });
      }
      for (const ref of n.referenceIds) {
        const namespace = nodeSet.has(ref) ? "node" : elementSet.has(ref) ? "element" : documentSet.has(ref) ? "document" :
          competitorSet.has(ref) ? "competitor" : strategySet.has(ref) ? "strategy_entry" :
          ref === "analyst-preparation" && model.analystPreparation ? "analyst_preparation" : "declared_unresolved";
        refStats[namespace] = (refStats[namespace] ?? 0) + 1;
        if (namespace === "declared_unresolved") references.push({ hypothesis: id, nodeId: n.id, ref, namespace });
      }
      for (const input of n.inputs) if (input.sourceId && !nodeSet.has(input.sourceId))
        findings.push({ hypothesis: id, kind: "unresolved_input", nodeId: n.id, target: input.sourceId });
      if (n.reporting?.templateDocumentId && !documentSet.has(n.reporting.templateDocumentId))
        findings.push({ hypothesis: id, kind: "unresolved_template", nodeId: n.id, target: n.reporting.templateDocumentId });
    }
    references.push({ hypothesis: id, materialReferenceCounts: refStats });
    for (const [namespace, list] of [["node", nodes], ["link", links], ["element", model.elements],
      ["document", model.documents], ["decision", model.decisions]] as const) {
      const ids = list.map(n => n.id);
      if (new Set(ids).size !== ids.length) findings.push({ hypothesis: id, kind: "duplicate_ids", namespace });
    }
    const collisions = [...elementSet].filter(key => nodeSet.has(key));
    if (collisions.length) findings.push({ hypothesis: id, kind: "namespace_collisions", count: collisions.length });
    for (const link of links) for (const endpoint of [link.from, link.to])
      if (!nodeSet.has(endpoint)) findings.push({ hypothesis: id, kind: "dangling_link", linkId: link.id, endpoint });
    for (const d of model.documents) {
      const item: any = { hypothesis: id, id: d.id, length: d.text.length, sha256: textSha(d.text),
        elementLinks: d.elementIds.length, format: "text", fields: [] };
      for (const ref of d.elementIds)
        if (!elementSet.has(ref)) findings.push({ hypothesis: id, kind: "document_unknown_element", documentId: d.id, ref });
      try {
        const parsed = JSON.parse(d.text);
        item.format = "json";
        item.fields = inventory(parsed).map(f => ({ ...f,
          target: /JOURNAL/.test(d.id) ? "company_journal_cases/events/attempts + reversible typed fields + original document_version"
            : "company_document_versions (exact original text); typed projection only for explicitly versioned forms" }));
        item.topLevelKeys = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : [];
        item.version = parsed?.version ?? null;
        item.caseCount = Array.isArray(parsed?.cases) ? parsed.cases.length : null;
      } catch { /* A text document is not a malformed JSON document by default. */ }
      docs.push(item);
    }
    summaries.push({
      id, counts: { elements: model.elements.length, relations: model.relations.length,
        documents: model.documents.length, proposals: model.proposals.length, decisions: model.decisions.length,
        taskDrafts: model.taskDrafts.length, operatingRevisions: model.operatingModel?.revisions.length ?? 0,
        nodes: nodes.length, links: links.length, customerStages: op?.data.customerPath?.length ?? 0,
        stageReports: op?.data.stageReports.length ?? 0 },
      nodeTypes: Object.fromEntries([...new Set(nodes.map(n => n.kind))].map(kind => [kind, nodes.filter(n => n.kind === kind).length])),
      idSetHashes: Object.fromEntries([["elements", model.elements], ["relations", model.relations],
        ["documents", model.documents], ["decisions", model.decisions], ["nodes", nodes], ["links", links]]
        .map(([kind, items]) => [kind, sha((items as { id: string }[]).map(v => v.id).sort())])),
      canonicalSemanticHash: sha(canonical(model)),
      operatingRevisionHashes: model.operatingModel?.revisions.map(r => ({
        version: r.version, canonicalSemanticHash: sha(canonical(r)), nodes: r.data.nodes.length, links: r.data.links.length,
      })) ?? [],
    });
  }
  const tables = await db.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`);
  const columns = await db.query(`SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`);
  const constraints = await db.query(`SELECT c.relname AS table_name, con.conname AS constraint_name,
    con.contype AS type, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,con.conname`);
  const tableCounts = [];
  for (const t of tables.rows) {
    assert(/^[a-z_][a-z_0-9]*$/.test(t.table_name));
    const count = await db.query(`SELECT count(*)::text AS count FROM public."${t.table_name}"`);
    tableCounts.push({ table: t.table_name, rows: count.rows[0].count });
  }
  const history = await db.query(`SELECT count(*)::int AS entries,
    count(*) FILTER (WHERE key LIKE 'r:%')::int AS root_snapshots,
    count(*) FILTER (WHERE key LIKE 'h:%')::int AS content_chunks,
    coalesce(sum(octet_length(payload::text)),0)::text AS payload_bytes
    FROM talkhint_project_model_history WHERE owner_key=$1`, [row.owner_key]);
  const historyRows = await db.query(`SELECT key,payload FROM talkhint_project_model_history
    WHERE owner_key=$1 ORDER BY key`, [row.owner_key]);
  const historyHashes = historyRows.rows.map(r => ({ key: r.key, canonicalSemanticHash: sha(canonical(r.payload)) }));
  const historicalPaths = new Map<string, Field>();
  for (const r of historyRows.rows) inventory(r.payload, r.key.startsWith("r:") ? "$rootArchive" : "$contentArchive", historicalPaths);
  const historyFields = [...historicalPaths.values()].sort((a, b) => a.path.localeCompare(b.path)).map(f => ({
    ...f, target: "company_source_archives → existing immutable owner-scoped archive; historical reader verifies digest",
  }));
  const collectedAt = new Date().toISOString();
  await db.query("ROLLBACK");
  await mkdir(out, { recursive: true });
  const meta = {
    schema: 1, checkpoint: "A", environment: "development", collectedAt, sourceRevision: row.revision,
    sourceUpdatedAt: row.updated_at, readOnlyTransaction: true, databaseWrites: 0,
    canonicalRootHash: sha(canonical(state)), packedRootHash: sha(canonical(row.state)),
    fieldPaths: fieldInventory.length, documentCount: docs.length,
    structuredDocumentPaths: docs.reduce((n, d) => n + d.fields.length, 0),
    sourceScopes: hypotheses.map(h => h.id), summaries, history: history.rows[0],
    findings, materialReferences: references, historicalFieldPaths: historyFields.length,
    unmappedPaths: fieldInventory.filter(f => !f.target).length,
    limitation: "All observed fields, including old versions and JSON document bodies. Future/unpopulated optional fields are governed by shared TypeScript/Zod sources, not invented from runtime values.",
    protectedTables: tableCounts.filter(t => /^(calls|call_lab_|airatoma_deliveries|pending_calls)/.test(t.table)),
  };
  const files: Record<string, unknown> = {
    "SOURCE_MANIFEST.json": meta, "FIELD_INVENTORY.json": fieldInventory,
    "DOCUMENT_INVENTORY.json": docs, "EXISTING_DB_SCHEMA.json": { columns: columns.rows, constraints: constraints.rows, tableCounts },
    "HISTORY_HASHES.json": historyHashes,
    "HISTORY_FIELD_INVENTORY.json": historyFields,
  };
  for (const [name, content] of Object.entries(files))
    await writeFile(`${out}/${name}`, JSON.stringify(content, null, 2));
  console.log(JSON.stringify({ ...meta, summaries: summaries.map(s => ({ ...s, operatingRevisionHashes: `${s.operatingRevisionHashes.length} hashes` })) }));
} finally {
  db.release();
  await pool.end();
}
