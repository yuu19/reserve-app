CREATE TABLE `public_site_intake_field` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organization`(`id`) ON DELETE cascade,
  `store_id` text NOT NULL REFERENCES `store`(`id`) ON DELETE cascade,
  `field_key` text NOT NULL,
  `label` text NOT NULL,
  `field_type` text NOT NULL,
  `required` integer DEFAULT 0 NOT NULL,
  `options_json` text,
  `help_text` text,
  `placeholder` text,
  `visible_on_public` integer DEFAULT 1 NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_site_intake_field_store_order_idx` ON `public_site_intake_field` (`organization_id`, `store_id`, `sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_site_intake_field_store_key_uidx` ON `public_site_intake_field` (`organization_id`, `store_id`, `field_key`);
