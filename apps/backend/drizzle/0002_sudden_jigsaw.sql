CREATE TABLE `participant` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participant_organization_created_idx` ON `participant` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `participant_organization_user_uidx` ON `participant` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `participant_organization_email_uidx` ON `participant` (`organization_id`,`email`);--> statement-breakpoint
CREATE TABLE `participant_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`participant_name` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`responded_by_user_id` text,
	`responded_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`responded_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `participant_invitation_organization_status_created_idx` ON `participant_invitation` (`organization_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `participant_invitation_email_status_idx` ON `participant_invitation` (`email`,`status`);--> statement-breakpoint
CREATE INDEX `participant_invitation_invited_by_created_idx` ON `participant_invitation` (`invited_by_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `participant_invitation_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_invitation_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_email` text NOT NULL,
	`action` text NOT NULL,
	`metadata` text,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`participant_invitation_id`) REFERENCES `participant_invitation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participant_invitation_audit_log_invitation_action_idx` ON `participant_invitation_audit_log` (`participant_invitation_id`,`action`);--> statement-breakpoint
CREATE INDEX `participant_invitation_audit_log_organization_created_idx` ON `participant_invitation_audit_log` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `participant_invitation_audit_log_actor_created_idx` ON `participant_invitation_audit_log` (`actor_user_id`,`created_at`);