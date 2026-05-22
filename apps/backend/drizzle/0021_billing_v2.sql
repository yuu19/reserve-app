CREATE TABLE `billing_account` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_customer_id` text,
	`billing_email` text,
	`billing_name` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_account_subject_uidx` ON `billing_account` (`subject_type`, `subject_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_account_provider_customer_uidx` ON `billing_account` (`provider`, `provider_customer_id`);
--> statement-breakpoint
CREATE TABLE `billing_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_account_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subscription_id` text,
	`provider_schedule_id` text,
	`plan_code` text NOT NULL,
	`price_code` text,
	`interval` text,
	`status` text NOT NULL,
	`current_period_start` integer,
	`current_period_end` integer,
	`trial_start` integer,
	`trial_end` integer,
	`cancel_at` integer,
	`cancel_at_period_end` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `billing_subscription_account_idx` ON `billing_subscription` (`billing_account_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscription_provider_subscription_uidx` ON `billing_subscription` (`provider`, `provider_subscription_id`);
--> statement-breakpoint
CREATE TABLE `billing_payment_issue` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_account_id` text NOT NULL,
	`billing_subscription_id` text,
	`state` text NOT NULL,
	`issue_started_at` integer,
	`issue_started_at_source` text NOT NULL,
	`past_due_grace_ends_at` integer,
	`latest_provider_event_id` text,
	`latest_invoice_id` text,
	`latest_payment_intent_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`billing_subscription_id`) REFERENCES `billing_subscription`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_payment_issue_account_uidx` ON `billing_payment_issue` (`billing_account_id`);
--> statement-breakpoint
CREATE INDEX `billing_payment_issue_state_idx` ON `billing_payment_issue` (`state`);
--> statement-breakpoint
CREATE TABLE `billing_payment_issue_event` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_account_id` text NOT NULL,
	`billing_subscription_id` text,
	`event_type` text NOT NULL,
	`provider` text NOT NULL,
	`provider_event_id` text,
	`provider_invoice_id` text,
	`provider_payment_intent_id` text,
	`occurred_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`billing_subscription_id`) REFERENCES `billing_subscription`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `billing_payment_issue_event_account_created_idx` ON `billing_payment_issue_event` (`billing_account_id`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_payment_issue_event_provider_uidx` ON `billing_payment_issue_event` (`provider`, `provider_event_id`, `event_type`);
--> statement-breakpoint
CREATE TABLE `billing_entitlement` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_account_id` text NOT NULL,
	`key` text NOT NULL,
	`active` integer NOT NULL,
	`source` text NOT NULL,
	`reason` text NOT NULL,
	`valid_from` integer,
	`valid_until` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_entitlement_account_key_uidx` ON `billing_entitlement` (`billing_account_id`, `key`);
--> statement-breakpoint
CREATE INDEX `billing_entitlement_key_active_idx` ON `billing_entitlement` (`key`, `active`);
--> statement-breakpoint
CREATE TABLE `billing_provider_event` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`scope` text NOT NULL,
	`payload_hash` text NOT NULL,
	`processing_status` text NOT NULL,
	`receipt_status` text NOT NULL,
	`duplicate_detected` integer DEFAULT 0 NOT NULL,
	`duplicate_detected_at` integer,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`processing_started_at` integer,
	`last_attempt_at` integer,
	`processing_stale_after_ms` integer NOT NULL,
	`failure_reason` text,
	`billing_account_id` text,
	`provider_customer_id` text,
	`provider_subscription_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_provider_event_uidx` ON `billing_provider_event` (`provider`, `provider_event_id`, `scope`);
--> statement-breakpoint
CREATE INDEX `billing_provider_event_processing_idx` ON `billing_provider_event` (`processing_status`, `processing_started_at`);
--> statement-breakpoint
CREATE TABLE `billing_operation_attempt` (
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
	FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_operation_attempt_idempotency_uidx` ON `billing_operation_attempt` (`idempotency_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_operation_attempt_reuse_attempt_uidx` ON `billing_operation_attempt` (`billing_account_id`, `reuse_key`, `attempt_number`);
--> statement-breakpoint
CREATE INDEX `billing_operation_attempt_reuse_state_idx` ON `billing_operation_attempt` (`billing_account_id`, `reuse_key`, `state`);
--> statement-breakpoint
CREATE INDEX `billing_operation_attempt_handoff_expiry_idx` ON `billing_operation_attempt` (`handoff_expires_at`);
--> statement-breakpoint
CREATE TABLE `billing_audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_account_id` text NOT NULL,
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
	FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `billing_audit_event_account_created_idx` ON `billing_audit_event` (`billing_account_id`, `created_at`);
--> statement-breakpoint
CREATE TABLE `billing_signal` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_account_id` text NOT NULL,
	`signal_kind` text NOT NULL,
	`signal_status` text NOT NULL,
	`source_kind` text NOT NULL,
	`reason` text NOT NULL,
	`app_snapshot_json` text,
	`provider` text,
	`provider_event_id` text,
	`provider_customer_id` text,
	`provider_subscription_id` text,
	`provider_plan_state` text,
	`provider_subscription_status` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `billing_signal_account_kind_status_idx` ON `billing_signal` (`billing_account_id`, `signal_kind`, `signal_status`);
--> statement-breakpoint
CREATE TABLE `billing_notification` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_account_id` text NOT NULL,
	`notification_kind` text NOT NULL,
	`recipient_user_id` text,
	`recipient_email` text NOT NULL,
	`delivery_status` text NOT NULL,
	`provider_message_id` text,
	`failure_reason` text,
	`provider` text,
	`provider_event_id` text,
	`provider_invoice_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`sent_at` integer,
	`failed_at` integer,
	FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_notification_dedupe_uidx` ON `billing_notification` (`billing_account_id`, `notification_kind`, `recipient_email`, `provider_event_id`);
--> statement-breakpoint
CREATE INDEX `billing_notification_retry_idx` ON `billing_notification` (`notification_kind`, `delivery_status`);
--> statement-breakpoint
CREATE TABLE `billing_document_reference` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_account_id` text NOT NULL,
	`document_kind` text NOT NULL,
	`provider` text NOT NULL,
	`provider_document_id` text NOT NULL,
	`hosted_invoice_url` text,
	`invoice_pdf_url` text,
	`receipt_url` text,
	`availability` text NOT NULL,
	`owner_facing_status` text NOT NULL,
	`provider_derived` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_document_reference_provider_uidx` ON `billing_document_reference` (`provider`, `provider_document_id`, `document_kind`);
--> statement-breakpoint
CREATE INDEX `billing_document_reference_account_idx` ON `billing_document_reference` (`billing_account_id`);
