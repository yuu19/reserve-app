CREATE TABLE `stripe_webhook_event` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`scope` text NOT NULL,
	`processing_status` text DEFAULT 'processing' NOT NULL,
	`organization_id` text,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`failure_reason` text,
	`processed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `stripe_webhook_event_scope_idx` ON `stripe_webhook_event` (`scope`);
--> statement-breakpoint
CREATE INDEX `stripe_webhook_event_organization_idx` ON `stripe_webhook_event` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `stripe_webhook_event_subscription_idx` ON `stripe_webhook_event` (`stripe_subscription_id`);
--> statement-breakpoint
CREATE TABLE `stripe_webhook_failure` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`event_type` text,
	`scope` text NOT NULL,
	`failure_stage` text NOT NULL,
	`failure_reason` text NOT NULL,
	`organization_id` text,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `stripe_webhook_failure_event_idx` ON `stripe_webhook_failure` (`event_id`);
--> statement-breakpoint
CREATE INDEX `stripe_webhook_failure_scope_idx` ON `stripe_webhook_failure` (`scope`);
--> statement-breakpoint
CREATE INDEX `stripe_webhook_failure_organization_idx` ON `stripe_webhook_failure` (`organization_id`);
