-- Owner supplement text is persisted only for the current P0 draft so a
-- retry never needs to ask DeepSeek twice. Provider request/response bodies
-- are deliberately not stored.
CREATE TABLE IF NOT EXISTS coupon_ai_text_runs (
  id text PRIMARY KEY,
  semantic_key text NOT NULL UNIQUE,
  pilot_record_id text NOT NULL,
  business_task_id text NOT NULL,
  owner_open_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  supplement_text text NOT NULL,
  text_sha256 text NOT NULL,
  provider text NOT NULL CHECK (provider = 'deepseek'),
  model text NOT NULL,
  prompt_version text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'succeeded', 'failed', 'outcome_unknown')
  ),
  request_sha256 text,
  response_sha256 text,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  validated_result jsonb,
  fallback_code text,
  projected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coupon_ai_text_projection_idx
  ON coupon_ai_text_runs (status, projected_at, updated_at)
  WHERE status <> 'pending' AND projected_at IS NULL;
