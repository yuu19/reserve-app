CREATE TABLE `organization_billing_audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`source_kind` text NOT NULL,
	`stripe_event_id` text,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`source_context` text,
	`previous_plan_code` text NOT NULL,
	`next_plan_code` text NOT NULL,
	`previous_plan_state` text NOT NULL,
	`next_plan_state` text NOT NULL,
	`previous_subscription_status` text NOT NULL,
	`next_subscription_status` text NOT NULL,
	`previous_payment_method_status` text NOT NULL,
	`next_payment_method_status` text NOT NULL,
	`previous_entitlement_state` text NOT NULL,
	`next_entitlement_state` text NOT NULL,
	`previous_billing_interval` text,
	`next_billing_interval` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `organization_billing_audit_event_org_idx` ON `organization_billing_audit_event` (`organization_id`,`sequence_number`);
--> statement-breakpoint
CREATE INDEX `organization_billing_audit_event_event_idx` ON `organization_billing_audit_event` (`stripe_event_id`);
--> statement-breakpoint
CREATE TABLE `organization_billing_signal` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`sequence_number` integer NOT NULL,
	`signal_kind` text NOT NULL,
	`signal_status` text NOT NULL,
	`source_kind` text NOT NULL,
	`reason` text NOT NULL,
	`stripe_event_id` text,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`provider_plan_state` text,
	`provider_subscription_status` text,
	`app_plan_state` text NOT NULL,
	`app_subscription_status` text NOT NULL,
	`app_payment_method_status` text NOT NULL,
	`app_entitlement_state` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `organization_billing_signal_org_idx` ON `organization_billing_signal` (`organization_id`,`sequence_number`);
--> statement-breakpoint
CREATE INDEX `organization_billing_signal_event_idx` ON `organization_billing_signal` (`stripe_event_id`);
--> statement-breakpoint
CREATE INDEX `organization_billing_signal_kind_idx` ON `organization_billing_signal` (`signal_kind`,`signal_status`);
