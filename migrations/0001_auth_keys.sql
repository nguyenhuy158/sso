CREATE TABLE IF NOT EXISTS sso_auth_keys (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    sub TEXT NOT NULL,
    email TEXT,
    owner_name TEXT,
    picture TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    last_used_at TEXT
);
