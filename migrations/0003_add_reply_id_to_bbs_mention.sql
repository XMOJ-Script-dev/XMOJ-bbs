-- Migration number: 0003 	 2025-02-07T12:02:55.346Z

ALTER TABLE bbs_mention ADD COLUMN reply_id INTEGER NOT NULL DEFAULT 0;