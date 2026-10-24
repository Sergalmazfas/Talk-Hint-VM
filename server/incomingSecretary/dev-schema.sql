-- Development DB only. Never run automatically or apply to production.
CREATE TABLE IF NOT EXISTS incoming_secretary_dev_requests
  (LIKE incoming_secretary_requests INCLUDING ALL,
   FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
   FOREIGN KEY(number_id) REFERENCES phone_numbers(id) ON DELETE CASCADE);
ALTER TABLE incoming_secretary_dev_requests ALTER COLUMN notification_status SET DEFAULT 'not_applicable';
CREATE INDEX IF NOT EXISTS incoming_secretary_dev_owner_idx
  ON incoming_secretary_dev_requests(user_id,updated_at DESC);
-- TEST history must not block the existing account/number deletion flows.
ALTER TABLE incoming_secretary_dev_requests
  DROP CONSTRAINT IF EXISTS incoming_secretary_dev_requests_user_id_fkey,
  ADD CONSTRAINT incoming_secretary_dev_requests_user_id_fkey
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS incoming_secretary_dev_requests_number_id_fkey,
  ADD CONSTRAINT incoming_secretary_dev_requests_number_id_fkey
    FOREIGN KEY(number_id) REFERENCES phone_numbers(id) ON DELETE CASCADE;
-- A browser-only session has no phone number. Existing numbered TEST rows retain their FK.
ALTER TABLE incoming_secretary_dev_requests ALTER COLUMN number_id DROP NOT NULL;
CREATE TABLE IF NOT EXISTS incoming_secretary_dev_sandbox_settings (
  user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb
);
