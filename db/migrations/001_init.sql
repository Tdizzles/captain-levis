-- 001_init: core schema for Captain Levi's site backend.
-- Applied by lib/migrate.ts (tracked in schema_migrations). Works on Postgres 14+ and PGlite.

CREATE TABLE IF NOT EXISTS settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-year counter behind inquiry references like CL-2026-0001.
CREATE TABLE IF NOT EXISTS ref_counters (
  year  integer PRIMARY KEY,
  n     integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id            uuid PRIMARY KEY,
  state         jsonb NOT NULL DEFAULT '{}'::jsonb,
  slots         jsonb NOT NULL DEFAULT '{}'::jsonb,
  page          text,
  messages      jsonb NOT NULL DEFAULT '[]'::jsonb,
  cost_usd      numeric(10,6) NOT NULL DEFAULT 0,
  token_in      integer NOT NULL DEFAULT 0,
  token_out     integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  inquiry_id    uuid
);

CREATE TABLE IF NOT EXISTS inquiries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref              text NOT NULL UNIQUE,
  kind             text NOT NULL DEFAULT 'quote',
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','quoted','closed')),
  name             text NOT NULL,
  email            text NOT NULL,
  phone            text NOT NULL,
  service          text NOT NULL,
  boat_make        text,
  boat_model       text,
  boat_year        integer,
  boat_raw         text,
  boat_location    text,
  damage_location  text,
  damage_type      text,
  message          text NOT NULL,
  message_hash     text NOT NULL,
  page             text,
  source           text NOT NULL DEFAULT 'form' CHECK (source IN ('form','chat')),
  chat_session_id  uuid REFERENCES chat_sessions(id) ON DELETE SET NULL,
  idempotency_key  text UNIQUE,
  ip_hash          text,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inquiries_created_idx ON inquiries (created_at DESC);
CREATE INDEX IF NOT EXISTS inquiries_status_idx ON inquiries (status);
CREATE INDEX IF NOT EXISTS inquiries_dupe_idx ON inquiries (email, message_hash, created_at);

CREATE TABLE IF NOT EXISTS photos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id       uuid REFERENCES inquiries(id) ON DELETE CASCADE,
  chat_session_id  uuid REFERENCES chat_sessions(id) ON DELETE SET NULL,
  filename         text NOT NULL,
  mime             text NOT NULL,
  bytes            bytea NOT NULL,
  width            integer NOT NULL,
  height           integer NOT NULL,
  size             integer NOT NULL,
  sha256           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_inquiry_idx ON photos (inquiry_id);
CREATE INDEX IF NOT EXISTS photos_session_idx ON photos (chat_session_id);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id    uuid REFERENCES inquiries(id) ON DELETE CASCADE,
  provider      text NOT NULL DEFAULT 'resend',
  provider_id   text,
  "to"          text NOT NULL,
  subject       text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','pending_config')),
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);
CREATE INDEX IF NOT EXISTS email_deliveries_status_idx ON email_deliveries (status);

CREATE TABLE IF NOT EXISTS rate_limits (
  key           text NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id             bigserial PRIMARY KEY,
  name           text NOT NULL,
  props          jsonb NOT NULL DEFAULT '{}'::jsonb,
  page           text,
  referrer_host  text,
  session_hash   text,
  day            date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_day_idx ON analytics_events (day, name);

CREATE TABLE IF NOT EXISTS audit_events (
  id          bigserial PRIMARY KEY,
  actor       text NOT NULL,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('chat','reply_draft')),
  model       text NOT NULL,
  tokens_in   integer NOT NULL DEFAULT 0,
  tokens_out  integer NOT NULL DEFAULT 0,
  cost_usd    numeric(10,6) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage (created_at);
