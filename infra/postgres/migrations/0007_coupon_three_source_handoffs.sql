CREATE TABLE IF NOT EXISTS coupon_three_source_handoffs (
  source_identity text PRIMARY KEY,
  task_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  confirmation_snapshot_hash text NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'created', 'outcome_unknown', 'failed')),
  oa_draft_record_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, revision, confirmation_snapshot_hash)
);

CREATE INDEX IF NOT EXISTS coupon_three_source_handoffs_state_idx
  ON coupon_three_source_handoffs (state, updated_at);
