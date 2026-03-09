PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_kind` text NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`principal_kind` text NOT NULL,
	`participant_name` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`responded_by_user_id` text,
	`responded_at` integer,
	`accepted_member_id` text,
	`accepted_classroom_member_id` text,
	`accepted_participant_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`responded_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_classroom_member_id`) REFERENCES `classroom_member`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_invitation` (
	`id`,
	`subject_kind`,
	`organization_id`,
	`classroom_id`,
	`email`,
	`role`,
	`principal_kind`,
	`participant_name`,
	`status`,
	`responded_by_user_id`,
	`responded_at`,
	`accepted_member_id`,
	`accepted_classroom_member_id`,
	`accepted_participant_id`,
	`expires_at`,
	`created_at`,
	`updated_at`,
	`inviter_id`
)
SELECT
	`id`,
	CASE
		WHEN `classroom_id` IS NULL THEN 'org_operator'
		ELSE 'classroom_operator'
	END,
	`organization_id`,
	`classroom_id`,
	`email`,
	CASE
		WHEN `classroom_id` IS NULL AND `role` = 'admin' THEN 'admin'
		WHEN `classroom_id` IS NULL THEN 'member'
		WHEN `classroom_role` = 'manager' THEN 'manager'
		WHEN `classroom_role` = 'staff' THEN 'staff'
		WHEN `classroom_role` = 'admin' THEN 'manager'
		WHEN `classroom_role` = 'member' THEN 'staff'
		WHEN `role` = 'admin' THEN 'manager'
		ELSE 'staff'
	END,
	CASE
		WHEN EXISTS(
			SELECT 1
			FROM `user`
			WHERE lower(`user`.`email`) = lower(`invitation`.`email`)
		) THEN 'existing_user'
		ELSE 'email'
	END,
	NULL,
	CASE
		WHEN `status` = 'canceled' THEN 'cancelled'
		ELSE `status`
	END,
	NULL,
	NULL,
	NULL,
	NULL,
	NULL,
	`expires_at`,
	`created_at`,
	`created_at`,
	`inviter_id`
FROM `invitation`;
--> statement-breakpoint
INSERT INTO `__new_invitation` (
	`id`,
	`subject_kind`,
	`organization_id`,
	`classroom_id`,
	`email`,
	`role`,
	`principal_kind`,
	`participant_name`,
	`status`,
	`responded_by_user_id`,
	`responded_at`,
	`accepted_member_id`,
	`accepted_classroom_member_id`,
	`accepted_participant_id`,
	`expires_at`,
	`created_at`,
	`updated_at`,
	`inviter_id`
)
SELECT
	`id`,
	'participant',
	`organization_id`,
	`classroom_id`,
	`email`,
	'participant',
	CASE
		WHEN EXISTS(
			SELECT 1
			FROM `user`
			WHERE lower(`user`.`email`) = lower(`classroom_invitation`.`email`)
		) THEN 'existing_user'
		ELSE 'email'
	END,
	`participant_name`,
	CASE
		WHEN `status` = 'canceled' THEN 'cancelled'
		ELSE `status`
	END,
	`responded_by_user_id`,
	`responded_at`,
	NULL,
	NULL,
	NULL,
	`expires_at`,
	`created_at`,
	COALESCE(`responded_at`, `created_at`),
	`invited_by_user_id`
FROM `classroom_invitation`;
--> statement-breakpoint
CREATE TABLE `__new_invitation_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`invitation_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text,
	`actor_user_id` text NOT NULL,
	`target_email` text NOT NULL,
	`action` text NOT NULL,
	`metadata` text,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`invitation_id`) REFERENCES `__new_invitation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_invitation_audit_log` (
	`id`,
	`invitation_id`,
	`organization_id`,
	`classroom_id`,
	`actor_user_id`,
	`target_email`,
	`action`,
	`metadata`,
	`ip_address`,
	`user_agent`,
	`created_at`
)
SELECT
	`invitation_audit_log`.`id`,
	`invitation_audit_log`.`invitation_id`,
	`invitation_audit_log`.`organization_id`,
	`invitation`.`classroom_id`,
	`invitation_audit_log`.`actor_user_id`,
	`invitation_audit_log`.`target_email`,
	CASE
		WHEN `invitation_audit_log`.`action` = 'invitation.created' THEN 'created'
		WHEN `invitation_audit_log`.`action` = 'invitation.resent' THEN 'resent'
		WHEN `invitation_audit_log`.`action` = 'invitation.accepted' THEN 'accepted'
		WHEN `invitation_audit_log`.`action` = 'invitation.rejected' THEN 'rejected'
		WHEN `invitation_audit_log`.`action` = 'invitation.canceled' THEN 'cancelled'
		ELSE `invitation_audit_log`.`action`
	END,
	`invitation_audit_log`.`metadata`,
	`invitation_audit_log`.`ip_address`,
	`invitation_audit_log`.`user_agent`,
	`invitation_audit_log`.`created_at`
FROM `invitation_audit_log`
LEFT JOIN `invitation` ON `invitation`.`id` = `invitation_audit_log`.`invitation_id`;
--> statement-breakpoint
INSERT INTO `__new_invitation_audit_log` (
	`id`,
	`invitation_id`,
	`organization_id`,
	`classroom_id`,
	`actor_user_id`,
	`target_email`,
	`action`,
	`metadata`,
	`ip_address`,
	`user_agent`,
	`created_at`
)
SELECT
	`id`,
	`classroom_invitation_id`,
	`organization_id`,
	`classroom_id`,
	`actor_user_id`,
	`target_email`,
	CASE
		WHEN `action` = 'participant-invitation.created' THEN 'created'
		WHEN `action` = 'participant-invitation.resent' THEN 'resent'
		WHEN `action` = 'participant-invitation.accepted' THEN 'accepted'
		WHEN `action` = 'participant-invitation.rejected' THEN 'rejected'
		WHEN `action` = 'participant-invitation.canceled' THEN 'cancelled'
		ELSE `action`
	END,
	`metadata`,
	`ip_address`,
	`user_agent`,
	`created_at`
FROM `classroom_invitation_audit_log`;
--> statement-breakpoint
DROP TABLE IF EXISTS `invitation_audit_log`;
--> statement-breakpoint
DROP TABLE IF EXISTS `classroom_invitation_audit_log`;
--> statement-breakpoint
DROP TABLE IF EXISTS `invitation`;
--> statement-breakpoint
DROP TABLE IF EXISTS `classroom_invitation`;
--> statement-breakpoint
ALTER TABLE `__new_invitation` RENAME TO `invitation`;
--> statement-breakpoint
ALTER TABLE `__new_invitation_audit_log` RENAME TO `invitation_audit_log`;
--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);
--> statement-breakpoint
CREATE INDEX `invitation_subject_kind_status_idx` ON `invitation` (`subject_kind`,`status`);
--> statement-breakpoint
CREATE INDEX `invitation_organization_classroom_status_idx` ON `invitation` (`organization_id`,`classroom_id`,`status`);
--> statement-breakpoint
CREATE INDEX `invitation_organization_subject_role_status_idx` ON `invitation` (`organization_id`,`subject_kind`,`role`,`status`);
--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);
--> statement-breakpoint
CREATE INDEX `invitation_audit_log_invitation_action_idx` ON `invitation_audit_log` (`invitation_id`,`action`);
--> statement-breakpoint
CREATE INDEX `invitation_audit_log_organization_created_idx` ON `invitation_audit_log` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `invitation_audit_log_actor_created_idx` ON `invitation_audit_log` (`actor_user_id`,`created_at`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
