-- Deduplicate any existing (user_id, card_id) pairs that may have been
-- created by concurrent writes before we had a uniqueness constraint.
-- Keeps the earliest row per pair (lowest ctid).
DELETE FROM user_progress a
USING user_progress b
WHERE a.ctid > b.ctid
  AND a.user_id = b.user_id
  AND a.card_id = b.card_id;
--> statement-breakpoint
ALTER TABLE "user_progress"
  ADD CONSTRAINT "user_progress_pk" PRIMARY KEY ("user_id", "card_id");
