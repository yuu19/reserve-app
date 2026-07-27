ALTER TABLE `billing_subject` ADD `event_revision` integer DEFAULT 0 NOT NULL;

CREATE TABLE `billing_event_outbox` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `subject_row_id` text NOT NULL,
  `subject_type` text NOT NULL,
  `subject_id` text NOT NULL,
  `revision` integer NOT NULL,
  `event_type` text NOT NULL,
  `reason` text NOT NULL,
  `payload_json` text NOT NULL,
  `delivery_mode` text DEFAULT 'production' NOT NULL,
  `dispatch_status` text DEFAULT 'pending' NOT NULL,
  `dispatch_attempts` integer DEFAULT 0 NOT NULL,
  `next_attempt_at` integer NOT NULL,
  `last_attempt_at` integer,
  `published_at` integer,
  `failure_reason` text,
  `occurred_at` integer NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`subject_row_id`) REFERENCES `billing_subject`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `billing_event_outbox_subject_revision_uidx`
  ON `billing_event_outbox` (`subject_row_id`, `revision`);
CREATE INDEX `billing_event_outbox_dispatch_idx`
  ON `billing_event_outbox` (`dispatch_status`, `next_attempt_at`, `created_at`);
CREATE INDEX `billing_event_outbox_subject_idx`
  ON `billing_event_outbox` (`app_id`, `subject_type`, `subject_id`, `revision`);

CREATE TABLE `billing_addon_schedule_attempt` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `billing_account_id` text NOT NULL,
  `billing_subscription_id` text NOT NULL,
  `provider_subscription_id` text NOT NULL,
  `provider_schedule_id` text,
  `idempotency_key` text NOT NULL,
  `action` text NOT NULL,
  `state` text DEFAULT 'processing' NOT NULL,
  `target_items_json` text DEFAULT '[]' NOT NULL,
  `effective_at` integer,
  `failure_reason` text,
  `provider_applied_at` integer,
  `committed_at` integer,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`billing_subscription_id`) REFERENCES `billing_subscription`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `billing_addon_schedule_attempt_idempotency_uidx`
  ON `billing_addon_schedule_attempt` (`app_id`, `idempotency_key`);
CREATE INDEX `billing_addon_schedule_attempt_subscription_state_idx`
  ON `billing_addon_schedule_attempt` (`billing_subscription_id`, `state`, `updated_at`);
CREATE INDEX `billing_addon_schedule_attempt_provider_schedule_idx`
  ON `billing_addon_schedule_attempt` (`provider_schedule_id`);
