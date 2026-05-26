PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_billing_operation_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_account_id` text NOT NULL,
	`purpose` text NOT NULL,
	`reuse_key` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`state` text NOT NULL,
	`handoff_url` text,
	`handoff_expires_at` integer,
	`provider` text NOT NULL,
	`provider_customer_id` text,
	`provider_subscription_id` text,
	`provider_checkout_session_id` text,
	`provider_portal_session_id` text,
	`failure_reason` text,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_billing_operation_attempt` (
	`id`,
	`billing_account_id`,
	`purpose`,
	`reuse_key`,
	`attempt_number`,
	`idempotency_key`,
	`state`,
	`handoff_url`,
	`handoff_expires_at`,
	`provider`,
	`provider_customer_id`,
	`provider_subscription_id`,
	`provider_checkout_session_id`,
	`provider_portal_session_id`,
	`failure_reason`,
	`created_by_user_id`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`billing_account_id`,
	`purpose`,
	`reuse_key`,
	`attempt_number`,
	`idempotency_key`,
	`state`,
	`handoff_url`,
	`handoff_expires_at`,
	`provider`,
	`provider_customer_id`,
	`provider_subscription_id`,
	`provider_checkout_session_id`,
	`provider_portal_session_id`,
	`failure_reason`,
	`created_by_user_id`,
	`created_at`,
	`updated_at`
FROM `billing_operation_attempt`;
--> statement-breakpoint
DROP TABLE `billing_operation_attempt`;
--> statement-breakpoint
ALTER TABLE `__new_billing_operation_attempt` RENAME TO `billing_operation_attempt`;
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_operation_attempt_idempotency_uidx` ON `billing_operation_attempt` (`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_operation_attempt_reuse_attempt_uidx` ON `billing_operation_attempt` (`billing_account_id`, `reuse_key`, `attempt_number`);
--> statement-breakpoint
CREATE INDEX `billing_operation_attempt_reuse_state_idx` ON `billing_operation_attempt` (`billing_account_id`, `reuse_key`, `state`);
--> statement-breakpoint
CREATE INDEX `billing_operation_attempt_handoff_expiry_idx` ON `billing_operation_attempt` (`handoff_expires_at`);
--> statement-breakpoint
CREATE TABLE `__new_billing_audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_account_id` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`source_kind` text NOT NULL,
	`source_context` text,
	`actor_user_id` text,
	`previous_snapshot_json` text,
	`next_snapshot_json` text,
	`provider` text,
	`provider_event_id` text,
	`provider_customer_id` text,
	`provider_subscription_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_billing_audit_event` (
	`id`,
	`billing_account_id`,
	`sequence_number`,
	`source_kind`,
	`source_context`,
	`actor_user_id`,
	`previous_snapshot_json`,
	`next_snapshot_json`,
	`provider`,
	`provider_event_id`,
	`provider_customer_id`,
	`provider_subscription_id`,
	`created_at`
)
SELECT
	`id`,
	`billing_account_id`,
	`sequence_number`,
	`source_kind`,
	`source_context`,
	`actor_user_id`,
	`previous_snapshot_json`,
	`next_snapshot_json`,
	`provider`,
	`provider_event_id`,
	`provider_customer_id`,
	`provider_subscription_id`,
	`created_at`
FROM `billing_audit_event`;
--> statement-breakpoint
DROP TABLE `billing_audit_event`;
--> statement-breakpoint
ALTER TABLE `__new_billing_audit_event` RENAME TO `billing_audit_event`;
--> statement-breakpoint
CREATE INDEX `billing_audit_event_account_created_idx` ON `billing_audit_event` (`billing_account_id`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_audit_event_account_sequence_uidx` ON `billing_audit_event` (`billing_account_id`, `sequence_number`);
--> statement-breakpoint
CREATE TABLE `__new_billing_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_account_id` text NOT NULL,
	`notification_kind` text NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`sequence_number` integer NOT NULL,
	`recipient_user_id` text,
	`recipient_email` text NOT NULL,
	`delivery_status` text NOT NULL,
	`attempt_number` integer DEFAULT 1 NOT NULL,
	`provider_message_id` text,
	`failure_reason` text,
	`provider` text,
	`provider_event_id` text,
	`provider_customer_id` text,
	`provider_subscription_id` text,
	`provider_invoice_id` text,
	`plan_state` text,
	`subscription_status` text,
	`payment_method_status` text,
	`trial_ends_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`sent_at` integer,
	`failed_at` integer,
	FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_billing_notification` (
	`id`,
	`billing_account_id`,
	`notification_kind`,
	`channel`,
	`sequence_number`,
	`recipient_user_id`,
	`recipient_email`,
	`delivery_status`,
	`attempt_number`,
	`provider_message_id`,
	`failure_reason`,
	`provider`,
	`provider_event_id`,
	`provider_customer_id`,
	`provider_subscription_id`,
	`provider_invoice_id`,
	`plan_state`,
	`subscription_status`,
	`payment_method_status`,
	`trial_ends_at`,
	`created_at`,
	`sent_at`,
	`failed_at`
)
SELECT
	`id`,
	`billing_account_id`,
	`notification_kind`,
	`channel`,
	`sequence_number`,
	`recipient_user_id`,
	`recipient_email`,
	`delivery_status`,
	`attempt_number`,
	`provider_message_id`,
	`failure_reason`,
	`provider`,
	`provider_event_id`,
	`provider_customer_id`,
	`provider_subscription_id`,
	`provider_invoice_id`,
	`plan_state`,
	`subscription_status`,
	`payment_method_status`,
	`trial_ends_at`,
	`created_at`,
	`sent_at`,
	`failed_at`
FROM `billing_notification`;
--> statement-breakpoint
DROP TABLE `billing_notification`;
--> statement-breakpoint
ALTER TABLE `__new_billing_notification` RENAME TO `billing_notification`;
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_notification_dedupe_uidx` ON `billing_notification` (`billing_account_id`, `notification_kind`, `recipient_email`, `provider_event_id`, `attempt_number`, `delivery_status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_notification_account_sequence_uidx` ON `billing_notification` (`billing_account_id`, `sequence_number`);
--> statement-breakpoint
CREATE INDEX `billing_notification_retry_idx` ON `billing_notification` (`notification_kind`, `delivery_status`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
