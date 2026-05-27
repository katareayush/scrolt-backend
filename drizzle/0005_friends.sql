-- Unique 6-char friend code per user. Nullable because we generate
-- lazily on first /api/friends/me — most users never need one.
ALTER TABLE "users" ADD COLUMN "friend_code" varchar(8);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_friend_code_unique"
  ON "users" ("friend_code")
  WHERE "friend_code" IS NOT NULL;
--> statement-breakpoint
-- Symmetric friendship: we INSERT both (a,b) and (b,a) on connect so
-- listing a user's friends is a single indexed scan.
CREATE TABLE "friends" (
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "friend_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "added_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "friends_pk" PRIMARY KEY ("user_id", "friend_user_id"),
  CONSTRAINT "friends_no_self" CHECK ("user_id" <> "friend_user_id")
);
