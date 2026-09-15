CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  operation TEXT NOT NULL,
  model_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  draft_json TEXT NOT NULL,
  provider_state TEXT NOT NULL CHECK (
    provider_state IN (
      'queued',
      'submitting',
      'submission-unknown',
      'running',
      'completed',
      'failed',
      'cancelled',
      'recovery-required'
    )
  ),
  save_state TEXT NOT NULL CHECK (
    save_state IN ('absent', 'downloading', 'verifying', 'saved', 'failed')
  ),
  provider_run_id TEXT,
  error_code TEXT,
  lease_owner TEXT,
  lease_until TEXT,
  next_attempt_at TEXT,
  poll_count INTEGER NOT NULL DEFAULT 0,
  cost_json TEXT NOT NULL,
  original_job_id TEXT,
  provider_ticket_json TEXT,
  status_adapter_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES owners (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_owner_client_id
  ON jobs (owner_id, client_request_id);
CREATE INDEX IF NOT EXISTS jobs_due
  ON jobs (provider_state, next_attempt_at);
CREATE INDEX IF NOT EXISTS jobs_owner_updated
  ON jobs (owner_id, updated_at, id);

CREATE TABLE IF NOT EXISTS job_outputs (
  job_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  sha256 TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  PRIMARY KEY (job_id, ordinal),
  FOREIGN KEY (job_id) REFERENCES jobs (id)
);

CREATE TABLE IF NOT EXISTS job_input_leases (
  job_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL,
  bound_at TEXT NOT NULL,
  PRIMARY KEY (job_id, transfer_id),
  FOREIGN KEY (job_id) REFERENCES jobs (id),
  FOREIGN KEY (transfer_id) REFERENCES transfers (id)
);
