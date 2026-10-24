CREATE TABLE IF NOT EXISTS secretary_lab_comparisons (
  id varchar PRIMARY KEY,
  owner_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  instruction text NOT NULL,
  evaluation jsonb NOT NULL,
  runs jsonb NOT NULL,
  consent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS secretary_lab_comparisons_expires_idx ON secretary_lab_comparisons(expires_at);
