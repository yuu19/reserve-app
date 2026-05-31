CREATE TABLE `booking_change_log` (
  `id` text PRIMARY KEY NOT NULL,
  `booking_id` text NOT NULL REFERENCES `booking`(`id`) ON DELETE cascade,
  `organization_id` text NOT NULL REFERENCES `organization`(`id`) ON DELETE cascade,
  `store_id` text NOT NULL REFERENCES `store`(`id`) ON DELETE cascade,
  `before_json` text NOT NULL,
  `after_json` text NOT NULL,
  `reason` text,
  `changed_by_user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE cascade,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `booking_change_log_booking_created_idx` ON `booking_change_log` (`booking_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `booking_change_log_org_created_idx` ON `booking_change_log` (`organization_id`, `created_at`);
