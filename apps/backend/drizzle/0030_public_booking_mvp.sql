PRAGMA foreign_keys=OFF;
--> statement-breakpoint
ALTER TABLE `public_site_setting` ADD COLUMN `status` text DEFAULT 'public' NOT NULL;
--> statement-breakpoint
ALTER TABLE `public_site_setting` ADD COLUMN `accept_bookings` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `public_site_setting` ADD COLUMN `noindex` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS `booking_slot_participant_uidx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `booking_org_participant_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `booking_org_service_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `booking_org_status_created_idx`;
--> statement-breakpoint
CREATE TABLE `booking_new` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`service_id` text NOT NULL,
	`participant_id` text,
	`public_id` text,
	`source` text DEFAULT 'participant' NOT NULL,
	`participants_count` integer DEFAULT 1 NOT NULL,
	`customer_name` text,
	`customer_email` text,
	`customer_phone` text,
	`note` text,
	`created_by_user_id` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`cancel_reason` text,
	`cancelled_at` integer,
	`cancelled_by_user_id` text,
	`no_show_marked_at` integer,
	`ticket_pack_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `slot`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `service`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ticket_pack_id`) REFERENCES `ticket_pack`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `booking_new` (
	`id`,
	`organization_id`,
	`store_id`,
	`slot_id`,
	`service_id`,
	`participant_id`,
	`public_id`,
	`source`,
	`participants_count`,
	`customer_name`,
	`customer_email`,
	`customer_phone`,
	`note`,
	`created_by_user_id`,
	`status`,
	`cancel_reason`,
	`cancelled_at`,
	`cancelled_by_user_id`,
	`no_show_marked_at`,
	`ticket_pack_id`,
	`created_at`,
	`updated_at`
)
SELECT
	`booking`.`id`,
	`booking`.`organization_id`,
	`booking`.`store_id`,
	`booking`.`slot_id`,
	`booking`.`service_id`,
	`booking`.`participant_id`,
	NULL,
	'participant',
	`booking`.`participants_count`,
	`participant`.`name`,
	`participant`.`email`,
	NULL,
	NULL,
	`participant`.`user_id`,
	`booking`.`status`,
	`booking`.`cancel_reason`,
	`booking`.`cancelled_at`,
	`booking`.`cancelled_by_user_id`,
	`booking`.`no_show_marked_at`,
	`booking`.`ticket_pack_id`,
	`booking`.`created_at`,
	`booking`.`updated_at`
FROM `booking`
LEFT JOIN `participant` ON `participant`.`id` = `booking`.`participant_id`;
--> statement-breakpoint
DROP TABLE `booking`;
--> statement-breakpoint
ALTER TABLE `booking_new` RENAME TO `booking`;
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_slot_participant_uidx` ON `booking` (`slot_id`,`participant_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_public_id_uidx` ON `booking` (`public_id`);
--> statement-breakpoint
CREATE INDEX `booking_org_participant_created_idx` ON `booking` (`organization_id`,`participant_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `booking_org_service_created_idx` ON `booking` (`organization_id`,`service_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `booking_org_status_created_idx` ON `booking` (`organization_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `booking_org_source_created_idx` ON `booking` (`organization_id`,`source`,`created_at`);
--> statement-breakpoint
CREATE TABLE `booking_answer` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`field_id` text NOT NULL,
	`label_snapshot` text NOT NULL,
	`value_json` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `booking_answer_booking_idx` ON `booking_answer` (`booking_id`);
--> statement-breakpoint
CREATE TABLE `booking_companion` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`name` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `booking_companion_booking_idx` ON `booking_companion` (`booking_id`);
--> statement-breakpoint
CREATE TABLE `booking_public_action_token` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`purpose` text NOT NULL,
	`token_hash` text NOT NULL,
	`email_snapshot` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_public_action_token_hash_uidx` ON `booking_public_action_token` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `booking_public_action_token_booking_purpose_idx` ON `booking_public_action_token` (`booking_id`,`purpose`);
--> statement-breakpoint
CREATE TABLE `public_site_notification_setting` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`notify_owner` integer DEFAULT 1 NOT NULL,
	`notify_admins` integer DEFAULT 1 NOT NULL,
	`notify_store_managers` integer DEFAULT 1 NOT NULL,
	`notify_staff` integer DEFAULT 0 NOT NULL,
	`additional_emails_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_site_notification_setting_store_uidx` ON `public_site_notification_setting` (`organization_id`,`store_id`);
--> statement-breakpoint
CREATE TABLE `notification_log` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`booking_id` text,
	`event_type` text NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`recipient_email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`dedupe_key` text NOT NULL,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_log_dedupe_uidx` ON `notification_log` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `notification_log_booking_event_idx` ON `notification_log` (`booking_id`,`event_type`);
--> statement-breakpoint
CREATE INDEX `notification_log_org_created_idx` ON `notification_log` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `reminder_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`service_id` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`minutes_before` integer DEFAULT 1440 NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `service`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reminder_policy_store_enabled_idx` ON `reminder_policy` (`organization_id`,`store_id`,`enabled`);
--> statement-breakpoint
CREATE INDEX `reminder_policy_service_idx` ON `reminder_policy` (`service_id`);
--> statement-breakpoint
CREATE TABLE `reminder_log` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`store_id` text NOT NULL,
	`booking_id` text NOT NULL,
	`reminder_policy_id` text,
	`channel` text DEFAULT 'email' NOT NULL,
	`recipient_email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`dedupe_key` text NOT NULL,
	`error_message` text,
	`scheduled_for` integer NOT NULL,
	`sent_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `store`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reminder_policy_id`) REFERENCES `reminder_policy`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_log_dedupe_uidx` ON `reminder_log` (`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `reminder_log_booking_idx` ON `reminder_log` (`booking_id`);
--> statement-breakpoint
CREATE INDEX `reminder_log_scheduled_status_idx` ON `reminder_log` (`scheduled_for`,`status`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
