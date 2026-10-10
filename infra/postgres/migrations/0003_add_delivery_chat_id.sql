-- Retain authenticated chat correlation metadata without using it as a substitute
-- for the persisted chat_type direct-message proof.
ALTER TABLE feishu_deliveries
  ADD COLUMN IF NOT EXISTS chat_id text;
