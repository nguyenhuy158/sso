CREATE TABLE IF NOT EXISTS sso_device_codes (
    device_code_hash TEXT PRIMARY KEY,
    user_code TEXT NOT NULL UNIQUE,
    client_name TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    interval_seconds INTEGER NOT NULL,
    last_polled_at INTEGER,
    sub TEXT,
    email TEXT,
    name TEXT,
    picture TEXT,
    approved_at INTEGER,
    denied_at INTEGER
);
