-- Durable command-intake worker foundation. This migration intentionally adds
-- receipt outcome/effect-intent persistence without enabling any ingress route,
-- card sender, file handling, Base/Drive access, renderer, or Approval action.

ALTER TABLE feishu_deliveries
  ADD COLUMN IF NOT EXISTS schema_version text NOT NULL DEFAULT 'feishu-delivery-v1';

ALTER TABLE feishu_deliveries
  ADD COLUMN IF NOT EXISTS chat_type text NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'feishu_deliveries_chat_type_check'
  ) THEN
    ALTER TABLE feishu_deliveries
      ADD CONSTRAINT feishu_deliveries_chat_type_check
      CHECK (chat_type IN ('p2p', 'group', 'unknown'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS feishu_delivery_outcomes (
  receipt_id text PRIMARY KEY REFERENCES feishu_deliveries(id),
  kind text NOT NULL CHECK (kind IN ('handled', 'ignored', 'rejected')),
  reason text,
  task_id text REFERENCES coupon_tasks(id),
  effect_id text REFERENCES effect_receipts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'handled' AND task_id IS NOT NULL AND effect_id IS NOT NULL)
    OR (kind IN ('ignored', 'rejected') AND task_id IS NULL AND effect_id IS NULL)
  )
);

ALTER TABLE effect_receipts
  ADD COLUMN IF NOT EXISTS request_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS feishu_delivery_outcomes_task_idx
  ON feishu_delivery_outcomes (task_id)
  WHERE task_id IS NOT NULL;
