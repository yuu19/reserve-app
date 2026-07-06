CREATE TABLE `billing_subscription_addon_item` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `billing_subscription_id` text NOT NULL,
  `addon_code` text NOT NULL,
  `addon_price_code` text,
  `provider` text DEFAULT 'stripe' NOT NULL,
  `provider_subscription_item_id` text,
  `provider_price_id` text,
  `quantity` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`billing_subscription_id`) REFERENCES `billing_subscription`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `billing_subscription_addon_item_subscription_addon_uidx` ON `billing_subscription_addon_item` (`billing_subscription_id`, `addon_code`);
CREATE UNIQUE INDEX `billing_subscription_addon_item_provider_item_uidx` ON `billing_subscription_addon_item` (`provider`, `provider_subscription_item_id`);
CREATE INDEX `billing_subscription_addon_item_app_subscription_idx` ON `billing_subscription_addon_item` (`app_id`, `billing_subscription_id`);
