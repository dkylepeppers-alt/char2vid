CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  password_salt BLOB NOT NULL,
  password_hash BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS setup_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  completed INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO setup_state (id, completed) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES owners (id)
);

CREATE INDEX IF NOT EXISTS sessions_owner ON sessions (owner_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_key TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS login_attempts_key_time
  ON login_attempts (attempt_key, attempted_at);

CREATE TABLE IF NOT EXISTS provider_keys (
  owner_id TEXT PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  nonce BLOB NOT NULL,
  last4 TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES owners (id)
);

CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  mime TEXT NOT NULL,
  purpose TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'finalized', 'expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES owners (id)
);

CREATE INDEX IF NOT EXISTS transfers_owner_state ON transfers (owner_id, state);

CREATE TABLE IF NOT EXISTS transfer_parts (
  transfer_id TEXT NOT NULL,
  part_index INTEGER NOT NULL CHECK (part_index >= 0),
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  PRIMARY KEY (transfer_id, part_index),
  FOREIGN KEY (transfer_id) REFERENCES transfers (id)
);
