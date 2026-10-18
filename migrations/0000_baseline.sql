-- Baseline: the sso_* schema as it runs in production on 2026-10-18.
-- IF NOT EXISTS makes it a no-op there; on a fresh local D1 it creates the schema.

CREATE TABLE IF NOT EXISTS sso_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT,
    name TEXT,
    picture TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sso_users_email ON sso_users(email);
