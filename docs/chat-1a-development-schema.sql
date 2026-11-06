-- Development-only additive schema reference. Not a production migration runner.
-- Managed production receives this schema through owner-initiated Publish.
CREATE TABLE IF NOT EXISTS chat_conversations (
  id varchar PRIMARY KEY, user_id varchar NOT NULL, client_request_id varchar NOT NULL,
  input_hash text NOT NULL, title text NOT NULL, next_sequence integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_request ON chat_conversations(user_id,client_request_id);
CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_identity ON chat_conversations(id,user_id);
CREATE INDEX IF NOT EXISTS chat_conversations_owner ON chat_conversations(user_id,updated_at,id);
CREATE TABLE IF NOT EXISTS chat_messages (
  id varchar PRIMARY KEY, user_id varchar NOT NULL, conversation_id varchar NOT NULL,
  sequence integer NOT NULL, client_request_id varchar NOT NULL, input_hash text NOT NULL,
  role text NOT NULL, text text NOT NULL DEFAULT '', status text NOT NULL,
  attachment_ids jsonb NOT NULL DEFAULT '[]'::jsonb, error_code text, lease_until timestamptz,
  provider_request_id text, model text, usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_owned_conversation FOREIGN KEY(conversation_id,user_id)
    REFERENCES chat_conversations(id,user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_sequence ON chat_messages(conversation_id,sequence);
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_request ON chat_messages(conversation_id,client_request_id,role);
CREATE INDEX IF NOT EXISTS chat_messages_owner ON chat_messages(user_id,conversation_id,sequence);
CREATE TABLE IF NOT EXISTS chat_attachments (
  id varchar PRIMARY KEY, user_id varchar NOT NULL, client_request_id varchar NOT NULL,
  input_hash text NOT NULL, name text NOT NULL, mime_type text NOT NULL, size integer NOT NULL,
  storage_key text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_attachments_request ON chat_attachments(user_id,client_request_id);
