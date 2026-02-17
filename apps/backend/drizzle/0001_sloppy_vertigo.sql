CREATE TABLE `invitation_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`invitation_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_email` text NOT NULL,
	`action` text NOT NULL,
	`metadata` text,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`invitation_id`) REFERENCES `invitation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_audit_log_invitation_action_idx` ON `invitation_audit_log` (`invitation_id`,`action`);--> statement-breakpoint
CREATE INDEX `invitation_audit_log_organization_created_idx` ON `invitation_audit_log` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `invitation_audit_log_actor_created_idx` ON `invitation_audit_log` (`actor_user_id`,`created_at`);