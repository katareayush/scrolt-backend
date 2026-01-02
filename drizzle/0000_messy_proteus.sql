CREATE TYPE "public"."category" AS ENUM('emotion', 'everyday', 'work', 'opinion', 'social', 'precision');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TABLE "cards" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"sentence" text NOT NULL,
	"options" text[] NOT NULL,
	"answer" text NOT NULL,
	"explanation" text NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"category" "category" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_progress" (
	"user_id" varchar(255) NOT NULL,
	"card_id" varchar(255) NOT NULL,
	"answered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;