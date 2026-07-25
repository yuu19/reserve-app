CREATE TABLE `billing_addon_mutation_audit` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `billing_account_id` text NOT NULL,
  `billing_subscription_id` text,
  `idempotency_key` text NOT NULL,
  `outcome` text NOT NULL,
  `actor_type` text NOT NULL,
  `actor_id` text,
  `actor_email` text,
  `requested_items_json` text NOT NULL,
  `previous_items_json` text NOT NULL,
  `result_items_json` text,
  `effective_at` integer,
  `failure_code` text,
  `failure_message` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`billing_subscription_id`) REFERENCES `billing_subscription`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_addon_mutation_audit_idempotency_uidx` ON `billing_addon_mutation_audit` (`app_id`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `billing_addon_mutation_audit_account_created_idx` ON `billing_addon_mutation_audit` (`billing_account_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `billing_addon_mutation_audit_subscription_created_idx` ON `billing_addon_mutation_audit` (`billing_subscription_id`,`created_at`);
