-- Schema v2: checkpoint A accepted with additions; Dev B authorized by owner.
-- Production schema only via the owner's Publish. No startup DDL.
-- PostgreSQL 16. Stage B schema (stages 1+2). No extensions, existing-table changes,
-- DROP, DELETE, TRUNCATE, startup DDL, runtime scheduling or Hint queue migration.
-- Logical table names and columns below are contract v2 with the owner's additions.
BEGIN;

CREATE TABLE company_workspaces (
  workspace_id text PRIMARY KEY,
  owner_key text NOT NULL REFERENCES talkhint_project_models(owner_key),
  environment text NOT NULL CHECK (environment IN ('development','production')),
  current_revision integer NOT NULL CHECK (current_revision >= 0),
  storage_generation text NOT NULL DEFAULT 'legacy'
    CHECK (storage_generation IN ('legacy','shadow','normalized')),
  primary_hypothesis_id text,
  schema_version integer NOT NULL DEFAULT 2 CHECK (schema_version = 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_key, environment),
  UNIQUE(workspace_id, owner_key)
);

CREATE TABLE company_model_revisions (
  workspace_id text NOT NULL REFERENCES company_workspaces(workspace_id),
  revision integer NOT NULL CHECK (revision >= 0),
  actor text NOT NULL, source_at text NOT NULL,
  semantic_sha256 text NOT NULL CHECK (semantic_sha256 ~ '^[a-f0-9]{64}$'),
  origin text NOT NULL CHECK (origin IN ('legacy_import','domain_write')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id, revision)
);
ALTER TABLE company_workspaces ADD CONSTRAINT company_current_revision_fk
  FOREIGN KEY(workspace_id,current_revision)
  REFERENCES company_model_revisions(workspace_id,revision) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE company_hypotheses (
  workspace_id text NOT NULL REFERENCES company_workspaces(workspace_id),
  hypothesis_id text NOT NULL,
  title text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  current_revision integer NOT NULL,
  PRIMARY KEY(workspace_id, hypothesis_id),
  UNIQUE(workspace_id, ordinal),
  FOREIGN KEY(workspace_id, current_revision) REFERENCES company_model_revisions(workspace_id, revision)
    DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE company_workspaces ADD CONSTRAINT company_primary_hypothesis_fk
  FOREIGN KEY(workspace_id, primary_hypothesis_id)
  REFERENCES company_hypotheses(workspace_id,hypothesis_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE company_operating_revisions (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL,
  operating_version integer NOT NULL CHECK (operating_version > 0),
  source_revision integer NOT NULL, source_at text NOT NULL, actor text NOT NULL,
  semantic_sha256 text NOT NULL CHECK (semantic_sha256 ~ '^[a-f0-9]{64}$'),
  present_fields text[] NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version),
  FOREIGN KEY(workspace_id,hypothesis_id) REFERENCES company_hypotheses(workspace_id,hypothesis_id),
  FOREIGN KEY(workspace_id,source_revision) REFERENCES company_model_revisions(workspace_id,revision)
);

-- Versioned graph: the same business node ID is retained in every operating version.
CREATE TABLE company_entities (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  entity_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  kind text NOT NULL CHECK (kind IN
    ('context','need','capability','process','action','result','client','role','department','crew','resource','report')),
  code text NOT NULL, name text NOT NULL, status text NOT NULL,
  description text NOT NULL, purpose text NOT NULL, procedure text NOT NULL,
  rules text NOT NULL, constraints text NOT NULL, success text NOT NULL,
  storage text NOT NULL, delivery text NOT NULL, exceptions text NOT NULL, questions text NOT NULL,
  level text, detail_state text, work_nature text, market_effect text, resource_state text,
  present_fields text[] NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id),
  UNIQUE(workspace_id,hypothesis_id,operating_version,ordinal),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version)
    REFERENCES company_operating_revisions(workspace_id,hypothesis_id,operating_version)
);

CREATE TABLE company_roles (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  entity_id text NOT NULL,
  mode text CHECK (mode IN ('hint','secretary','translator','copilot','company')),
  mode_source text,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,entity_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id)
);
-- No inference from role names. NULL mode means not yet assigned by an explicit source.
CREATE TABLE company_employee_profiles (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL,
  operating_version integer NOT NULL, entity_id text NOT NULL,
  profile_version integer NOT NULL CHECK (profile_version > 0),
  display_name text, trait_1 text, trait_2 text, trait_3 text, motto text,
  portrait_description text, portrait_file_url text, portrait_style text, role_color text,
  owner_selection_status text NOT NULL
    CHECK (owner_selection_status IN ('proposed','accepted','not_selected','unknown')),
  source_document_id text, source_pointer text NOT NULL,
  source_at text, accepted_by text, accepted_at text,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id,profile_version),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,entity_id)
    REFERENCES company_roles(workspace_id,hypothesis_id,operating_version,entity_id),
  CHECK ((trait_1 IS NULL AND trait_2 IS NULL AND trait_3 IS NULL) OR
         (trait_1 IS NOT NULL AND trait_2 IS NOT NULL AND trait_3 IS NOT NULL))
);
CREATE TABLE company_employee_name_options (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL,
  operating_version integer NOT NULL, entity_id text NOT NULL, profile_version integer NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0), name_text text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id,profile_version,ordinal),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,entity_id,profile_version)
    REFERENCES company_employee_profiles(workspace_id,hypothesis_id,operating_version,entity_id,profile_version)
);
CREATE TABLE company_role_prompt_versions (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL,
  operating_version integer NOT NULL, entity_id text NOT NULL,
  prompt_version text NOT NULL, text_body text NOT NULL, source_at text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed','accepted','enabled')),
  accepted_by text, accepted_at text,
  source_document_id text, source_pointer text NOT NULL,
  utf8_sha256 text NOT NULL CHECK (utf8_sha256 ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id,prompt_version),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,entity_id)
    REFERENCES company_roles(workspace_id,hypothesis_id,operating_version,entity_id),
  CHECK (status='proposed' OR (accepted_by IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE TABLE company_actions (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  entity_id text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,entity_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id)
);
CREATE TABLE company_resources (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  entity_id text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,entity_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id)
);

-- Scalar references preserve field identity; arrays preserve position, not a set.
CREATE TABLE company_node_refs (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  entity_id text NOT NULL, field_name text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  target_id text,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id,field_name,ordinal),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,entity_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,target_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX company_node_refs_target_idx
  ON company_node_refs(workspace_id,hypothesis_id,operating_version,target_id);

-- referenceIds may name legacy elements or documents, not only operating nodes.
-- Their polymorphic target is checked by the importer/reader against the same scope.
CREATE TABLE company_node_material_refs (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  entity_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  target_id text NOT NULL,
  target_namespace text NOT NULL CHECK (target_namespace IN ('node','element','document','competitor','strategy_entry','analyst_preparation','declared_unresolved')),
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id,ordinal),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,entity_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id)
);

CREATE TABLE company_node_inputs (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  entity_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  name text NOT NULL, source_id text, freshness text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id,ordinal),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,entity_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,source_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE company_node_schedules (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  entity_id text NOT NULL, days integer[] NOT NULL,
  hours text NOT NULL, timezone text NOT NULL, trigger text NOT NULL, deadline text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,entity_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id)
);
CREATE TABLE company_node_metrics (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  entity_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0), metric_id text NOT NULL,
  name text NOT NULL, formula text NOT NULL, unit text NOT NULL,
  plan numeric, fact numeric, numerator numeric, denominator numeric, scope text NOT NULL, evidence text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id,ordinal),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,entity_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id)
);
CREATE TABLE company_node_reporting (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  entity_id text NOT NULL, required boolean NOT NULL, form_name text NOT NULL,
  template_document_id text, template_version text NOT NULL, storage text NOT NULL,
  form_status text NOT NULL, approval_evidence text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,entity_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id)
);
CREATE TABLE company_node_register (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  entity_id text NOT NULL, availability text NOT NULL, period text NOT NULL,
  operations_per_period numeric, minutes_per_operation numeric,
  estimate_basis text NOT NULL, approval text NOT NULL, source text NOT NULL, proposal_reason text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,entity_id),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,entity_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id)
);
CREATE TABLE company_links (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  link_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  from_id text NOT NULL, to_id text NOT NULL, kind text NOT NULL, reason text NOT NULL,
  readiness_present boolean NOT NULL, structure text, resources text, trial text, evidence text,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,link_id),
  UNIQUE(workspace_id,hypothesis_id,operating_version,ordinal),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,from_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version,to_id)
    REFERENCES company_entities(workspace_id,hypothesis_id,operating_version,entity_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX company_links_from_idx ON company_links(workspace_id,hypothesis_id,operating_version,from_id);
CREATE INDEX company_links_to_idx ON company_links(workspace_id,hypothesis_id,operating_version,to_id);

CREATE TABLE company_customer_stages (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  stage_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0), name text NOT NULL,
  process_id text NOT NULL, b2b_process_id text, b2c text NOT NULL, b2b text NOT NULL, condition text NOT NULL,
  present_fields text[] NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,stage_id),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version)
    REFERENCES company_operating_revisions(workspace_id,hypothesis_id,operating_version)
);
CREATE TABLE company_stage_reports (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, operating_version integer NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0), pass integer NOT NULL,
  described text NOT NULL, boundary text NOT NULL, dependencies text NOT NULL,
  gaps text NOT NULL, next text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,operating_version,ordinal),
  FOREIGN KEY(workspace_id,hypothesis_id,operating_version)
    REFERENCES company_operating_revisions(workspace_id,hypothesis_id,operating_version)
);

-- Legacy elements have their own ID namespace; do not silently merge with graph nodes.
CREATE TABLE company_legacy_elements (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, revision integer NOT NULL,
  element_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  version integer NOT NULL, updated_at_source text NOT NULL, needs_review boolean NOT NULL,
  title text NOT NULL, section text NOT NULL, scope text NOT NULL, kind text NOT NULL,
  description text NOT NULL, content_status text NOT NULL, implementation_status text NOT NULL,
  present_fields text[] NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,revision,element_id),
  FOREIGN KEY(workspace_id,hypothesis_id) REFERENCES company_hypotheses(workspace_id,hypothesis_id),
  FOREIGN KEY(workspace_id,revision) REFERENCES company_model_revisions(workspace_id,revision)
);
CREATE TABLE company_element_details (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, revision integer NOT NULL,
  element_id text NOT NULL, field_name text NOT NULL, text_value text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,revision,element_id,field_name),
  FOREIGN KEY(workspace_id,hypothesis_id,revision,element_id)
    REFERENCES company_legacy_elements(workspace_id,hypothesis_id,revision,element_id)
);
CREATE TABLE company_legacy_relations (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, revision integer NOT NULL,
  relation_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  from_id text NOT NULL, to_id text NOT NULL, label text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,revision,relation_id),
  FOREIGN KEY(workspace_id,hypothesis_id,revision,from_id)
    REFERENCES company_legacy_elements(workspace_id,hypothesis_id,revision,element_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(workspace_id,hypothesis_id,revision,to_id)
    REFERENCES company_legacy_elements(workspace_id,hypothesis_id,revision,element_id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE company_documents (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, document_id text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,document_id),
  FOREIGN KEY(workspace_id,hypothesis_id) REFERENCES company_hypotheses(workspace_id,hypothesis_id)
);
CREATE TABLE company_document_versions (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, document_id text NOT NULL,
  revision integer NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  title text NOT NULL, text_body text NOT NULL, url text NOT NULL, updated_at_source text NOT NULL,
  utf8_sha256 text NOT NULL CHECK (utf8_sha256 ~ '^[a-f0-9]{64}$'),
  utf16_length bigint NOT NULL CHECK (utf16_length >= 0),
  format text NOT NULL CHECK (format IN ('text','json')),
  provenance text NOT NULL, present_fields text[] NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,document_id,revision),
  FOREIGN KEY(workspace_id,hypothesis_id,document_id) REFERENCES company_documents(workspace_id,hypothesis_id,document_id),
  FOREIGN KEY(workspace_id,revision) REFERENCES company_model_revisions(workspace_id,revision)
);
CREATE TABLE company_document_links (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, document_id text NOT NULL,
  revision integer NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0), element_id text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,document_id,revision,ordinal),
  FOREIGN KEY(workspace_id,hypothesis_id,document_id,revision)
    REFERENCES company_document_versions(workspace_id,hypothesis_id,document_id,revision),
  FOREIGN KEY(workspace_id,hypothesis_id,revision,element_id)
    REFERENCES company_legacy_elements(workspace_id,hypothesis_id,revision,element_id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE company_node_reporting ADD CONSTRAINT company_reporting_document_fk
  FOREIGN KEY(workspace_id,hypothesis_id,template_document_id)
  REFERENCES company_documents(workspace_id,hypothesis_id,document_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE company_decisions (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, revision integer NOT NULL,
  decision_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  source_at text NOT NULL, actor text NOT NULL, action text NOT NULL, reason text NOT NULL,
  proposal_id text, present_fields text[] NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,revision,decision_id),
  FOREIGN KEY(workspace_id,hypothesis_id) REFERENCES company_hypotheses(workspace_id,hypothesis_id),
  FOREIGN KEY(workspace_id,revision) REFERENCES company_model_revisions(workspace_id,revision)
);
CREATE TABLE company_decision_refs (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, revision integer NOT NULL,
  decision_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0), element_id text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,revision,decision_id,ordinal),
  FOREIGN KEY(workspace_id,hypothesis_id,revision,decision_id)
    REFERENCES company_decisions(workspace_id,hypothesis_id,revision,decision_id)
);
CREATE TABLE company_proposals (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, revision integer NOT NULL,
  proposal_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  target_id text NOT NULL, base_version integer NOT NULL,
  source text NOT NULL, rationale text NOT NULL, status text NOT NULL, clarification text NOT NULL,
  created_at_source text NOT NULL, present_fields text[] NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,revision,proposal_id),
  FOREIGN KEY(workspace_id,hypothesis_id) REFERENCES company_hypotheses(workspace_id,hypothesis_id),
  FOREIGN KEY(workspace_id,revision) REFERENCES company_model_revisions(workspace_id,revision)
);
CREATE TABLE company_task_drafts (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, revision integer NOT NULL,
  draft_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  title text NOT NULL, acceptance text NOT NULL, text_body text NOT NULL, created_at_source text NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,revision,draft_id),
  FOREIGN KEY(workspace_id,hypothesis_id) REFERENCES company_hypotheses(workspace_id,hypothesis_id),
  FOREIGN KEY(workspace_id,revision) REFERENCES company_model_revisions(workspace_id,revision)
);

-- Typed reversible auxiliary fields, not one JSON blob. Includes optional/unknown fields,
-- null-vs-missing, arrays, coordination, strategy, competitor directory and audit before/after.
-- source_path is an exact RFC 6901 pointer; array positions are not replaced by [] here.
CREATE TABLE company_extra_fields (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, revision integer NOT NULL,
  scope text NOT NULL, source_path text NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('object','array','string','number','boolean','null')),
  string_value text, number_value numeric, boolean_value boolean, child_count integer,
  PRIMARY KEY(workspace_id,hypothesis_id,revision,scope,source_path),
  FOREIGN KEY(workspace_id,hypothesis_id) REFERENCES company_hypotheses(workspace_id,hypothesis_id),
  FOREIGN KEY(workspace_id,revision) REFERENCES company_model_revisions(workspace_id,revision),
  CHECK (
    (value_type='string' AND string_value IS NOT NULL AND number_value IS NULL AND boolean_value IS NULL AND child_count IS NULL) OR
    (value_type='number' AND number_value IS NOT NULL AND string_value IS NULL AND boolean_value IS NULL AND child_count IS NULL) OR
    (value_type='boolean' AND boolean_value IS NOT NULL AND string_value IS NULL AND number_value IS NULL AND child_count IS NULL) OR
    (value_type='null' AND string_value IS NULL AND number_value IS NULL AND boolean_value IS NULL AND child_count IS NULL) OR
    (value_type IN ('array','object') AND child_count IS NOT NULL AND child_count >= 0 AND string_value IS NULL AND number_value IS NULL AND boolean_value IS NULL)
  )
);

-- Journal stable case IDs come from the current journal, not a new CRM.
CREATE TABLE company_journal_cases (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, case_id text NOT NULL,
  revision integer NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  source_document_id text NOT NULL, status text, title text,
  present_fields text[] NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,revision,case_id),
  FOREIGN KEY(workspace_id,hypothesis_id,source_document_id)
    REFERENCES company_documents(workspace_id,hypothesis_id,document_id),
  FOREIGN KEY(workspace_id,revision) REFERENCES company_model_revisions(workspace_id,revision)
);
CREATE TABLE company_journal_events (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, revision integer NOT NULL,
  case_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0),
  source_event_id text, source_at text, role_id text, stage text, text_body text,
  present_fields text[] NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,revision,case_id,ordinal),
  FOREIGN KEY(workspace_id,hypothesis_id,revision,case_id)
    REFERENCES company_journal_cases(workspace_id,hypothesis_id,revision,case_id)
);
CREATE TABLE company_issue_attempts (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, revision integer NOT NULL,
  case_id text NOT NULL, ordinal integer NOT NULL CHECK (ordinal >= 0), issue_key text NOT NULL,
  source_at text, change_text text, verification_text text, owner_effect text,
  source_pointer text NOT NULL, present_fields text[] NOT NULL,
  PRIMARY KEY(workspace_id,hypothesis_id,revision,case_id,ordinal),
  FOREIGN KEY(workspace_id,hypothesis_id,revision,case_id)
    REFERENCES company_journal_cases(workspace_id,hypothesis_id,revision,case_id)
);
CREATE INDEX company_issue_attempts_lookup_idx
  ON company_issue_attempts(workspace_id,hypothesis_id,issue_key,revision);
CREATE TABLE company_report_records (
  workspace_id text NOT NULL, hypothesis_id text NOT NULL, revision integer NOT NULL,
  document_id text NOT NULL, source_pointer text NOT NULL,
  role_id text, mode text, source_call_id text, period text, status text,
  PRIMARY KEY(workspace_id,hypothesis_id,revision,document_id,source_pointer),
  FOREIGN KEY(workspace_id,hypothesis_id,document_id)
    REFERENCES company_documents(workspace_id,hypothesis_id,document_id),
  FOREIGN KEY(workspace_id,revision) REFERENCES company_model_revisions(workspace_id,revision)
);

-- References existing append-only archive; never copies or overwrites the original JSON.
CREATE TABLE company_source_archives (
  workspace_id text NOT NULL, source_owner_key text NOT NULL, source_key text NOT NULL,
  semantic_sha256 text NOT NULL CHECK (semantic_sha256 ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(workspace_id,source_key),
  FOREIGN KEY(workspace_id,source_owner_key) REFERENCES company_workspaces(workspace_id,owner_key),
  FOREIGN KEY(source_owner_key,source_key) REFERENCES talkhint_project_model_history(owner_key,key)
);
CREATE TABLE company_import_runs (
  workspace_id text NOT NULL REFERENCES company_workspaces(workspace_id),
  run_id text NOT NULL, source_revision integer NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('prepared','importing','verifying','passed','failed','cutover')),
  schema_digest text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  PRIMARY KEY(workspace_id,run_id)
);
CREATE TABLE company_import_checks (
  workspace_id text NOT NULL, run_id text NOT NULL, check_id text NOT NULL,
  expected text NOT NULL, actual text, status text NOT NULL CHECK (status IN ('pending','passed','failed','unknown')),
  checked_at timestamptz,
  PRIMARY KEY(workspace_id,run_id,check_id),
  FOREIGN KEY(workspace_id,run_id) REFERENCES company_import_runs(workspace_id,run_id)
);
-- Reversible placement of explicit relational records into the unchanged JSON contract.
-- Contains column names/keys, never a serialized model or document.
CREATE TABLE company_record_locations (
  workspace_id text NOT NULL, revision integer NOT NULL,
  source_pointer text NOT NULL, target_table text NOT NULL,
  key_names text[] NOT NULL, key_values text[] NOT NULL,
  source_fields text[] NOT NULL, target_columns text[] NOT NULL,
  PRIMARY KEY(workspace_id,revision,source_pointer,target_table),
  FOREIGN KEY(workspace_id,revision) REFERENCES company_model_revisions(workspace_id,revision),
  CHECK (cardinality(key_names)=cardinality(key_values)),
  CHECK (cardinality(source_fields)=cardinality(target_columns))
);
CREATE INDEX company_record_locations_lookup_idx
  ON company_record_locations(workspace_id,revision,target_table);
COMMIT;
