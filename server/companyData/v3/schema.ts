import { businessTables } from "../relational";

export const payloadTables = businessTables.filter(t =>
  !["company_extra_fields", "company_record_locations"].includes(t));
export const physicalTable = (table: string) => {
  if (!(payloadTables as readonly string[]).includes(table)) throw new Error("Unapproved company payload table");
  return table.replace(/^company_/, "company_v3_");
};
/** Explicit migration artifact only. Never called by startup, the worker or a reader. */
export function ddlV3(): string {
  return `-- Company schema v3. Additive: accepted B and all legacy history remain intact.
CREATE TABLE IF NOT EXISTS company_v3_workspaces (
 workspace_id text PRIMARY KEY,
 owner_key text NOT NULL,
 environment text NOT NULL CHECK(environment IN ('development','production')),
 label text NOT NULL,
 schema_version integer NOT NULL DEFAULT 3 CHECK(schema_version=3),
 generation text NOT NULL CHECK(generation IN ('test','shadow','normalized')),
 current_revision bigint NOT NULL,
 root_hash text NOT NULL,
 retain_until_owner_review boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_key,environment)
);
CREATE TABLE IF NOT EXISTS company_v3_contracts (
 contract_hash text PRIMARY KEY,
 version integer NOT NULL,
 kind text NOT NULL,
 field_names text[] NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS company_v3_business_contract (
 version integer PRIMARY KEY,
 definition_text text NOT NULL,
 sha256 text NOT NULL
);
CREATE TABLE IF NOT EXISTS company_v3_text_snapshots (
 workspace_id text NOT NULL REFERENCES company_v3_workspaces(workspace_id),
 snapshot_hash text NOT NULL,
 exact_text text NOT NULL,
 utf8_bytes bigint NOT NULL,
 PRIMARY KEY(workspace_id,snapshot_hash)
);
CREATE TABLE IF NOT EXISTS company_v3_frames (
 workspace_id text NOT NULL REFERENCES company_v3_workspaces(workspace_id),
 frame_hash text NOT NULL,
 contract_hash text NOT NULL REFERENCES company_v3_contracts(contract_hash),
 children text[] NOT NULL DEFAULT '{}',
 array_length bigint,
 scalar_kind text,
 scalar_text text,
 scalar_number double precision,
 scalar_boolean boolean,
 text_snapshot_hash text,
 target_table text,
 target_record text,
 target_column text,
 PRIMARY KEY(workspace_id,frame_hash),
 FOREIGN KEY(workspace_id,text_snapshot_hash) REFERENCES company_v3_text_snapshots(workspace_id,snapshot_hash)
);
CREATE TABLE IF NOT EXISTS company_v3_payload_text_refs (
 workspace_id text NOT NULL REFERENCES company_v3_workspaces(workspace_id),
 target_table text NOT NULL,
 record_hash text NOT NULL,
 column_name text NOT NULL,
 snapshot_hash text NOT NULL,
 PRIMARY KEY(workspace_id,target_table,record_hash,column_name),
 FOREIGN KEY(workspace_id,snapshot_hash) REFERENCES company_v3_text_snapshots(workspace_id,snapshot_hash)
);
CREATE TABLE IF NOT EXISTS company_v3_revision_heads (
 workspace_id text NOT NULL REFERENCES company_v3_workspaces(workspace_id),
 revision bigint NOT NULL,
 root_hash text NOT NULL,
 actor text NOT NULL,
 source_semantic_hash text,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,revision),
 FOREIGN KEY(workspace_id,root_hash) REFERENCES company_v3_frames(workspace_id,frame_hash)
);
CREATE TABLE IF NOT EXISTS company_v3_document_heads (
 workspace_id text NOT NULL REFERENCES company_v3_workspaces(workspace_id),
 hypothesis_id text NOT NULL,
 document_id text NOT NULL,
 valid_from bigint NOT NULL,
 frame_hash text NOT NULL,
 PRIMARY KEY(workspace_id,hypothesis_id,document_id,valid_from),
 FOREIGN KEY(workspace_id,frame_hash) REFERENCES company_v3_frames(workspace_id,frame_hash)
);
CREATE TABLE IF NOT EXISTS company_v3_archive_refs (
 workspace_id text NOT NULL REFERENCES company_v3_workspaces(workspace_id),
 source_owner_key text NOT NULL,
 source_key text NOT NULL,
 semantic_sha256 text NOT NULL,
 PRIMARY KEY(workspace_id,source_key),
 FOREIGN KEY(source_owner_key,source_key) REFERENCES talkhint_project_model_history(owner_key,key)
);
CREATE TABLE IF NOT EXISTS company_v3_import_grants (
 grant_hash text PRIMARY KEY,
 source_owner text NOT NULL,
 target_owner text NOT NULL,
 source_environment text NOT NULL,
 target_environment text NOT NULL,
 package_hash text NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS company_v3_size_budgets (
 workspace_id text NOT NULL REFERENCES company_v3_workspaces(workspace_id),
 hypothesis_id text NOT NULL,
 active_utf16 bigint NOT NULL,
 PRIMARY KEY(workspace_id,hypothesis_id)
);
${payloadTables.map(table => `CREATE TABLE IF NOT EXISTS ${physicalTable(table)} (
 LIKE ${table} INCLUDING DEFAULTS,
 record_hash text NOT NULL,
 PRIMARY KEY(workspace_id,record_hash),
 FOREIGN KEY(workspace_id) REFERENCES company_v3_workspaces(workspace_id)
);`).join("\n")}
-- No source switch, trigger, startup migration, production import or cleanup.
`;
}
