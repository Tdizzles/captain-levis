-- 002_estimates: the quote builder's documents (Quote Desk v2). The document itself is one jsonb blob in the
-- shape of lib/estimates/types.ts; totals are recomputed server-side on every save and cached for lists.

CREATE TABLE IF NOT EXISTS estimate_seq (
  id  integer PRIMARY KEY,
  n   integer NOT NULL
);
INSERT INTO estimate_seq (id, n) VALUES (1, 1000) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS estimates (
  id             uuid PRIMARY KEY,
  number         text NOT NULL UNIQUE,
  inquiry_id     uuid REFERENCES inquiries(id) ON DELETE SET NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','approved','declined')),
  customer_name  text NOT NULL DEFAULT '',
  vessel_label   text NOT NULL DEFAULT '',
  total_cents    integer NOT NULL DEFAULT 0,
  doc            jsonb NOT NULL,
  totals         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimates_updated_idx ON estimates (updated_at DESC);
CREATE INDEX IF NOT EXISTS estimates_inquiry_idx ON estimates (inquiry_id);

-- Every save keeps the previous document, so the assistant's edits (and human ones) can be undone.
CREATE TABLE IF NOT EXISTS estimate_versions (
  id           bigserial PRIMARY KEY,
  estimate_id  uuid NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  version      integer NOT NULL,
  doc          jsonb NOT NULL,
  actor        text NOT NULL,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (estimate_id, version)
);

-- Captain Levi (the estimate assistant) conversations, one per estimate.
CREATE TABLE IF NOT EXISTS estimate_chats (
  estimate_id  uuid PRIMARY KEY REFERENCES estimates(id) ON DELETE CASCADE,
  messages     jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_usage DROP CONSTRAINT IF EXISTS ai_usage_kind_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_kind_check CHECK (kind IN ('chat','reply_draft','estimate_assistant'));
