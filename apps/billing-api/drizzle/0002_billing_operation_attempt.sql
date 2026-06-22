CREATE TABLE `billing_operation_attempt` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `billing_account_id` text NOT NULL,
  `purpose` text NOT NULL,
  `reuse_key` text NOT NULL,
  `attempt_number` integer NOT NULL,
  `idempotency_key` text NOT NULL,
  `state` text NOT NULL,
  `handoff_url` text,
  `handoff_expires_at` integer,
  `provider` text DEFAULT 'stripe' NOT NULL,
  `provider_customer_id` text,
  `provider_subscription_id` text,
  `provider_checkout_session_id` text,
  `provider_portal_session_id` text,
  `failure_reason` text,
  `actor_type` text,
  `actor_id` text,
  `actor_email` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `billing_operation_attempt_idempotency_uidx` ON `billing_operation_attempt` (`app_id`, `idempotency_key`);
CREATE UNIQUE INDEX `billing_operation_attempt_reuse_attempt_uidx` ON `billing_operation_attempt` (`app_id`, `billing_account_id`, `reuse_key`, `attempt_number`);
CREATE INDEX `billing_operation_attempt_reuse_state_idx` ON `billing_operation_attempt` (`app_id`, `billing_account_id`, `reuse_key`, `state`);
CREATE INDEX `billing_operation_attempt_handoff_expiry_idx` ON `billing_operation_attempt` (`handoff_expires_at`);
