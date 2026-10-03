CREATE INDEX "harness_events_at" ON "harness_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "harness_runs_started_at" ON "harness_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "harness_runs_failed_ended" ON "harness_runs" USING btree ("ended_at") WHERE "harness_runs"."outcome" = 'failed';