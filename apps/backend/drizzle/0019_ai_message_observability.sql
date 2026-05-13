ALTER TABLE `ai_message` ADD `ai_model` text;
--> statement-breakpoint
ALTER TABLE `ai_message` ADD `ai_latency_ms` integer;
--> statement-breakpoint
ALTER TABLE `ai_message` ADD `ai_generation_status` text;
--> statement-breakpoint
ALTER TABLE `ai_message` ADD `ai_error_summary` text;
