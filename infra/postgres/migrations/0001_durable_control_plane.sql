CREATE TABLE IF NOT EXISTS ingress_nonces (
  key_id text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, nonce)
);
CREATE INDEX IF NOT EXISTS ingress_nonces_expiry_idx ON ingress_nonces (expires_at);

CREATE TABLE IF NOT EXISTS bridge_transport_outbox (
  id text PRIMARY KEY,
  stable_delivery_id text NOT NULL,
  event_type text NOT NULL,
  envelope jsonb NOT NULL,
  envelope_sha256 text NOT NULL,
  received_at timestamptz NOT NULL,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stable_delivery_id, event_type, envelope_sha256)
);
CREATE INDEX IF NOT EXISTS bridge_transport_outbox_ready_idx
  ON bridge_transport_outbox (next_attempt_at)
  WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS feishu_deliveries (
  id text PRIMARY KEY,
  app_id text NOT NULL,
  tenant_id text NOT NULL DEFAULT '',
  stable_delivery_id text NOT NULL,
  event_type text NOT NULL,
  source text NOT NULL CHECK (source IN ('managed-bridge', 'https-callback')),
  actor_open_id text,
  message_id text,
  callback_id text,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  correlation_id text NOT NULL,
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id, tenant_id, stable_delivery_id)
);

CREATE TABLE IF NOT EXISTS workflow_outbox (
  id text PRIMARY KEY,
  delivery_id text REFERENCES feishu_deliveries(id),
  task_id text,
  kind text NOT NULL,
  semantic_key text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'ready'
    CHECK (state IN ('ready', 'leased', 'succeeded', 'retry', 'dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (kind, semantic_key)
);
CREATE INDEX IF NOT EXISTS workflow_outbox_ready_idx
  ON workflow_outbox (next_attempt_at, created_at)
  WHERE state IN ('ready', 'retry');

CREATE TABLE IF NOT EXISTS coupon_tasks (
  id text PRIMARY KEY,
  owner_open_id text NOT NULL,
  route text NOT NULL CHECK (route IN ('three_source', 'p1_excel', 'legacy_oa')),
  state text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  version integer NOT NULL CHECK (version >= 1),
  policy_version text NOT NULL,
  task jsonb NOT NULL,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coupon_tasks_one_active_owner_idx
  ON coupon_tasks (owner_open_id)
  WHERE closed_at IS NULL;

CREATE TABLE IF NOT EXISTS coupon_task_revisions (
  task_id text NOT NULL REFERENCES coupon_tasks(id),
  revision integer NOT NULL CHECK (revision >= 1),
  source_confirmation jsonb,
  source_confirmation_sha256 text,
  final_snapshot jsonb,
  final_snapshot_sha256 text,
  rule_version text NOT NULL,
  template_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, revision)
);

CREATE TABLE IF NOT EXISTS coupon_task_operations (
  task_id text NOT NULL REFERENCES coupon_tasks(id),
  operation_id text NOT NULL,
  result_task jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, operation_id)
);

CREATE TABLE IF NOT EXISTS coupon_source_files (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  revision integer NOT NULL,
  role text NOT NULL CHECK (role IN ('couponTable', 'whitelist', 'blacklist')),
  message_id text NOT NULL,
  file_key text NOT NULL,
  object_key text NOT NULL,
  file_name text NOT NULL,
  bytes bigint NOT NULL CHECK (bytes > 0),
  sha256 text NOT NULL,
  recognition jsonb,
  selected_mapping jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id, revision) REFERENCES coupon_task_revisions(task_id, revision),
  UNIQUE (task_id, revision, role),
  UNIQUE (object_key)
);

CREATE TABLE IF NOT EXISTS coupon_artifacts (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  revision integer NOT NULL,
  role text NOT NULL CHECK (role IN (
    'standardCouponTable', 'standardWhitelist', 'standardBlacklist', 'standardCouponScreenshot'
  )),
  object_key text NOT NULL,
  drive_file_token text,
  base_file_token text,
  approval_file_code text,
  file_name text NOT NULL,
  bytes bigint NOT NULL CHECK (bytes > 0),
  sha256 text NOT NULL,
  template_id text,
  template_version text,
  source_artifact_sha256 text,
  render_range text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id, revision) REFERENCES coupon_task_revisions(task_id, revision),
  UNIQUE (task_id, revision, role),
  UNIQUE (object_key)
);

CREATE TABLE IF NOT EXISTS coupon_confirmations (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  revision integer NOT NULL,
  phase text NOT NULL CHECK (phase IN ('source', 'final')),
  owner_open_id text NOT NULL,
  action_delivery_id text NOT NULL REFERENCES feishu_deliveries(id),
  snapshot_sha256 text NOT NULL,
  confirmed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id, revision) REFERENCES coupon_task_revisions(task_id, revision),
  UNIQUE (task_id, revision, phase),
  UNIQUE (action_delivery_id)
);

CREATE TABLE IF NOT EXISTS coupon_submissions (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  revision integer NOT NULL,
  submission_key text NOT NULL,
  provider_uuid text NOT NULL,
  approval_code text NOT NULL,
  definition_hash text NOT NULL,
  form jsonb NOT NULL,
  form_sha256 text NOT NULL,
  state text NOT NULL CHECK (state IN (
    'queued', 'sending', 'outcome_unknown', 'instance_created', 'needs_review', 'failed'
  )),
  lease_token text,
  lease_expires_at timestamptz,
  reconciliation_due_at timestamptz,
  failure_code text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id, revision) REFERENCES coupon_task_revisions(task_id, revision),
  UNIQUE (task_id, revision),
  UNIQUE (submission_key),
  UNIQUE (provider_uuid)
);

CREATE TABLE IF NOT EXISTS native_approvals (
  instance_code text PRIMARY KEY,
  submission_id text NOT NULL UNIQUE REFERENCES coupon_submissions(id),
  instance_link text,
  lifecycle_state text NOT NULL,
  verification_state text NOT NULL,
  last_observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approval_observations (
  id text PRIMARY KEY,
  instance_code text NOT NULL REFERENCES native_approvals(instance_code),
  source_delivery_id text REFERENCES feishu_deliveries(id),
  observation_key text NOT NULL,
  payload jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_code, observation_key)
);

CREATE TABLE IF NOT EXISTS effect_receipts (
  id text PRIMARY KEY,
  task_id text REFERENCES coupon_tasks(id),
  kind text NOT NULL,
  semantic_key text NOT NULL,
  request_sha256 text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued', 'sending', 'succeeded', 'outcome_unknown', 'failed')),
  external_reference text,
  response_metadata jsonb,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, semantic_key)
);

CREATE TABLE IF NOT EXISTS workflow_audit_events (
  id text PRIMARY KEY,
  task_id text REFERENCES coupon_tasks(id),
  revision integer,
  delivery_id text REFERENCES feishu_deliveries(id),
  outbox_job_id text REFERENCES workflow_outbox(id),
  submission_id text REFERENCES coupon_submissions(id),
  actor_open_id text,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_dead_letters (
  id text PRIMARY KEY,
  outbox_job_id text NOT NULL UNIQUE REFERENCES workflow_outbox(id),
  error_code text NOT NULL,
  error_message text NOT NULL,
  replayed_at timestamptz,
  replayed_by text,
  replay_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runtime_leases (
  name text PRIMARY KEY,
  holder_id text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
