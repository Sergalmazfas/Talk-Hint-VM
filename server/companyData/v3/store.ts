import type { PoolClient } from "pg";
import { semanticHash, textHash } from "../valueTree";
import type { Schema } from "../relational";
import { checkFrame, CONTRACT_VERSION, frameHash, type Frame, type FrameStore } from "./codec";
import { physicalTable } from "./schema";

type Row = Record<string, any>;
export type DeltaStat = { inserted: number; updated: number; logicalBytes: number };
const NUMERIC = new Set(["bigint", "integer", "smallint", "numeric", "double precision", "real"]);
export function normalizedPayload(table: string, value: Row, schema: Schema) {
  const out: Row = {};
  for (const col of schema[table].columns) {
    if (["record_hash", "workspace_id"].includes(col.name)) continue;
    let v = value[col.name];
    // Revision membership/array positions are structural links, not record content.
    if (["revision", "source_revision", "operating_version", "ordinal", "current_revision"].includes(col.name) &&
        !(table === "company_model_revisions" && col.name === "revision")) v = 0;
    if (col.name === "present_fields") v = [];
    if (v === undefined) continue;
    out[col.name] = v === null ? null : NUMERIC.has(col.type) ? Number(v) : v;
  }
  return out;
}

export class SqlFrameStore implements FrameStore {
  frames = new Map<string, Frame>();
  records = new Map<string, Row>();
  private pendingFrames = new Map<string, Row>();
  private pendingRecords = new Map<string, Map<string, Row>>();
  private contracts = new Map<string, Row>();
  private snapshots = new Map<string, Row>();
  private pendingTextRefs = new Map<string, Row>();
  stats: Record<string, DeltaStat> = {};
  sqlReads = 0;
  constructor(readonly db: PoolClient, readonly workspace: string, readonly schema: Schema) {}
  private stat(table: string, rows: Row[]) {
    const s = this.stats[table] ??= { inserted: 0, updated: 0, logicalBytes: 0 };
    s.inserted += rows.length;
    s.logicalBytes += rows.reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r)), 0);
  }
  async payload(table: string, row: Row): Promise<string> {
    physicalTable(table);
    const body = normalizedPayload(table, row, this.schema), hash = semanticHash(body), key = `${table}:${hash}`;
    if (!this.records.has(key)) {
      this.records.set(key, body);
      const target = this.pendingRecords.get(table) ?? new Map<string, Row>();
      const physical: Row = { ...body, workspace_id: this.workspace, record_hash: hash };
      for (const [column, value] of Object.entries(body)) if (typeof value === "string" && value.length > 4096) {
        const snapshot_hash = textHash(value);
        this.snapshots.set(snapshot_hash, { workspace_id: this.workspace, snapshot_hash, exact_text: value,
          utf8_bytes: Buffer.byteLength(value) });
        this.pendingTextRefs.set(`${table}:${hash}:${column}`, { workspace_id: this.workspace,
          target_table: table, record_hash: hash, column_name: column, snapshot_hash });
        physical[column] = "";
      }
      target.set(hash, physical);
      this.pendingRecords.set(table, target);
    }
    return hash;
  }
  async column(table: string, record: string, column: string) {
    physicalTable(table);
    if (!this.schema[table].columns.some(c => c.name === column)) throw new Error("Unapproved company column");
    const key = `${table}:${record}`;
    if (!this.records.has(key)) {
      this.sqlReads++;
      const result = await this.db.query(`SELECT * FROM ${physicalTable(table)} WHERE workspace_id=$1 AND record_hash=$2`,
        [this.workspace, record]);
      if (result.rows.length !== 1) throw new Error("Company business record missing");
      const [resolved] = await this.resolveTexts(table, result.rows);
      const body = normalizedPayload(table, resolved, this.schema);
      if (semanticHash(body) !== record) throw new Error("Company business record digest mismatch");
      this.records.set(key, body);
    }
    return this.records.get(key)![column];
  }
  async put(frame: Frame) {
    const hash = frameHash(frame);
    if (this.frames.has(hash)) return hash;
    checkFrame(hash, { version: CONTRACT_VERSION, frame });
    const shape = { version: CONTRACT_VERSION, kind: frame.kind, field_names: frame.kind === "object" ? frame.keys : [] };
    const contract_hash = semanticHash(shape);
    this.contracts.set(contract_hash, { contract_hash, ...shape });
    const row: Row = { workspace_id: this.workspace, frame_hash: hash, contract_hash, children: [] };
    switch (frame.kind) {
      case "scalar": {
        row.scalar_kind = frame.value === null ? "null" : typeof frame.value;
        if (typeof frame.value === "string") {
          if (frame.value.length > 4096) {
            const snapshot_hash = textHash(frame.value);
            this.snapshots.set(snapshot_hash, { workspace_id: this.workspace, snapshot_hash,
              exact_text: frame.value, utf8_bytes: Buffer.byteLength(frame.value) });
            row.text_snapshot_hash = snapshot_hash;
          } else row.scalar_text = frame.value;
        }
        if (typeof frame.value === "number") row.scalar_number = frame.value;
        if (typeof frame.value === "boolean") row.scalar_boolean = frame.value;
        break;
      }
      case "column": Object.assign(row, { target_table: frame.table, target_record: frame.record, target_column: frame.column }); break;
      case "object": row.children = frame.children; break;
      case "array": case "concat": row.children = frame.children; row.array_length = frame.length; break;
      case "snapshot": row.children = [frame.child]; break;
    }
    this.frames.set(hash, frame); this.pendingFrames.set(hash, row);
    return hash;
  }
  async get(hash: string): Promise<Frame> {
    const cached = this.frames.get(hash);
    if (cached) return cached;
    this.sqlReads++;
    const { rows } = await this.db.query(`SELECT f.*,c.version,c.kind,c.field_names,s.exact_text,s.utf8_bytes
      FROM company_v3_frames f JOIN company_v3_contracts c USING(contract_hash)
      LEFT JOIN company_v3_text_snapshots s ON s.workspace_id=f.workspace_id AND s.snapshot_hash=f.text_snapshot_hash
      WHERE f.workspace_id=$1 AND f.frame_hash=$2`, [this.workspace, hash]);
    if (rows.length !== 1) throw new Error("Company frame missing");
    return this.acceptRow(rows[0]);
  }
  private acceptRow(r: Row): Frame {
    const hash = r.frame_hash;
    let frame: Frame;
    if (r.kind === "scalar") {
      let value = r.scalar_kind === "null" ? null : r.scalar_kind === "number" ? r.scalar_number :
        r.scalar_kind === "boolean" ? r.scalar_boolean : r.text_snapshot_hash ? r.exact_text : r.scalar_text;
      if (r.text_snapshot_hash && (typeof value !== "string" || textHash(value) !== r.text_snapshot_hash ||
          Buffer.byteLength(value) !== Number(r.utf8_bytes))) throw new Error("Company text snapshot digest mismatch");
      frame = { kind: "scalar", value };
    } else if (r.kind === "column") frame = { kind: "column", table: r.target_table, record: r.target_record, column: r.target_column };
    else if (r.kind === "object") frame = { kind: "object", keys: r.field_names, children: r.children };
    else if (r.kind === "snapshot") frame = { kind: "snapshot", child: r.children[0] };
    else if (r.kind === "array" || r.kind === "concat") frame = { kind: r.kind, children: r.children, length: Number(r.array_length) } as Frame;
    else throw new Error("Unknown company frame kind");
    const expectedContract = semanticHash({ version: r.version, kind: r.kind, field_names: r.field_names });
    if (r.contract_hash !== expectedContract) throw new Error("Company contract digest mismatch");
    checkFrame(hash, { version: r.version, frame });
    this.frames.set(hash, frame);
    return frame;
  }
  private async resolveTexts(table: string, rows: Row[]) {
    if (!rows.length) return rows;
    const refs = await this.db.query(`SELECT r.record_hash,r.column_name,r.snapshot_hash,s.exact_text,s.utf8_bytes
      FROM company_v3_payload_text_refs r JOIN company_v3_text_snapshots s
        ON s.workspace_id=r.workspace_id AND s.snapshot_hash=r.snapshot_hash
      WHERE r.workspace_id=$1 AND r.target_table=$2 AND r.record_hash=ANY($3::text[])`,
    [this.workspace, table, rows.map(r => r.record_hash)]);
    const index = new Map(rows.map(r => [r.record_hash, r]));
    for (const r of refs.rows) {
      if (textHash(r.exact_text) !== r.snapshot_hash || Buffer.byteLength(r.exact_text) !== Number(r.utf8_bytes))
        throw new Error("Company payload text digest mismatch");
      if (!this.schema[table].columns.some(c => c.name === r.column_name)) throw new Error("Unknown payload text column");
      index.get(r.record_hash)![r.column_name] = r.exact_text;
    }
    return rows;
  }
  /** Reachable changed-command inputs only; does not fetch the workspace root/history. */
  async prefetch(roots: string[]) {
    if (!roots.length) return;
    const { rows } = await this.db.query(`WITH RECURSIVE reachable(hash) AS (
      SELECT unnest($2::text[])
      UNION
      SELECT ch.hash FROM reachable r JOIN company_v3_frames f
        ON f.workspace_id=$1 AND f.frame_hash=r.hash
        CROSS JOIN LATERAL unnest(f.children) ch(hash)
    ) SELECT f.*,c.version,c.kind,c.field_names,s.exact_text,s.utf8_bytes
      FROM reachable r JOIN company_v3_frames f ON f.workspace_id=$1 AND f.frame_hash=r.hash
      JOIN company_v3_contracts c USING(contract_hash)
      LEFT JOIN company_v3_text_snapshots s ON s.workspace_id=f.workspace_id AND s.snapshot_hash=f.text_snapshot_hash`,
    [this.workspace, roots]);
    const wanted = new Map<string, Set<string>>();
    for (const row of rows) {
      const frame = this.acceptRow(row);
      if (frame.kind === "column") {
        physicalTable(frame.table);
        const records = wanted.get(frame.table) ?? new Set<string>();
        records.add(frame.record); wanted.set(frame.table, records);
      }
    }
    this.sqlReads += rows.length;
    for (const [table, set] of Array.from(wanted)) {
      const keys = Array.from(set);
      for (let i = 0; i < keys.length; i += 4096) {
        const result = await this.db.query(`SELECT * FROM ${physicalTable(table)}
          WHERE workspace_id=$1 AND record_hash=ANY($2::text[])`, [this.workspace, keys.slice(i, i + 4096)]);
        for (const row of await this.resolveTexts(table, result.rows)) {
          const body = normalizedPayload(table, row, this.schema);
          if (semanticHash(body) !== row.record_hash) throw new Error("Prefetched business digest mismatch");
          this.records.set(`${table}:${row.record_hash}`, body);
        }
        this.sqlReads += result.rows.length;
      }
    }
  }
  /** Full export/read only. This method must never be called from commitDelta. */
  async preload() {
    await this.db.query(`DECLARE company_v3_frames_cursor NO SCROLL CURSOR FOR
      SELECT f.*,c.version,c.kind,c.field_names,s.exact_text,s.utf8_bytes
      FROM company_v3_frames f JOIN company_v3_contracts c USING(contract_hash)
      LEFT JOIN company_v3_text_snapshots s ON s.workspace_id=f.workspace_id AND s.snapshot_hash=f.text_snapshot_hash
      WHERE f.workspace_id=$1`, [this.workspace]);
    while (true) {
      const result = await this.db.query("FETCH 4096 FROM company_v3_frames_cursor");
      if (!result.rows.length) break;
      for (const row of result.rows) this.acceptRow(row);
    }
    await this.db.query("CLOSE company_v3_frames_cursor");
    for (const table of Object.keys(this.schema)) {
      if (["company_extra_fields", "company_record_locations"].includes(table)) continue;
      await this.db.query(`DECLARE company_v3_payload_cursor NO SCROLL CURSOR FOR
        SELECT * FROM ${physicalTable(table)} WHERE workspace_id=$1`, [this.workspace]);
      while (true) {
        const result = await this.db.query("FETCH 4096 FROM company_v3_payload_cursor");
        if (!result.rows.length) break;
        for (const row of await this.resolveTexts(table, result.rows)) {
          const body = normalizedPayload(table, row, this.schema);
          if (semanticHash(body) !== row.record_hash) throw new Error("Preloaded business digest mismatch");
          this.records.set(`${table}:${row.record_hash}`, body);
        }
      }
      await this.db.query("CLOSE company_v3_payload_cursor");
    }
  }
  private async insert(table: string, rows: Row[], conflict: string) {
    const inserted: Row[] = [];
    for (let i = 0; i < rows.length; i += 256) {
      const batch = rows.slice(i, i + 256);
      // Fixed internal table names, never input identifiers. JSONB is transport only.
      const result = await this.db.query(`INSERT INTO ${table}
        SELECT * FROM jsonb_populate_recordset(NULL::${table},$1::jsonb)
        ON CONFLICT ${conflict} DO NOTHING RETURNING *`, [JSON.stringify(batch)]);
      inserted.push(...result.rows);
    }
    this.stat(table, inserted);
    return inserted;
  }
  /** Delta verification only; no workspace scan or full-model hash in the writer. */
  async flush() {
    const insertedContracts = await this.insert("company_v3_contracts", Array.from(this.contracts.values()), "(contract_hash)");
    for (const r of insertedContracts) if (semanticHash({ version: r.version, kind: r.kind, field_names: r.field_names }) !== r.contract_hash)
      throw new Error("Inserted company contract mismatch");
    const snapshots = await this.insert("company_v3_text_snapshots", Array.from(this.snapshots.values()), "(workspace_id,snapshot_hash)");
    for (const r of snapshots) if (textHash(r.exact_text) !== r.snapshot_hash || Buffer.byteLength(r.exact_text) !== Number(r.utf8_bytes))
      throw new Error("Inserted company text mismatch");
    for (const [table, rows] of Array.from(this.pendingRecords)) {
      const inserted = await this.insert(physicalTable(table), Array.from(rows.values()), "(workspace_id,record_hash)");
      for (const r of inserted) {
        const expected = rows.get(r.record_hash)!;
        for (const [k, v] of Object.entries(expected)) {
          const col = this.schema[table].columns.find(c => c.name === k);
          const actual = col && NUMERIC.has(col.type) && r[k] !== null ? Number(r[k]) : r[k];
          if (semanticHash(actual) !== semanticHash(v)) throw new Error("Inserted company physical row mismatch");
        }
      }
    }
    await this.insert("company_v3_payload_text_refs", Array.from(this.pendingTextRefs.values()),
      "(workspace_id,target_table,record_hash,column_name)");
    const frames = await this.insert("company_v3_frames", Array.from(this.pendingFrames.values()), "(workspace_id,frame_hash)");
    // INSERT RETURNING is readback of NEW rows. No per-frame SQL round trips.
    for (const r of frames) {
      const expected = this.pendingFrames.get(r.frame_hash)!;
      for (const [key, value] of Object.entries(expected)) {
        const actual = key === "array_length" ? Number(r[key]) : r[key];
        if (semanticHash(actual) !== semanticHash(value)) throw new Error(`Inserted company frame mismatch: ${key}`);
      }
    }
    this.contracts.clear(); this.snapshots.clear(); this.pendingFrames.clear(); this.pendingRecords.clear(); this.pendingTextRefs.clear();
  }
}
