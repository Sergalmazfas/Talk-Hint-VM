-- Additive Dev preparation only. Production schema is carried by owner's Publish.
CREATE TABLE IF NOT EXISTS document_types (
  id varchar NOT NULL, version integer NOT NULL, definition jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS document_types_version ON document_types(id,version);
CREATE TABLE IF NOT EXISTS user_documents (
  id varchar PRIMARY KEY, user_id varchar NOT NULL, content_hash text NOT NULL,
  status text NOT NULL, type_id text, type_version integer, classification jsonb, result jsonb, saved_result jsonb,
  revision varchar NOT NULL, error_code text, lease_until timestamptz,
  pinned boolean NOT NULL DEFAULT false, closed_at timestamptz, hidden_at timestamptz,
  purge_at timestamptz, file_deleted_at timestamptz, file_deletion_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_documents_bytes ON user_documents(user_id,content_hash);
CREATE INDEX IF NOT EXISTS user_documents_owner ON user_documents(user_id,created_at);
CREATE TABLE IF NOT EXISTS document_files (
  user_id varchar NOT NULL, document_id varchar NOT NULL, attachment_id varchar NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS document_files_attachment ON document_files(attachment_id);
CREATE TABLE IF NOT EXISTS document_attempts (
  id varchar PRIMARY KEY, user_id varchar NOT NULL, document_id varchar NOT NULL,
  stage text NOT NULL, model text NOT NULL, status text NOT NULL,
  request_id text, usage jsonb, cost_micro integer, error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_attempts_owner ON document_attempts(user_id,created_at);
CREATE TABLE IF NOT EXISTS document_versions (
  id varchar PRIMARY KEY, user_id varchar NOT NULL, document_id varchar NOT NULL,
  proposal_id varchar NOT NULL, "before" jsonb, "after" jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_versions_owner ON document_versions(user_id,document_id);
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS saved_result jsonb;
ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS file_deletion_started_at timestamptz;
