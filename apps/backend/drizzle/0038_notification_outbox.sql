CREATE TABLE `notification_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`booking_id` text,
	`participant_id` text,
	`event_type` text NOT NULL,
	`template_key` text NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`recipient_type` text NOT NULL,
	`recipient_email` text NOT NULL,
	`recipient_name` text,
	`subject_snapshot` text,
	`payload_json` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`scheduled_for` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`idempotency_key` text NOT NULL,
	`locked_at` integer,
	`locked_by` text,
	`lock_expires_at` integer,
	`provider` text,
	`provider_message_id` text,
	`last_error` text,
	`sent_at` integer,
	`cancelled_at` integer,
	`dead_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_outbox_idempotency_uidx` ON `notification_outbox` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `notification_outbox_due_idx` ON `notification_outbox` (`status`,`next_attempt_at`,`scheduled_for`);
--> statement-breakpoint
CREATE INDEX `notification_outbox_booking_idx` ON `notification_outbox` (`booking_id`);
--> statement-breakpoint
CREATE INDEX `notification_outbox_store_idx` ON `notification_outbox` (`organization_id`,`store_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `notification_outbox_event_idx` ON `notification_outbox` (`event_type`,`status`,`scheduled_for`);
--> statement-breakpoint
ALTER TABLE `notification_log` ADD `outbox_id` text;
--> statement-breakpoint
ALTER TABLE `notification_log` ADD `template_key` text;
--> statement-breakpoint
ALTER TABLE `notification_log` ADD `recipient_type` text;
--> statement-breakpoint
ALTER TABLE `notification_log` ADD `attempt_number` integer;
--> statement-breakpoint
ALTER TABLE `notification_log` ADD `provider` text;
--> statement-breakpoint
ALTER TABLE `notification_log` ADD `provider_message_id` text;
--> statement-breakpoint
ALTER TABLE `notification_log` ADD `response_json` text;
--> statement-breakpoint
CREATE INDEX `notification_log_outbox_idx` ON `notification_log` (`outbox_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `notification_log_attempt_idx` ON `notification_log` (`outbox_id`,`attempt_number`);
