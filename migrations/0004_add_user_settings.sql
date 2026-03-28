-- Migration number: 0004 	 2026-03-22

CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}'
);
