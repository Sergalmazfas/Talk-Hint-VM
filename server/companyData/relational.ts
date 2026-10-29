/**
 * Versioned normalized projection + reversible auxiliary fields.
 * This library has no startup hook, model calls, mail or Hint control side effects.
 */
import type { PoolClient } from "pg";
import type { ProjectModelState } from "../../shared/projectModel";
import { canonical, child, assign, flatten, inflate, semanticHash, textHash, type Json, type Leaf } from "./valueTree";

export const businessTables = [
  "company_model_revisions", "company_hypotheses", "company_operating_revisions",
  "company_entities", "company_roles", "company_employee_profiles", "company_employee_name_options",
  "company_role_prompt_versions", "company_actions", "company_resources", "company_node_refs",
  "company_node_material_refs", "company_node_inputs", "company_node_schedules", "company_node_metrics",
  "company_node_reporting", "company_node_register", "company_links", "company_customer_stages",
  "company_stage_reports", "company_legacy_elements", "company_element_details", "company_legacy_relations",
  "company_documents", "company_document_versions", "company_document_links", "company_decisions",
  "company_decision_refs", "company_proposals", "company_task_drafts", "company_extra_fields",
  "company_journal_cases", "company_journal_events", "company_issue_attempts", "company_report_records",
  "company_record_locations",
] as const;
export type Table = typeof businessTables[number];
export type Schema = Record<string, { columns: { name: string; type: string; nullable: boolean; defaultValue: string | null }[]; keys: string[] }>;
export type Row = Record<string, any>;
export interface Projection {
  tables: Map<string, Row[]>; hash: string; revision: number;
  extraSummary: { section: string; scalarValues: number; containers: number; stringBytes: number }[];
}
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const aliases: Record<string, string> = {
  entity_id: "id", element_id: "id", document_id: "id", link_id: "id", decision_id: "id",
  proposal_id: "proposalId", draft_id: "id", stage_id: "id", relation_id: "id",
  source_at: "at", updated_at_source: "updatedAt", created_at_source: "createdAt", text_body: "text",
  from_id: "from", to_id: "to", needs_review: "needsReview", source_id: "sourceId",
};
export async function inspectSchema(db: Pick<PoolClient, "query">): Promise<Schema> {
  const columns = await db.query(`SELECT table_name,column_name,data_type,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])
    ORDER BY table_name,ordinal_position`, [[...businessTables]]);
  const pk = await db.query(`SELECT c.relname AS name,array_agg(a.attname::text ORDER BY x.n) AS keys
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
    CROSS JOIN LATERAL unnest(k.conkey) WITH ORDINALITY x(num,n)
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=x.num
    WHERE ns.nspname='public' AND k.contype='p' AND c.relname=ANY($1::text[]) GROUP BY c.relname`, [[...businessTables]]);
  const schema: Schema = {};
  for (const r of columns.rows) {
    schema[r.table_name] ??= { columns: [], keys: [] };
    schema[r.table_name].columns.push({ name: r.column_name, type: r.data_type, nullable: r.is_nullable === "YES", defaultValue: r.column_default });
  }
  for (const r of pk.rows) schema[r.name].keys = r.keys;
  for (const table of businessTables) if (!schema[table]?.keys.length) throw new Error(`Schema missing: ${table}`);
  return schema;
}
export function project(root: ProjectModelState, workspace: string, schema: Schema,
  options: { operatingOrigins?: Map<string, number>; actor?: string; domainWrite?: boolean } = {}): Projection {
  const tables = new Map<string, Row[]>(businessTables.map(t => [t, []]));
  const dedup = new Map<string, string>(), mapped = new Set<string>();
  const revision = root.revision;
  function add(table: Table, row: Row) {
    if (!schema[table]) throw new Error(`Unknown table ${table}`);
    const key = `${table}:${JSON.stringify(schema[table].keys.map(k => row[k]))}`;
    const digest = semanticHash(row);
    if (dedup.has(key)) {
      if (dedup.get(key) !== digest) throw new Error(`Conflicting duplicate in ${table}`);
      return;
    }
    dedup.set(key, digest);
    tables.get(table)!.push(row);
  }
  function scalarLocation(table: Table, row: Row, pointer: string, column: string) {
    add("company_record_locations", { workspace_id: workspace, revision, source_pointer: pointer,
      target_table: table, key_names: schema[table].keys,
      key_values: schema[table].keys.map(k => String(row[k])),
      source_fields: ["$value"], target_columns: [column] });
    mapped.add(pointer);
  }
  function emit(table: Table, obj: Json, pointer: string | null, scope: Row, computed: Row = {},
    rename: Record<string, string> = {}) {
    const row: Row = {}, sourceFields: string[] = [], targetColumns: string[] = [];
    for (const col of schema[table].columns) {
      if (col.defaultValue !== null && !Object.hasOwn(computed, col.name) && !Object.hasOwn(scope, col.name)) continue;
      if (Object.hasOwn(computed, col.name)) row[col.name] = computed[col.name];
      else if (Object.hasOwn(scope, col.name)) row[col.name] = scope[col.name];
      else if (col.name === "present_fields") row[col.name] = Object.keys(obj).sort();
      else {
        const field = rename[col.name] ?? aliases[col.name] ?? camel(col.name);
        const value = obj[field];
        if (Object.hasOwn(obj, field) && (value === null || typeof value !== "object" || Array.isArray(value))) {
          row[col.name] = value;
          if (pointer !== null) {
            sourceFields.push(field); targetColumns.push(col.name);
            mapped.add(child(pointer, field));
          }
        } else if (col.nullable) row[col.name] = null;
        else throw new Error(`Unmapped required column ${table}.${col.name}; keys=${Object.keys(obj).join(",")}`);
      }
    }
    add(table, row);
    if (pointer !== null && sourceFields.length) {
      add("company_record_locations", { workspace_id: workspace, revision, source_pointer: pointer,
        target_table: table, key_names: schema[table].keys, key_values: schema[table].keys.map(k => String(row[k])),
        source_fields: sourceFields, target_columns: targetColumns });
    }
    return row;
  }
  const common = { workspace_id: workspace, revision };
  emit("company_model_revisions", root, "", { workspace_id: workspace },
    { revision, actor: options.actor ?? "legacy-import", source_at: "", semantic_sha256: semanticHash(root),
      origin: options.domainWrite ? "domain_write" : "legacy_import" });
  // Root revision has its own relational source (not auxiliary numeric storage).
  add("company_record_locations", { ...common, source_pointer: "", target_table: "company_model_revisions",
    key_names: ["workspace_id", "revision"], key_values: [workspace, String(revision)],
    source_fields: ["revision"], target_columns: ["revision"] });
  mapped.add("/revision");
  const hypotheses = [{ id: "original", title: "original", model: root, pointer: "" },
    ...(root.alternatives ?? []).map((a, i) => ({ ...a, pointer: `/alternatives/${i}/model` }))];
  for (const [hindex, h] of Array.from(hypotheses.entries())) {
    const hs = { ...common, hypothesis_id: h.id };
    emit("company_hypotheses", h, null, { workspace_id: workspace },
      { hypothesis_id: h.id, title: h.title, ordinal: hindex, current_revision: revision });
    for (const [i, element] of Array.from(h.model.elements.entries())) {
      const path = child(child(h.pointer, "elements"), i);
      const es = { ...hs, element_id: element.id };
      emit("company_legacy_elements", element, path, hs, { ordinal: i });
      for (const [field, value] of Object.entries(element.details)) {
        if (typeof value !== "string") throw new Error("Non-text detail requires explicit mapping");
        emit("company_element_details", {}, null, es, { field_name: field, text_value: value });
        const detailKey: Row = { ...es, field_name: field };
        add("company_record_locations", { ...common, source_pointer: child(child(path, "details"), field),
          target_table: "company_element_details", key_names: schema.company_element_details.keys,
          key_values: schema.company_element_details.keys.map(k => String(detailKey[k])),
          source_fields: ["$value"], target_columns: ["text_value"] });
        mapped.add(child(child(path, "details"), field));
      }
    }
    const models: [string, Table, Row, Record<string, string>?][] = [
      ["relations", "company_legacy_relations", {}],
      ["decisions", "company_decisions", {}, { proposal_id: "proposalId" }],
      ["proposals", "company_proposals", {}, { proposal_id: "id" }],
      ["taskDrafts", "company_task_drafts", {}],
    ];
    for (const [field, table, extra, rename] of models)
      (h.model as Json)[field].forEach((v: Json, i: number) => {
        emit(table, v, child(child(h.pointer, field), i), hs, { ...extra, ordinal: i }, rename);
        if (field === "decisions") v.elementIds.forEach((id: string, ordinal: number) => {
          const row = emit("company_decision_refs", {}, null, { ...hs, decision_id: v.id },
            { ordinal, element_id: id });
          scalarLocation("company_decision_refs", row, `${h.pointer}/decisions/${i}/elementIds/${ordinal}`, "element_id");
        });
      });
    for (const [i, d] of Array.from(h.model.documents.entries())) {
      const ds = { ...hs, document_id: d.id };
      emit("company_documents", {}, null, { workspace_id: workspace, hypothesis_id: h.id }, { document_id: d.id });
      let format = "text";
      try { JSON.parse(d.text); format = "json"; } catch { /* Plain text remains exact text. */ }
      emit("company_document_versions", d, child(child(h.pointer, "documents"), i), hs,
        { ordinal: i, utf8_sha256: textHash(d.text), utf16_length: d.text.length, format, provenance: "legacy exact text" });
      d.elementIds.forEach((id, ordinal) => {
        const row = emit("company_document_links", {}, null, ds, { ordinal, element_id: id });
        scalarLocation("company_document_links", row, `${h.pointer}/documents/${i}/elementIds/${ordinal}`, "element_id");
      });
    }
    for (const [ri, rev] of Array.from((h.model.operatingModel?.revisions ?? []).entries())) {
      const os = { workspace_id: workspace, hypothesis_id: h.id, operating_version: rev.version };
      const path = `${h.pointer}/operatingModel/revisions/${ri}`;
      emit("company_operating_revisions", rev, path, os,
        { source_revision: options.operatingOrigins?.get(`${h.id}:${rev.version}`) ?? revision,
          semantic_sha256: semanticHash(rev) });
      const nodes = rev.data.nodes;
      const nodeSet = new Set(nodes.map(n => n.id));
      const elements = new Set(h.model.elements.map(n => n.id)), docs = new Set(h.model.documents.map(n => n.id));
      for (const [ni, n] of Array.from(nodes.entries())) {
        const ns = { ...os, entity_id: n.id }, np = `${path}/data/nodes/${ni}`;
        emit("company_entities", n, np, os, { ordinal: ni });
        if (n.kind === "role") emit("company_roles", {}, null, ns, { mode: null, mode_source: null });
        if (n.kind === "action") emit("company_actions", {}, null, ns);
        if (n.kind === "resource") emit("company_resources", {}, null, ns);
        for (const field of ["parentId", "managerId", "clientId", "roleId", "executorId", "recipientId", "acceptorId", "nextId", "resourceIds"] as const) {
          const v = n[field];
          if (v === undefined) continue;
          const values = Array.isArray(v) ? v : [v];
          values.forEach((target, ordinal) => {
            if (target && !nodeSet.has(target)) throw new Error(`Unresolved node ${target} at operating version ${rev.version}`);
            const row = emit("company_node_refs", {}, null, ns, { field_name: field, ordinal, target_id: target });
            scalarLocation("company_node_refs", row, Array.isArray(v) ? `${np}/${field}/${ordinal}` : `${np}/${field}`, "target_id");
          });
          // FK rows are a checked projection; shape remains in typed auxiliary fields.
        }
        n.referenceIds.forEach((target, ordinal) => {
          const row = emit("company_node_material_refs", {}, null, ns, {
          ordinal, target_id: target, target_namespace: nodeSet.has(target) ? "node" :
            elements.has(target) ? "element" : docs.has(target) ? "document" :
            h.model.competitorDirectory?.records.some(c => c.id === target) ? "competitor" :
            target === "analyst-preparation" ? "analyst_preparation" : "strategy_entry",
          });
          scalarLocation("company_node_material_refs", row, `${np}/referenceIds/${ordinal}`, "target_id");
        });
        n.inputs.forEach((input, ordinal) => emit("company_node_inputs", input, child(`${np}/inputs`, ordinal), ns, { ordinal }));
        emit("company_node_schedules", n.schedule, `${np}/schedule`, ns);
        n.metrics?.forEach((m, ordinal) => emit("company_node_metrics", m, `${np}/metrics/${ordinal}`, ns,
          { ordinal }, { metric_id: "id" }));
        if (n.reporting) emit("company_node_reporting", n.reporting, `${np}/reporting`, ns);
        if (n.register) emit("company_node_register", n.register, `${np}/register`, ns);
      }
      rev.data.links.forEach((l, ordinal) => {
        const lp = `${path}/data/links/${ordinal}`;
        emit("company_links", l, lp, os, { ordinal, readiness_present: l.readiness !== undefined,
          ...Object.fromEntries(["structure","resources","trial","evidence"].map(k => [k, (l.readiness as Json)?.[k] ?? null])) });
      });
      rev.data.customerPath?.forEach((v, ordinal) =>
        emit("company_customer_stages", v, `${path}/data/customerPath/${ordinal}`, os, { ordinal }));
      rev.data.stageReports.forEach((v, ordinal) =>
        emit("company_stage_reports", v, `${path}/data/stageReports/${ordinal}`, os, { ordinal }));
    }
    // Journal/profile/prompt projections are derived in this transaction from exact source documents.
    // Their accepted/proposed state never activates an executor.
    const lastOp = h.model.operatingModel?.revisions.at(-1);
    for (const d of h.model.documents) {
      let j: Json;
      try { j = JSON.parse(d.text); } catch { continue; }
      if (d.id === "DOC-TALKHINT-IMPROVEMENT-JOURNAL") {
        (j.cases ?? []).forEach((c: Json, ordinal: number) => {
          const cs = { ...hs, case_id: c.caseId };
          emit("company_journal_cases", {}, null, cs, { ordinal, source_document_id: d.id,
            status: typeof c.status === "string" ? c.status : null, title: c.label ?? c.title ?? null,
            present_fields: Object.keys(c) });
          (c.history ?? []).forEach((ev: Json, ordinal: number) => {
            emit("company_journal_events", {}, null, cs,
              { ordinal, source_event_id: ev.id ?? null, source_at: ev.at ?? null, role_id: ev.role ?? null,
                stage: ev.stage ?? null, text_body: typeof ev.note === "string" ? ev.note :
                  typeof ev.action === "string" ? ev.action : null, present_fields: Object.keys(ev) });
            if (/^(implemented|verified|tested)/.test(ev.stage ?? "")) {
              emit("company_issue_attempts", {}, null, cs, { ordinal,
                issue_key: ev.problemKey ?? c.problemKey ?? "unclassified", source_at: ev.at ?? null,
                change_text: typeof ev.note === "string" ? ev.note : null,
                verification_text: typeof ev.verification === "string" ? ev.verification : null,
                owner_effect: ev.ownerEvaluationOfImplementedChange ?? null,
                source_pointer: `/cases/${ordinal}/history/${ordinal}`, present_fields: Object.keys(ev) });
            }
          });
        });
      }
      if (lastOp && j.visualPassport && j.prompt) {
        const v = j.visualPassport, roleId = v.roleId;
        const role = tables.get("company_roles")!.find(r => r.hypothesis_id === h.id &&
          r.operating_version === lastOp.version && r.entity_id === roleId);
        if (!role) throw new Error(`Profile has no role: ${roleId}`);
        // These two documents are explicitly the Hint lab pair; no assignments guessed for other roles.
        if (["DOC-PLAB-PROMPT-PROPOSAL", "DOC-PLG-QA-PROMPT-PROPOSAL"].includes(d.id)) {
          role.mode = "hint"; role.mode_source = `owner:2026-10-28:${d.id}`;
        }
        const ps = { workspace_id: workspace, hypothesis_id: h.id,
          operating_version: lastOp.version, entity_id: roleId, profile_version: Number(j.version) };
        const traits = v.character?.traits;
        if (!Array.isArray(traits) || traits.length !== 3) throw new Error("Profile must have exactly 3 traits");
        emit("company_employee_profiles", {}, null, ps, { display_name: v.selectedName ?? null,
          trait_1: traits[0], trait_2: traits[1], trait_3: traits[2], motto: v.character.motto ?? null,
          portrait_description: v.portrait?.image ?? null, portrait_file_url: v.portrait?.asset ?? null,
          portrait_style: v.portrait?.styleId ?? null, role_color: v.roleColor?.value ?? null,
          owner_selection_status: v.selectedName ? "accepted" : "not_selected",
          source_document_id: d.id, source_pointer: "/visualPassport", source_at: j.revisedAt ?? d.updatedAt,
          accepted_by: v.selectedName ? "owner" : null, accepted_at: null });
        (v.nameOptions ?? []).forEach((name: string, ordinal: number) =>
          emit("company_employee_name_options", {}, null, ps, { ordinal, name_text: name }));
        emit("company_role_prompt_versions", {}, null, {
          workspace_id: workspace, hypothesis_id: h.id, operating_version: lastOp.version, entity_id: roleId,
        }, { prompt_version: `${d.id}:v${j.version}`, text_body: JSON.stringify(j.prompt),
          source_at: j.revisedAt ?? d.updatedAt, status: "proposed", accepted_by: null, accepted_at: null,
          source_document_id: d.id, source_pointer: "/prompt", utf8_sha256: textHash(JSON.stringify(j.prompt)) });
      }
    }
  }
  for (const leaf of flatten(root, mapped)) {
    const m = /^\/alternatives\/(\d+)\/model(?:\/|$)/.exec(leaf.source_path);
    const hyp = m ? root.alternatives![Number(m[1])].id : "original";
    emit("company_extra_fields", {}, null, { ...common, hypothesis_id: hyp },
      { ...leaf, scope: "root" });
  }
  const summaries = new Map<string, Projection["extraSummary"][number]>();
  for (const r of tables.get("company_extra_fields")!) {
    const section = r.source_path.replace(/^\/alternatives\/\d+\/model/, "").split("/")[1] || "(root)";
    const key = `${r.hypothesis_id}:${section}`;
    const s = summaries.get(key) ?? { section: key, scalarValues: 0, containers: 0, stringBytes: 0 };
    if (["object", "array"].includes(r.value_type)) s.containers++; else s.scalarValues++;
    s.stringBytes += typeof r.string_value === "string" ? Buffer.byteLength(r.string_value) : 0;
    summaries.set(key, s);
  }
  return { tables, revision, hash: semanticHash(root), extraSummary: Array.from(summaries.values()) };
}

export function reconstruct(tables: Map<string, Row[]>, schema: Schema, revision: number): ProjectModelState {
  const extras = tables.get("company_extra_fields")!.filter(r => r.revision === revision);
  const root = inflate(extras as Leaf[]);
  const index = new Map<string, Row>();
  for (const table of businessTables) {
    for (const row of tables.get(table) ?? []) {
      const key = `${table}:${JSON.stringify(schema[table].keys.map(k => String(row[k])))}`;
      if (index.has(key)) throw new Error("Duplicate relational key");
      index.set(key, row);
    }
  }
  for (const loc of tables.get("company_record_locations")!.filter(r => r.revision === revision)) {
    if (!(businessTables as readonly string[]).includes(loc.target_table) ||
        semanticHash(loc.key_names) !== semanticHash(schema[loc.target_table].keys))
      throw new Error("Invalid record placement");
    const row = index.get(`${loc.target_table}:${JSON.stringify(loc.key_values)}`);
    if (!row) throw new Error("Missing mapped relational record");
    loc.source_fields.forEach((field: string, i: number) => {
      if (!schema[loc.target_table].columns.some(c => c.name === loc.target_columns[i]))
        throw new Error("Unknown mapped column");
      let value = row[loc.target_columns[i]];
      const type = schema[loc.target_table].columns.find(c => c.name === loc.target_columns[i])!.type;
      if (value !== null && ["numeric", "bigint", "integer", "double precision", "real", "smallint"].includes(type))
        value = Number(value);
      assign(root, field === "$value" ? loc.source_pointer : child(loc.source_pointer, field),
        typeof value === "object" && value !== null ? structuredClone(value) : value);
    });
  }
  if (semanticHash(root) !== tables.get("company_model_revisions")!.find(r => r.revision === revision)?.semantic_sha256)
    throw new Error("Reconstructed model checksum mismatch");
  return root;
}

async function eachRow(db: PoolClient, query: string, args: any[], visit: (r: Row) => void) {
  await db.query(`DECLARE company_scan NO SCROLL CURSOR FOR ${query}`, args);
  try {
    while (true) {
      const batch = await db.query("FETCH FORWARD 4096 FROM company_scan");
      if (!batch.rowCount) break;
      batch.rows.forEach(visit);
    }
  } finally { await db.query("CLOSE company_scan"); }
}
export async function insertProjection(db: PoolClient, p: Projection, schema: Schema,
  options: { verifyAndRelease?: boolean } = {}) {
  for (const table of businessTables) {
    const rows = p.tables.get(table)!;
    // No SQL identifiers originate from model values.
    for (let i = 0; i < rows.length; i += 256) {
      const cols = Object.keys(rows[i]).map(c => {
        if (!schema[table].columns.some(v => v.name === c) || !/^[a-z_][a-z_0-9]*$/.test(c)) throw new Error("Invalid column");
        return c;
      }).join(",");
      await db.query(`INSERT INTO public.${table}(${cols}) SELECT ${cols} FROM jsonb_populate_recordset(NULL::public.${table},$1::jsonb)
        ON CONFLICT DO NOTHING`, [JSON.stringify(rows.slice(i, i + 256))]);
    }
    if (options.verifyAndRelease && rows.length) {
      const expected = new Map(rows.map(r => [JSON.stringify(schema[table].keys.map(k => String(r[k]))), r]));
      await eachRow(db, `SELECT * FROM public.${table} WHERE workspace_id=$1`, [rows[0].workspace_id], r => {
        const before = expected.get(JSON.stringify(schema[table].keys.map(k => String(r[k]))));
        if (!before) return; // Earlier immutable revisions can coexist with a new write.
        const actual = Object.fromEntries(Object.keys(before).map(k => [k,
          k === "present_fields" && Array.isArray(r[k]) ? [...r[k]].sort() :
          typeof before[k] === "number" && r[k] !== null ? Number(r[k]) : r[k]]));
        const wanted: Row = { ...before, ...(Array.isArray(before.present_fields) ? { present_fields: [...before.present_fields].sort() } : {}) };
        if (semanticHash(actual) !== semanticHash(wanted)) throw new Error(`Immutable row mismatch: ${table}; columns=${
          Object.keys(wanted).filter(k => semanticHash(actual[k]) !== semanticHash(wanted[k])).join(",")}`);
        expected.delete(JSON.stringify(schema[table].keys.map(k => String(r[k]))));
      });
      if (expected.size) throw new Error(`Rows missing: ${table}`);
      p.tables.set(table, []);
      console.log(`[company-data] verified ${table}: ${rows.length} rows`);
    }
  }
}
/** Bounded reader. Call inside one transaction; no million-row result in Node heap. */
export async function readRootFromSql(db: PoolClient, workspace: string, revision: number, schema: Schema) {
  const root: Json = {};
  let roots = 0;
  await eachRow(db, `SELECT source_path,value_type,string_value,number_value,boolean_value,child_count
    FROM company_extra_fields WHERE workspace_id=$1 AND revision=$2
    ORDER BY length(source_path),source_path`, [workspace, revision], r => {
    if (!r.source_path) { roots++; return; }
    const value = r.value_type === "array" ? [] : r.value_type === "object" ? {} :
      r.value_type === "null" ? null : r.value_type === "number" ? Number(r.number_value) :
      r.value_type === "boolean" ? r.boolean_value : r.string_value;
    assign(root, r.source_path, value);
  });
  if (roots !== 1) throw new Error("Missing or duplicate root");
  let restored = 0;
  const targets = await db.query(`SELECT DISTINCT target_table FROM company_record_locations
    WHERE workspace_id=$1 AND revision=$2 ORDER BY target_table`, [workspace, revision]);
  for (const { target_table: table } of targets.rows) {
    if (!(businessTables as readonly string[]).includes(table)) throw new Error("Unknown placement table");
    const keys = schema[table].keys;
    // Linear scans, not a polymorphic SQL join with casts on a newly imported, unanalyzed graph.
    // Only one table is indexed in Node at a time; unlike loadProjection this is not the whole DB.
    const records = new Map<string, Row>();
    await eachRow(db, `SELECT * FROM public.${table} WHERE workspace_id=$1`, [workspace], row => {
      if (records.size >= 1_000_000) throw new Error("Per-table reader budget exceeded; no partial model returned");
      records.set(JSON.stringify(keys.map(k => String(row[k]))), row);
    });
    await eachRow(db, `SELECT source_pointer,source_fields,target_columns,key_names,key_values
      FROM company_record_locations WHERE workspace_id=$1 AND revision=$2 AND target_table=$3`,
    [workspace, revision, table], loc => {
      if (semanticHash(loc.key_names) !== semanticHash(keys)) throw new Error("Invalid location keys");
      const record = records.get(JSON.stringify(loc.key_values));
      if (!record) throw new Error("Missing relational record");
      loc.source_fields.forEach((f: string, i: number) => {
        const col = schema[table].columns.find(c => c.name === loc.target_columns[i]);
        if (!col) throw new Error("Invalid column mapping");
        let value = record[loc.target_columns[i]];
        if (value !== null && ["numeric","bigint","integer","smallint","real","double precision"].includes(col.type))
          value = Number(value);
        assign(root, f === "$value" ? loc.source_pointer : child(loc.source_pointer, f), value);
      });
      restored++;
    });
    console.log(`[company-data] reconstructed ${table}`);
    records.clear();
  }
  const count = await db.query(`SELECT count(*)::integer AS n FROM company_record_locations
    WHERE workspace_id=$1 AND revision=$2`, [workspace, revision]);
  if (restored !== count.rows[0].n) throw new Error("Dangling relational location");
  const result = await db.query(`SELECT semantic_sha256 FROM company_model_revisions WHERE workspace_id=$1 AND revision=$2`,
    [workspace, revision]);
  if (semanticHash(root) !== result.rows[0]?.semantic_sha256) throw new Error("Reconstructed model checksum mismatch");
  return root as ProjectModelState;
}
export async function loadProjection(db: Pick<PoolClient, "query">, workspace: string, revision: number) {
  const tables = new Map<string, Row[]>();
  for (const table of businessTables) {
    const result = await db.query(`SELECT * FROM public.${table} WHERE workspace_id=$1`, [workspace]);
    tables.set(table, result.rows);
  }
  return tables;
}
