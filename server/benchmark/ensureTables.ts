// Self-provisioning schema for the benchmark tables. The project deploys to a
// Reserved VM whose build does not run drizzle migrations, so the benchmark
// (an additive, admin-only feature) creates its own tables idempotently with
// CREATE TABLE IF NOT EXISTS on first use. Purely additive DDL: never touches
// existing production tables.

import { pool, dbReady } from "../db";

let ensured: Promise<void> | null = null;

const DDL = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS diagnostic_recording_enabled boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS benchmark_fixtures_source_call_sid_uq
  ON benchmark_fixtures (source_call_sid) WHERE source_call_sid IS NOT NULL;
CREATE TABLE IF NOT EXISTS benchmark_fixtures (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'other',
  goal text NOT NULL DEFAULT '',
  reference_turns jsonb NOT NULL DEFAULT '[]'::jsonb,
  critical_entities jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  audio_base64 text,
  audio_format text,
  audio_channels text,
  source_call_sid text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS benchmark_runs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  corpus_hash text NOT NULL DEFAULT '',
  fixture_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  prompt_version text NOT NULL DEFAULT 'v1',
  availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  scorecard jsonb NOT NULL DEFAULT '{}'::jsonb,
  report text,
  error text,
  started_at timestamp NOT NULL DEFAULT now(),
  finished_at timestamp
);
`;

export function ensureBenchmarkTables(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await dbReady;
      if (!pool) throw new Error("database not available");
      await pool.query(DDL);
    })().catch((e) => {
      ensured = null; // allow retry on next request
      throw e;
    });
  }
  return ensured;
}
