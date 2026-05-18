CREATE TABLE "daily_results" (
	"user_id" varchar(255) NOT NULL,
	"date" date NOT NULL,
	"correct" integer NOT NULL,
	"total" integer NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_results_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
-- Used by daily leaderboard queries and "did anyone play today" admin views.
CREATE INDEX IF NOT EXISTS "daily_results_date_idx" ON "daily_results" ("date");
