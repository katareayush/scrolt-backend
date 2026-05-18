-- Track whether each answer was correct. Nullable for back-compat with
-- pre-existing rows (those came from a time when we didn't record it).
-- Future writes always populate it; spaced-repetition logic treats NULL
-- as "unknown, assume correct" so old answers aren't re-shown forever.
ALTER TABLE "user_progress" ADD COLUMN "correct" boolean;
--> statement-breakpoint
-- Partial index on wrong answers, used by the spaced-repetition query.
-- Tiny — wrong answers are a small fraction of the table.
CREATE INDEX IF NOT EXISTS "user_progress_wrong_idx"
  ON "user_progress" ("user_id", "answered_at")
  WHERE "correct" = false;
