CREATE TABLE `billing_app` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);

CREATE TABLE `billing_app_credential` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `key_prefix` text NOT NULL,
  `key_hash` text NOT NULL,
  `scopes_json` text NOT NULL,
  `revoked_at` integer,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `billing_app_credential_hash_uidx` ON `billing_app_credential` (`key_hash`);
CREATE INDEX `billing_app_credential_app_idx` ON `billing_app_credential` (`app_id`);

CREATE TABLE `billing_party` (
  `id` text PRIMARY KEY NOT NULL,
  `display_name` text NOT NULL,
  `primary_email` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);

CREATE TABLE `billing_subject` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `subject_type` text NOT NULL,
  `subject_id` text NOT NULL,
  `party_id` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `display_name` text NOT NULL,
  `billing_email` text,
  `billing_name` text,
  `billing_contacts_json` text DEFAULT '[]' NOT NULL,
  `metadata_json` text DEFAULT '{}' NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`party_id`) REFERENCES `billing_party`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE UNIQUE INDEX `billing_subject_app_subject_uidx` ON `billing_subject` (`app_id`, `subject_type`, `subject_id`);
CREATE INDEX `billing_subject_party_idx` ON `billing_subject` (`party_id`);

CREATE TABLE `billing_account` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `subject_row_id` text NOT NULL,
  `party_id` text NOT NULL,
  `provider` text DEFAULT 'stripe' NOT NULL,
  `provider_customer_id` text,
  `billing_email` text,
  `billing_name` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`subject_row_id`) REFERENCES `billing_subject`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`party_id`) REFERENCES `billing_party`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE UNIQUE INDEX `billing_account_subject_uidx` ON `billing_account` (`app_id`, `subject_row_id`);
CREATE UNIQUE INDEX `billing_account_provider_customer_uidx` ON `billing_account` (`provider`, `provider_customer_id`);

CREATE TABLE `billing_subscription` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `billing_account_id` text NOT NULL,
  `provider` text DEFAULT 'stripe' NOT NULL,
  `provider_subscription_id` text,
  `provider_schedule_id` text,
  `plan_code` text DEFAULT 'free' NOT NULL,
  `price_code` text,
  `interval` text,
  `status` text DEFAULT 'free' NOT NULL,
  `current_period_start` integer,
  `current_period_end` integer,
  `trial_start` integer,
  `trial_end` integer,
  `cancel_at` integer,
  `cancel_at_period_end` integer DEFAULT false NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `billing_subscription_account_idx` ON `billing_subscription` (`billing_account_id`);
CREATE UNIQUE INDEX `billing_subscription_provider_subscription_uidx` ON `billing_subscription` (`provider`, `provider_subscription_id`);

CREATE TABLE `billing_entitlement` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `subject_row_id` text NOT NULL,
  `billing_account_id` text NOT NULL,
  `key` text NOT NULL,
  `active` integer NOT NULL,
  `value_type` text DEFAULT 'boolean' NOT NULL,
  `value_json` text DEFAULT 'true' NOT NULL,
  `source` text NOT NULL,
  `reason` text NOT NULL,
  `valid_from` integer,
  `valid_until` integer,
  `generated_at` integer NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`subject_row_id`) REFERENCES `billing_subject`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `billing_entitlement_subject_key_uidx` ON `billing_entitlement` (`app_id`, `subject_row_id`, `key`);
CREATE INDEX `billing_entitlement_key_active_idx` ON `billing_entitlement` (`app_id`, `key`, `active`);

CREATE TABLE `billing_product` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `provider_product_id` text,
  `active` integer DEFAULT true NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `billing_product_app_code_uidx` ON `billing_product` (`app_id`, `code`);

CREATE TABLE `billing_plan` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `product_id` text,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`product_id`) REFERENCES `billing_product`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `billing_plan_app_code_uidx` ON `billing_plan` (`app_id`, `code`);

CREATE TABLE `billing_price` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `plan_id` text NOT NULL,
  `code` text NOT NULL,
  `interval` text,
  `provider` text DEFAULT 'stripe' NOT NULL,
  `provider_price_id` text,
  `currency` text DEFAULT 'jpy' NOT NULL,
  `unit_amount` integer,
  `active` integer DEFAULT true NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`plan_id`) REFERENCES `billing_plan`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `billing_price_app_code_uidx` ON `billing_price` (`app_id`, `code`);
CREATE UNIQUE INDEX `billing_price_provider_uidx` ON `billing_price` (`provider`, `provider_price_id`);

CREATE TABLE `billing_entitlement_rule` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `plan_code` text NOT NULL,
  `entitlement_key` text NOT NULL,
  `value_type` text DEFAULT 'boolean' NOT NULL,
  `value_json` text DEFAULT 'true' NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `billing_entitlement_rule_plan_key_uidx` ON `billing_entitlement_rule` (`app_id`, `plan_code`, `entitlement_key`);

CREATE TABLE `billing_redirect_template` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `key` text NOT NULL,
  `success_url` text NOT NULL,
  `cancel_url` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `billing_redirect_template_key_uidx` ON `billing_redirect_template` (`app_id`, `key`);

CREATE TABLE `billing_api_idempotency` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `method` text NOT NULL,
  `path` text NOT NULL,
  `request_hash` text NOT NULL,
  `status_code` integer,
  `response_json` text,
  `expires_at` integer NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `billing_api_idempotency_key_uidx` ON `billing_api_idempotency` (`app_id`, `idempotency_key`);
CREATE INDEX `billing_api_idempotency_expiry_idx` ON `billing_api_idempotency` (`expires_at`);

CREATE TABLE `billing_provider_event` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text,
  `provider` text DEFAULT 'stripe' NOT NULL,
  `provider_event_id` text NOT NULL,
  `event_type` text NOT NULL,
  `scope` text DEFAULT 'billing' NOT NULL,
  `payload_hash` text NOT NULL,
  `processing_status` text NOT NULL,
  `receipt_status` text NOT NULL,
  `billing_account_id` text,
  `provider_customer_id` text,
  `provider_subscription_id` text,
  `failure_reason` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `processed_at` integer,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE UNIQUE INDEX `billing_provider_event_uidx` ON `billing_provider_event` (`provider`, `provider_event_id`, `scope`);
CREATE INDEX `billing_provider_event_status_idx` ON `billing_provider_event` (`processing_status`, `created_at`);
