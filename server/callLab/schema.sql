-- DEVELOPMENT ONLY. Production receives this schema through the owner's Publish flow.
CREATE TABLE IF NOT EXISTS call_lab_controls (
 key text PRIMARY KEY, environment text NOT NULL, owner_id text NOT NULL, recipient text NOT NULL,
 connection_id text NOT NULL, enabled boolean NOT NULL DEFAULT false,
 activated_at timestamptz NOT NULL DEFAULT now(), watchdog jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS call_lab_jobs (
 key text PRIMARY KEY, environment text NOT NULL, owner_id text NOT NULL, call_sid text NOT NULL,
 status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 source jsonb, report jsonb, journal jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS call_lab_jobs_scope ON call_lab_jobs(environment,owner_id,status);
CREATE TABLE IF NOT EXISTS call_lab_outbox (
 key text PRIMARY KEY REFERENCES call_lab_jobs(key) ON DELETE CASCADE,
 environment text NOT NULL, owner_id text NOT NULL, message_id text NOT NULL,
 status text NOT NULL DEFAULT 'prepared', gmail_id text, reconcile_count integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS call_lab_message_id_unique ON call_lab_outbox(message_id);
