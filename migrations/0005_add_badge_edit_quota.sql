-- Migration number: 0005 	 2026-07-27

-- Moderating a badge now costs a Workers AI inference call, so a user looping
-- EditBadge can drain the account's daily Neuron allocation and, because
-- moderation fails closed, disable badge editing for everyone. These columns
-- back a per-user hourly cap on edits that actually reach the model.
ALTER TABLE badge ADD COLUMN moderation_window_start INTEGER NOT NULL DEFAULT 0;
ALTER TABLE badge ADD COLUMN moderation_count INTEGER NOT NULL DEFAULT 0;
