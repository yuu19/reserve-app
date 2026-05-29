CREATE TABLE `public_site_setting` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`classroom_id` text NOT NULL,
	`site_name` text,
	`description` text,
	`address` text,
	`phone` text,
	`business_hours` text,
	`image_url` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`classroom_id`) REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_site_setting_classroom_uidx` ON `public_site_setting` (`organization_id`,`classroom_id`);
--> statement-breakpoint
CREATE INDEX `public_site_setting_organization_idx` ON `public_site_setting` (`organization_id`);
