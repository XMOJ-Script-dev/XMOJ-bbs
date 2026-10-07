-- Migration number: 0006 	 2026-10-07

CREATE TABLE IF NOT EXISTS session_token (
    token_hash TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    create_time INTEGER NOT NULL,
    last_used INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_token_user_id ON session_token (user_id);

-- Best score a user has reached on a problem. Scores only go up, so once a
-- score clears a threshold it never needs to be scraped from xmoj again.
CREATE TABLE IF NOT EXISTS problem_score (
    user_id TEXT NOT NULL,
    problem_id INTEGER NOT NULL,
    score INTEGER NOT NULL,
    PRIMARY KEY (user_id, problem_id)
);
