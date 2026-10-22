-- Additive schema only. Apply in development; production uses the normal Publish schema review.
CREATE TABLE IF NOT EXISTS secretary_calendar_grants (
  number_id varchar PRIMARY KEY REFERENCES phone_numbers(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret text NOT NULL,
  calendar_id text,
  revision varchar NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS secretary_calendar_attempts (
  number_id varchar PRIMARY KEY REFERENCES phone_numbers(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE,
  browser_hash text NOT NULL,
  secret text NOT NULL,
  consumed boolean NOT NULL DEFAULT false,
  expires_at timestamp NOT NULL
);
