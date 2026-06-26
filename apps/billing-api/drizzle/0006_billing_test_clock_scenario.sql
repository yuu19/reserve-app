CREATE TABLE `billing_test_clock_scenario` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `source_subject_row_id` text NOT NULL,
  `test_subject_row_id` text NOT NULL,
  `billing_account_id` text NOT NULL,
  `provider` text DEFAULT 'stripe' NOT NULL,
  `provider_test_clock_id` text NOT NULL,
  `provider_customer_id` text,
  `provider_subscription_id` text,
  `scenario_type` text NOT NULL,
  `frozen_time` integer NOT NULL,
  `target_frozen_time` integer,
  `status` text NOT NULL,
  `last_advanced_at` integer,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_subject_row_id`) REFERENCES `billing_subject`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`test_subject_row_id`) REFERENCES `billing_subject`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `billing_test_clock_scenario_clock_uidx` ON `billing_test_clock_scenario` (`provider`, `provider_test_clock_id`);
CREATE UNIQUE INDEX `billing_test_clock_scenario_test_subject_uidx` ON `billing_test_clock_scenario` (`app_id`, `test_subject_row_id`);
CREATE INDEX `billing_test_clock_scenario_source_idx` ON `billing_test_clock_scenario` (`app_id`, `source_subject_row_id`);
CREATE INDEX `billing_test_clock_scenario_status_idx` ON `billing_test_clock_scenario` (`status`, `updated_at`);
