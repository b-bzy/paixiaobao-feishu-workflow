-- Effect intents are the durable boundary before any Feishu card/API side effect.
-- `queued` is both the initial and retry state; `sending` holds a time-bound
-- lease; `failed` has a matching row in effect_dead_letters; and
-- `outcome_unknown` is deliberately excluded from automatic resend.
ALTER TABLE effect_receipts
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0
  CHECK (attempts >= 0);
ALTER TABLE effect_receipts
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE effect_receipts
  ADD COLUMN IF NOT EXISTS lease_token text;
ALTER TABLE effect_receipts
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE effect_receipts
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS effect_receipts_ready_idx
  ON effect_receipts (next_attempt_at, created_at)
  WHERE state IN ('queued', 'sending');

CREATE TABLE IF NOT EXISTS effect_dead_letters (
  id text PRIMARY KEY,
  effect_id text NOT NULL UNIQUE REFERENCES effect_receipts(id),
  error_code text NOT NULL,
  error_message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
