CREATE TABLE `booking` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
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
	FOREIGN KEY (`slot_id`) REFERENCES `slot`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `service`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ticket_pack_id`) REFERENCES `ticket_pack`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_slot_participant_uidx` ON `booking` (`slot_id`,`participant_id`);--> statement-breakpoint
CREATE INDEX `booking_org_participant_created_idx` ON `booking` (`organization_id`,`participant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `booking_org_service_created_idx` ON `booking` (`organization_id`,`service_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `booking_org_status_created_idx` ON `booking` (`organization_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `booking_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`metadata` text,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `booking_audit_log_booking_action_idx` ON `booking_audit_log` (`booking_id`,`action`);--> statement-breakpoint
CREATE INDEX `booking_audit_log_org_created_idx` ON `booking_audit_log` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `recurring_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
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
	FOREIGN KEY (`service_id`) REFERENCES `service`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recurring_schedule_org_service_active_idx` ON `recurring_schedule` (`organization_id`,`service_id`,`is_active`);--> statement-breakpoint
CREATE TABLE `recurring_schedule_exception` (
	`id` text PRIMARY KEY NOT NULL,
	`recurring_schedule_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`date` text NOT NULL,
	`action` text NOT NULL,
	`override_start_time_local` text,
	`override_duration_minutes` integer,
	`override_capacity` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`recurring_schedule_id`) REFERENCES `recurring_schedule`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_schedule_exception_unique_date_uidx` ON `recurring_schedule_exception` (`recurring_schedule_id`,`date`);--> statement-breakpoint
CREATE INDEX `recurring_schedule_exception_org_date_idx` ON `recurring_schedule_exception` (`organization_id`,`date`);--> statement-breakpoint
CREATE TABLE `service` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`capacity` integer NOT NULL,
	`booking_open_minutes_before` integer,
	`booking_close_minutes_before` integer,
	`cancellation_deadline_minutes` integer,
	`timezone` text DEFAULT 'Asia/Tokyo' NOT NULL,
	`requires_ticket` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `service_organization_active_idx` ON `service` (`organization_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `service_organization_kind_idx` ON `service` (`organization_id`,`kind`);--> statement-breakpoint
CREATE TABLE `slot` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
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
	FOREIGN KEY (`service_id`) REFERENCES `service`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recurring_schedule_id`) REFERENCES `recurring_schedule`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slot_recurring_start_uidx` ON `slot` (`organization_id`,`recurring_schedule_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `slot_organization_start_status_idx` ON `slot` (`organization_id`,`start_at`,`status`);--> statement-breakpoint
CREATE INDEX `slot_organization_service_start_idx` ON `slot` (`organization_id`,`service_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `ticket_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`ticket_pack_id` text NOT NULL,
	`booking_id` text,
	`action` text NOT NULL,
	`delta` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`actor_user_id` text NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_pack_id`) REFERENCES `ticket_pack`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`booking_id`) REFERENCES `booking`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ticket_ledger_pack_created_idx` ON `ticket_ledger` (`ticket_pack_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ticket_ledger_org_created_idx` ON `ticket_ledger` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ticket_pack` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`ticket_type_id` text NOT NULL,
	`initial_count` integer NOT NULL,
	`remaining_count` integer NOT NULL,
	`expires_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_type`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ticket_pack_org_participant_status_idx` ON `ticket_pack` (`organization_id`,`participant_id`,`status`);--> statement-breakpoint
CREATE INDEX `ticket_pack_org_expires_idx` ON `ticket_pack` (`organization_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `ticket_type` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`service_ids_json` text,
	`total_count` integer NOT NULL,
	`expires_in_days` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ticket_type_org_active_idx` ON `ticket_type` (`organization_id`,`is_active`);