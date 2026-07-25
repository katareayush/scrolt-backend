CREATE TABLE "analytics_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"event" varchar(32) NOT NULL,
	"mode" varchar(32),
	"variant" varchar(64),
	"card_id" varchar(255),
	"correct" boolean,
	"duration_ms" integer,
	"authed" boolean DEFAULT false NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analytics_events_at_idx" ON "analytics_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "analytics_events_user_at_idx" ON "analytics_events" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "analytics_events_mode_at_idx" ON "analytics_events" USING btree ("mode","at");