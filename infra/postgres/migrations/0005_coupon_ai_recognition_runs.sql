-- P0 DeepSeek recognition is a candidate-only effect. Raw workbook bytes,
-- prompts and provider responses are deliberately not persisted here.
CREATE TABLE IF NOT EXISTS coupon_ai_recognition_runs (
  id text PRIMARY KEY,
  semantic_key text NOT NULL UNIQUE,
  pilot_record_id text NOT NULL,
  business_task_id text NOT NULL,
  owner_open_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  source_slot text NOT NULL CHECK (
    source_slot IN ('couponTable', 'whitelist', 'blacklist', 'pending')
  ),
  source_reference jsonb NOT NULL,
  source_sha256 text NOT NULL,
  source_file_name text NOT NULL,
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

CREATE INDEX IF NOT EXISTS coupon_ai_recognition_projection_idx
  ON coupon_ai_recognition_runs (status, projected_at, updated_at)
  WHERE status <> 'pending' AND projected_at IS NULL;
