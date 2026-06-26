CREATE TABLE `billing_addon` (
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
CREATE UNIQUE INDEX `billing_addon_app_code_uidx` ON `billing_addon` (`app_id`, `code`);

CREATE TABLE `billing_addon_price` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `addon_id` text NOT NULL,
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
  FOREIGN KEY (`addon_id`) REFERENCES `billing_addon`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `billing_addon_price_app_code_uidx` ON `billing_addon_price` (`app_id`, `code`);
CREATE UNIQUE INDEX `billing_addon_price_provider_uidx` ON `billing_addon_price` (`provider`, `provider_price_id`);

CREATE TABLE `billing_addon_entitlement_rule` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `addon_code` text NOT NULL,
  `entitlement_key` text NOT NULL,
  `value_type` text DEFAULT 'number' NOT NULL,
  `value_json` text DEFAULT '1' NOT NULL,
  `aggregation` text DEFAULT 'increment' NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  FOREIGN KEY (`app_id`) REFERENCES `billing_app`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `billing_addon_entitlement_rule_addon_key_uidx` ON `billing_addon_entitlement_rule` (`app_id`, `addon_code`, `entitlement_key`);
