-- Tables live in a D1 instance shared with other projects, so every name is
-- prefixed with `sso_`.

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
