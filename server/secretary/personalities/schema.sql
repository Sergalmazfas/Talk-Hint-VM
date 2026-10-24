-- Development migration only. Production schema belongs to the Publish flow.
CREATE TABLE IF NOT EXISTS secretary_personalities (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  search_name text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','retired')),
  current_version integer NOT NULL CHECK (current_version > 0),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS secretary_personalities_search_idx ON secretary_personalities(search_name text_pattern_ops);
CREATE INDEX IF NOT EXISTS secretary_personalities_slug_search_idx ON secretary_personalities(slug text_pattern_ops);
CREATE INDEX IF NOT EXISTS secretary_personalities_page_idx ON secretary_personalities(status,search_name,id);
CREATE TABLE IF NOT EXISTS secretary_personality_versions (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  personality_id varchar NOT NULL REFERENCES secretary_personalities(id),
  version integer NOT NULL CHECK (version > 0),
  content jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(personality_id,version)
);
CREATE TABLE IF NOT EXISTS secretary_personality_assignments (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id),
  number_id varchar NOT NULL REFERENCES phone_numbers(id),
  personality_id varchar NOT NULL,
  version integer NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(user_id,number_id),
  FOREIGN KEY(personality_id,version) REFERENCES secretary_personality_versions(personality_id,version)
);
CREATE TABLE IF NOT EXISTS secretary_outgoing_settings (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id),
  number_id varchar NOT NULL REFERENCES phone_numbers(id),
  card_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(user_id,number_id)
);
ALTER TABLE secretary_tasks ADD COLUMN IF NOT EXISTS outgoing_context jsonb;
