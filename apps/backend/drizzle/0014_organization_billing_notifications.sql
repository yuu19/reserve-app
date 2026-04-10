CREATE TABLE `organization_billing_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`recipient_user_id` text,
	`notification_kind` text NOT NULL,
	`channel` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`delivery_state` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`stripe_event_id` text,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`recipient_email` text,
	`plan_state` text NOT NULL,
	`subscription_status` text NOT NULL,
	`payment_method_status` text NOT NULL,
	`trial_ends_at` integer,
	`failure_reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `organization_billing_notification_org_idx` ON `organization_billing_notification` (`organization_id`,`sequence_number`);
--> statement-breakpoint
CREATE INDEX `organization_billing_notification_event_idx` ON `organization_billing_notification` (`stripe_event_id`);
--> statement-breakpoint
CREATE INDEX `organization_billing_notification_recipient_idx` ON `organization_billing_notification` (`recipient_user_id`);
