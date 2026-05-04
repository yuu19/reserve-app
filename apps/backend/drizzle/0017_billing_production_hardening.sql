ALTER TABLE `organization_billing` ADD `payment_issue_started_at` integer;
--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `past_due_grace_ends_at` integer;
--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `billing_profile_readiness` text DEFAULT 'not_required' NOT NULL;
--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `billing_profile_next_action` text;
--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `billing_profile_checked_at` integer;
--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `last_reconciled_at` integer;
--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `last_reconciliation_reason` text;
--> statement-breakpoint
ALTER TABLE `stripe_webhook_event` ADD `signature_verification_status` text DEFAULT 'verified' NOT NULL;
--> statement-breakpoint
ALTER TABLE `stripe_webhook_event` ADD `duplicate_detected` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `stripe_webhook_event` ADD `duplicate_detected_at` integer;
--> statement-breakpoint
ALTER TABLE `stripe_webhook_event` ADD `receipt_status` text DEFAULT 'accepted' NOT NULL;
--> statement-breakpoint
CREATE TABLE `organization_billing_operation_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`purpose` text NOT NULL,
	`billing_interval` text,
	`state` text DEFAULT 'processing' NOT NULL,
	`handoff_url` text,
	`handoff_expires_at` integer,
	`provider` text DEFAULT 'stripe' NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`stripe_checkout_session_id` text,
	`stripe_portal_session_id` text,
	`idempotency_key` text NOT NULL,
	`failure_reason` text,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `organization_billing_operation_attempt_org_idx` ON `organization_billing_operation_attempt` (`organization_id`,`purpose`,`billing_interval`,`state`);
--> statement-breakpoint
CREATE INDEX `organization_billing_operation_attempt_handoff_idx` ON `organization_billing_operation_attempt` (`organization_id`,`purpose`,`handoff_expires_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_operation_attempt_idempotency_uidx` ON `organization_billing_operation_attempt` (`idempotency_key`);
--> statement-breakpoint
CREATE TABLE `organization_billing_invoice_event` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`stripe_event_id` text,
	`event_type` text NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`stripe_invoice_id` text,
	`stripe_payment_intent_id` text,
	`provider_status` text,
	`owner_facing_status` text NOT NULL,
	`occurred_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `organization_billing_invoice_event_org_idx` ON `organization_billing_invoice_event` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_invoice_event_provider_uidx` ON `organization_billing_invoice_event` (`stripe_event_id`,`event_type`);
--> statement-breakpoint
CREATE TABLE `organization_billing_document_reference` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`invoice_event_id` text,
	`document_kind` text NOT NULL,
	`provider_document_id` text NOT NULL,
	`hosted_invoice_url` text,
	`invoice_pdf_url` text,
	`receipt_url` text,
	`availability` text NOT NULL,
	`owner_facing_status` text NOT NULL,
	`provider_derived` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invoice_event_id`) REFERENCES `organization_billing_invoice_event`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `organization_billing_document_reference_org_idx` ON `organization_billing_document_reference` (`organization_id`,`document_kind`,`availability`);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_document_reference_provider_uidx` ON `organization_billing_document_reference` (`organization_id`,`document_kind`,`provider_document_id`);
--> statement-breakpoint
UPDATE `organization_billing`
SET
	`payment_issue_started_at` = coalesce(`payment_issue_started_at`, `updated_at`),
	`past_due_grace_ends_at` = coalesce(`past_due_grace_ends_at`, `updated_at` + 604800000)
WHERE `subscription_status` = 'past_due';
