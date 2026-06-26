CREATE TABLE `billing_invoice_event` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `billing_account_id` text NOT NULL,
  `billing_subscription_id` text,
  `provider` text DEFAULT 'stripe' NOT NULL,
  `provider_event_id` text,
  `event_type` text NOT NULL,
  `provider_customer_id` text,
  `provider_subscription_id` text,
  `provider_invoice_id` text,
  `provider_payment_intent_id` text,
  `provider_status` text,
  `owner_facing_status` text NOT NULL,
  `hosted_invoice_url` text,
  `invoice_pdf_url` text,
  `occurred_at` integer,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`billing_account_id`) REFERENCES `billing_account`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`billing_subscription_id`) REFERENCES `billing_subscription`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `billing_invoice_event_account_created_idx` ON `billing_invoice_event` (`billing_account_id`, `created_at`);
CREATE UNIQUE INDEX `billing_invoice_event_provider_uidx` ON `billing_invoice_event` (`provider`, `provider_event_id`, `event_type`);
CREATE INDEX `billing_invoice_event_invoice_idx` ON `billing_invoice_event` (`provider`, `provider_invoice_id`);
