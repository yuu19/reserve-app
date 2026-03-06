PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `classroom` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `classroom_organization_created_idx` ON `classroom` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `classroom_member` (
	`id` text PRIMARY KEY NOT NULL,
	`classroom_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `classroom_member_classroom_idx` ON `classroom_member` (`classroom_id`);
--> statement-breakpoint
CREATE INDEX `classroom_member_user_idx` ON `classroom_member` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `classroom_member_classroom_user_uidx` ON `classroom_member` (`classroom_id`,`user_id`);
--> statement-breakpoint
INSERT INTO `classroom` (`id`, `organization_id`, `name`, `created_at`, `updated_at`)
SELECT `id`, `id`, `name`, `created_at`, `created_at` FROM `organization`;
--> statement-breakpoint
INSERT INTO `classroom_member` (`id`, `classroom_id`, `user_id`, `role`, `created_at`)
SELECT
	`id`,
	`organization_id`,
	`user_id`,
	CASE
		WHEN `role` IN ('owner', 'admin') THEN 'manager'
		ELSE 'staff'
	END,
	`created_at`
FROM `member`;
--> statement-breakpoint
CREATE TABLE `__new_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_participant` (`id`, `organization_id`, `classroom_id`, `user_id`, `email`, `name`, `created_at`, `updated_at`)
SELECT `id`, `organization_id`, `organization_id`, `user_id`, `email`, `name`, `created_at`, `updated_at`
FROM `participant`;
--> statement-breakpoint
DROP TABLE `participant`;
--> statement-breakpoint
ALTER TABLE `__new_participant` RENAME TO `participant`;
--> statement-breakpoint
CREATE INDEX `participant_organization_created_idx` ON `participant` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `participant_organization_user_uidx` ON `participant` (`organization_id`,`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `participant_organization_email_uidx` ON `participant` (`organization_id`,`email`);
--> statement-breakpoint
CREATE TABLE `__new_service` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`image_url` text,
	`kind` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`capacity` integer NOT NULL,
	`booking_open_minutes_before` integer,
	`booking_close_minutes_before` integer,
	`cancellation_deadline_minutes` integer,
	`timezone` text DEFAULT 'Asia/Tokyo' NOT NULL,
	`booking_policy` text DEFAULT 'instant' NOT NULL,
	`requires_ticket` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_service` (`id`, `organization_id`, `classroom_id`, `name`, `description`, `image_url`, `kind`, `duration_minutes`, `capacity`, `booking_open_minutes_before`, `booking_close_minutes_before`, `cancellation_deadline_minutes`, `timezone`, `booking_policy`, `requires_ticket`, `is_active`, `created_at`, `updated_at`)
SELECT `id`, `organization_id`, `organization_id`, `name`, `description`, `image_url`, `kind`, `duration_minutes`, `capacity`, `booking_open_minutes_before`, `booking_close_minutes_before`, `cancellation_deadline_minutes`, `timezone`, `booking_policy`, `requires_ticket`, `is_active`, `created_at`, `updated_at`
FROM `service`;
--> statement-breakpoint
DROP TABLE `service`;
--> statement-breakpoint
ALTER TABLE `__new_service` RENAME TO `service`;
--> statement-breakpoint
CREATE INDEX `service_organization_active_idx` ON `service` (`organization_id`,`is_active`);
--> statement-breakpoint
CREATE INDEX `service_organization_kind_idx` ON `service` (`organization_id`,`kind`);
--> statement-breakpoint
CREATE TABLE `__new_recurring_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`service_id` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Tokyo' NOT NULL,
	`frequency` text NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`by_weekday_json` text,
	`by_monthday` integer,
	`start_date` text NOT NULL,
	`end_date` text,
	`start_time_local` text NOT NULL,
	`duration_minutes` integer,
	`capacity_override` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`last_generated_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `service`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_recurring_schedule` (`id`, `organization_id`, `classroom_id`, `service_id`, `timezone`, `frequency`, `interval`, `by_weekday_json`, `by_monthday`, `start_date`, `end_date`, `start_time_local`, `duration_minutes`, `capacity_override`, `is_active`, `last_generated_at`, `created_at`, `updated_at`)
SELECT `id`, `organization_id`, `organization_id`, `service_id`, `timezone`, `frequency`, `interval`, `by_weekday_json`, `by_monthday`, `start_date`, `end_date`, `start_time_local`, `duration_minutes`, `capacity_override`, `is_active`, `last_generated_at`, `created_at`, `updated_at`
FROM `recurring_schedule`;
--> statement-breakpoint
DROP TABLE `recurring_schedule`;
--> statement-breakpoint
ALTER TABLE `__new_recurring_schedule` RENAME TO `recurring_schedule`;
--> statement-breakpoint
CREATE INDEX `recurring_schedule_org_service_active_idx` ON `recurring_schedule` (`organization_id`,`service_id`,`is_active`);
--> statement-breakpoint
CREATE TABLE `__new_recurring_schedule_exception` (
	`id` text PRIMARY KEY NOT NULL,
	`recurring_schedule_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`date` text NOT NULL,
	`action` text NOT NULL,
	`override_start_time_local` text,
	`override_duration_minutes` integer,
	`override_capacity` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`recurring_schedule_id`) REFERENCES `recurring_schedule`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_recurring_schedule_exception` (`id`, `recurring_schedule_id`, `organization_id`, `classroom_id`, `date`, `action`, `override_start_time_local`, `override_duration_minutes`, `override_capacity`, `created_at`, `updated_at`)
SELECT `id`, `recurring_schedule_id`, `organization_id`, `organization_id`, `date`, `action`, `override_start_time_local`, `override_duration_minutes`, `override_capacity`, `created_at`, `updated_at`
FROM `recurring_schedule_exception`;
--> statement-breakpoint
DROP TABLE `recurring_schedule_exception`;
--> statement-breakpoint
ALTER TABLE `__new_recurring_schedule_exception` RENAME TO `recurring_schedule_exception`;
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_schedule_exception_unique_date_uidx` ON `recurring_schedule_exception` (`recurring_schedule_id`,`date`);
--> statement-breakpoint
CREATE INDEX `recurring_schedule_exception_org_date_idx` ON `recurring_schedule_exception` (`organization_id`,`date`);
--> statement-breakpoint
CREATE TABLE `__new_slot` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`service_id` text NOT NULL,
	`recurring_schedule_id` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`capacity` integer NOT NULL,
	`reserved_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`staff_label` text,
	`location_label` text,
	`booking_open_at` integer NOT NULL,
	`booking_close_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `service`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recurring_schedule_id`) REFERENCES `recurring_schedule`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_slot` (`id`, `organization_id`, `classroom_id`, `service_id`, `recurring_schedule_id`, `start_at`, `end_at`, `capacity`, `reserved_count`, `status`, `staff_label`, `location_label`, `booking_open_at`, `booking_close_at`, `created_at`, `updated_at`)
SELECT `id`, `organization_id`, `organization_id`, `service_id`, `recurring_schedule_id`, `start_at`, `end_at`, `capacity`, `reserved_count`, `status`, `staff_label`, `location_label`, `booking_open_at`, `booking_close_at`, `created_at`, `updated_at`
FROM `slot`;
--> statement-breakpoint
DROP TABLE `slot`;
--> statement-breakpoint
ALTER TABLE `__new_slot` RENAME TO `slot`;
--> statement-breakpoint
CREATE UNIQUE INDEX `slot_recurring_start_uidx` ON `slot` (`organization_id`,`recurring_schedule_id`,`start_at`);
--> statement-breakpoint
CREATE INDEX `slot_organization_start_status_idx` ON `slot` (`organization_id`,`start_at`,`status`);
--> statement-breakpoint
CREATE INDEX `slot_organization_service_start_idx` ON `slot` (`organization_id`,`service_id`,`start_at`);
--> statement-breakpoint
CREATE TABLE `__new_ticket_type` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`name` text NOT NULL,
	`service_ids_json` text,
	`total_count` integer NOT NULL,
	`expires_in_days` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`is_for_sale` integer DEFAULT false NOT NULL,
	`stripe_price_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_ticket_type` (`id`, `organization_id`, `classroom_id`, `name`, `service_ids_json`, `total_count`, `expires_in_days`, `is_active`, `is_for_sale`, `stripe_price_id`, `created_at`, `updated_at`)
SELECT `id`, `organization_id`, `organization_id`, `name`, `service_ids_json`, `total_count`, `expires_in_days`, `is_active`, `is_for_sale`, `stripe_price_id`, `created_at`, `updated_at`
FROM `ticket_type`;
--> statement-breakpoint
DROP TABLE `ticket_type`;
--> statement-breakpoint
ALTER TABLE `__new_ticket_type` RENAME TO `ticket_type`;
--> statement-breakpoint
CREATE INDEX `ticket_type_org_active_idx` ON `ticket_type` (`organization_id`,`is_active`);
--> statement-breakpoint
CREATE TABLE `__new_ticket_pack` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`ticket_type_id` text NOT NULL,
	`initial_count` integer NOT NULL,
	`remaining_count` integer NOT NULL,
	`expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_type`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_ticket_pack` (`id`, `organization_id`, `classroom_id`, `participant_id`, `ticket_type_id`, `initial_count`, `remaining_count`, `expires_at`, `status`, `created_at`, `updated_at`)
SELECT `id`, `organization_id`, `organization_id`, `participant_id`, `ticket_type_id`, `initial_count`, `remaining_count`, `expires_at`, `status`, `created_at`, `updated_at`
FROM `ticket_pack`;
--> statement-breakpoint
DROP TABLE `ticket_pack`;
--> statement-breakpoint
ALTER TABLE `__new_ticket_pack` RENAME TO `ticket_pack`;
--> statement-breakpoint
CREATE INDEX `ticket_pack_org_participant_status_idx` ON `ticket_pack` (`organization_id`,`participant_id`,`status`);
--> statement-breakpoint
CREATE INDEX `ticket_pack_org_expires_idx` ON `ticket_pack` (`organization_id`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `__new_booking` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`service_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`participants_count` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`cancel_reason` text,
	`cancelled_at` integer,
	`cancelled_by_user_id` text,
	`no_show_marked_at` integer,
	`ticket_pack_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `slot`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `service`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ticket_pack_id`) REFERENCES `ticket_pack`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_booking` (`id`, `organization_id`, `classroom_id`, `slot_id`, `service_id`, `participant_id`, `participants_count`, `status`, `cancel_reason`, `cancelled_at`, `cancelled_by_user_id`, `no_show_marked_at`, `ticket_pack_id`, `created_at`, `updated_at`)
SELECT `id`, `organization_id`, `organization_id`, `slot_id`, `service_id`, `participant_id`, `participants_count`, `status`, `cancel_reason`, `cancelled_at`, `cancelled_by_user_id`, `no_show_marked_at`, `ticket_pack_id`, `created_at`, `updated_at`
FROM `booking`;
--> statement-breakpoint
DROP TABLE `booking`;
--> statement-breakpoint
ALTER TABLE `__new_booking` RENAME TO `booking`;
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_slot_participant_uidx` ON `booking` (`slot_id`,`participant_id`);
--> statement-breakpoint
CREATE INDEX `booking_org_participant_created_idx` ON `booking` (`organization_id`,`participant_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `booking_org_service_created_idx` ON `booking` (`organization_id`,`service_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `booking_org_status_created_idx` ON `booking` (`organization_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE `__new_ticket_purchase` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`ticket_type_id` text NOT NULL,
	`payment_method` text NOT NULL,
	`status` text NOT NULL,
	`ticket_pack_id` text,
	`stripe_checkout_session_id` text,
	`approved_by_user_id` text,
	`approved_at` integer,
	`rejected_by_user_id` text,
	`rejected_at` integer,
	`reject_reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_type`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_pack_id`) REFERENCES `ticket_pack`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`rejected_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_ticket_purchase` (`id`, `organization_id`, `classroom_id`, `participant_id`, `ticket_type_id`, `payment_method`, `status`, `ticket_pack_id`, `stripe_checkout_session_id`, `approved_by_user_id`, `approved_at`, `rejected_by_user_id`, `rejected_at`, `reject_reason`, `created_at`, `updated_at`)
SELECT `id`, `organization_id`, `organization_id`, `participant_id`, `ticket_type_id`, `payment_method`, `status`, `ticket_pack_id`, `stripe_checkout_session_id`, `approved_by_user_id`, `approved_at`, `rejected_by_user_id`, `rejected_at`, `reject_reason`, `created_at`, `updated_at`
FROM `ticket_purchase`;
--> statement-breakpoint
DROP TABLE `ticket_purchase`;
--> statement-breakpoint
ALTER TABLE `__new_ticket_purchase` RENAME TO `ticket_purchase`;
--> statement-breakpoint
CREATE INDEX `ticket_purchase_org_status_created_idx` ON `ticket_purchase` (`organization_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `ticket_purchase_org_participant_created_idx` ON `ticket_purchase` (`organization_id`,`participant_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_purchase_stripe_checkout_session_uidx` ON `ticket_purchase` (`stripe_checkout_session_id`);
--> statement-breakpoint
CREATE TABLE `__new_ticket_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`ticket_pack_id` text NOT NULL,
	`booking_id` text,
	`action` text NOT NULL,
	`delta` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`actor_user_id` text NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_pack_id`) REFERENCES `ticket_pack`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_ticket_ledger` (`id`, `organization_id`, `classroom_id`, `ticket_pack_id`, `booking_id`, `action`, `delta`, `balance_after`, `actor_user_id`, `reason`, `created_at`)
SELECT `id`, `organization_id`, `organization_id`, `ticket_pack_id`, `booking_id`, `action`, `delta`, `balance_after`, `actor_user_id`, `reason`, `created_at`
FROM `ticket_ledger`;
--> statement-breakpoint
DROP TABLE `ticket_ledger`;
--> statement-breakpoint
ALTER TABLE `__new_ticket_ledger` RENAME TO `ticket_ledger`;
--> statement-breakpoint
CREATE INDEX `ticket_ledger_pack_created_idx` ON `ticket_ledger` (`ticket_pack_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `ticket_ledger_org_created_idx` ON `ticket_ledger` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `__new_booking_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`metadata` text,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_booking_audit_log` (`id`, `booking_id`, `organization_id`, `classroom_id`, `actor_user_id`, `action`, `metadata`, `ip_address`, `user_agent`, `created_at`)
SELECT `id`, `booking_id`, `organization_id`, `organization_id`, `actor_user_id`, `action`, `metadata`, `ip_address`, `user_agent`, `created_at`
FROM `booking_audit_log`;
--> statement-breakpoint
DROP TABLE `booking_audit_log`;
--> statement-breakpoint
ALTER TABLE `__new_booking_audit_log` RENAME TO `booking_audit_log`;
--> statement-breakpoint
CREATE INDEX `booking_audit_log_booking_action_idx` ON `booking_audit_log` (`booking_id`,`action`);
--> statement-breakpoint
CREATE INDEX `booking_audit_log_org_created_idx` ON `booking_audit_log` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `classroom_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`email` text NOT NULL,
	`participant_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`responded_by_user_id` text,
	`responded_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`responded_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `classroom_invitation` (`id`, `organization_id`, `classroom_id`, `email`, `participant_name`, `status`, `expires_at`, `created_at`, `invited_by_user_id`, `responded_by_user_id`, `responded_at`)
SELECT `id`, `organization_id`, `organization_id`, `email`, `participant_name`, `status`, `expires_at`, `created_at`, `invited_by_user_id`, `responded_by_user_id`, `responded_at`
FROM `participant_invitation`;
--> statement-breakpoint
CREATE INDEX `classroom_invitation_organization_status_created_idx` ON `classroom_invitation` (`organization_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `classroom_invitation_email_status_idx` ON `classroom_invitation` (`email`,`status`);
--> statement-breakpoint
CREATE INDEX `classroom_invitation_invited_by_created_idx` ON `classroom_invitation` (`invited_by_user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `classroom_invitation_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`classroom_invitation_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_email` text NOT NULL,
	`action` text NOT NULL,
	`metadata` text,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`classroom_invitation_id`) REFERENCES `classroom_invitation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `classroom_invitation_audit_log` (`id`, `classroom_invitation_id`, `organization_id`, `classroom_id`, `actor_user_id`, `target_email`, `action`, `metadata`, `ip_address`, `user_agent`, `created_at`)
SELECT `id`, `participant_invitation_id`, `organization_id`, `organization_id`, `actor_user_id`, `target_email`, `action`, `metadata`, `ip_address`, `user_agent`, `created_at`
FROM `participant_invitation_audit_log`;
--> statement-breakpoint
CREATE INDEX `classroom_invitation_audit_log_invitation_action_idx` ON `classroom_invitation_audit_log` (`classroom_invitation_id`,`action`);
--> statement-breakpoint
CREATE INDEX `classroom_invitation_audit_log_organization_created_idx` ON `classroom_invitation_audit_log` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `classroom_invitation_audit_log_actor_created_idx` ON `classroom_invitation_audit_log` (`actor_user_id`,`created_at`);
--> statement-breakpoint
DROP TABLE `participant_invitation_audit_log`;
--> statement-breakpoint
DROP TABLE `participant_invitation`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
