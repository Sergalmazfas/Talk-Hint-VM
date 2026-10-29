/** Additive Dev DDL. Production schema is applied ONLY by the owner's Publish flow. */
export function cutoverDDL() {
  return `
CREATE TABLE IF NOT EXISTS company_cutover_controls (
 owner_key text NOT NULL, environment text NOT NULL CHECK(environment IN ('development','production')),
 workspace_id text NOT NULL, manifest_hash text NOT NULL,
 phase text NOT NULL CHECK(phase IN ('shadow','verifying','active','checkpoint')),
 writes_open boolean NOT NULL DEFAULT false, checkpoint_id text,
 technical_token_hash text, probe_result jsonb, current_operation_id text,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_key,environment)
);
CREATE TABLE IF NOT EXISTS company_cutover_grants (
 token_hash text PRIMARY KEY, owner_key text NOT NULL, environment text NOT NULL,
 action text NOT NULL, expected jsonb NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS company_cutover_operations (
 operation_id text PRIMARY KEY, owner_key text NOT NULL, environment text NOT NULL,
 action text NOT NULL, expected jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('queued','running','succeeded','failed')),
 result jsonb, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS company_cutover_checkpoint_documents (
 checkpoint_id text NOT NULL, hypothesis_id text NOT NULL, document_id text NOT NULL,
 document jsonb NOT NULL, document_sha text NOT NULL,
 PRIMARY KEY(checkpoint_id,hypothesis_id,document_id)
);
CREATE TABLE IF NOT EXISTS company_cutover_checkpoints (
 checkpoint_id text PRIMARY KEY, owner_key text NOT NULL, environment text NOT NULL,
 workspace_id text NOT NULL, revision bigint NOT NULL, root_hash text NOT NULL,
 semantic_sha text NOT NULL, archive_owner_key text NOT NULL,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);`;
}
