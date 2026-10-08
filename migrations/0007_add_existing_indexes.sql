-- Migration number: 0007 	 2026-10-08


-- These indexes were created on the production database by hand and never
-- recorded here. Same names, so this is a no-op there; it brings local and
-- fresh databases in line. GetPosts and the mention queries rely on
-- idx_bbs_reply_post_time to avoid scanning every reply.
CREATE INDEX IF NOT EXISTS idx_phpsessid ON phpsessid(token);
CREATE INDEX IF NOT EXISTS idx_bbs_mention_to_user_id ON bbs_mention(to_user_id);
CREATE INDEX IF NOT EXISTS idx_short_message_mention_to_user_id ON short_message_mention(to_user_id);
CREATE INDEX IF NOT EXISTS idx_bbs_reply_post_time ON bbs_reply(post_id, reply_time);
