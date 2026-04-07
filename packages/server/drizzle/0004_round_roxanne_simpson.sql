DROP INDEX "idx_sessions_active_last_screenshot";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "compile_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_sessions_active_last_screenshot" ON "sessions" USING btree ("last_screenshot_at") WHERE status IN ('active', 'paused', 'pending');