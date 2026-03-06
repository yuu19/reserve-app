PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_classroom` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_classroom` (`id`, `organization_id`, `slug`, `name`, `created_at`, `updated_at`)
SELECT
	`classroom`.`id`,
	`classroom`.`organization_id`,
	CASE
		WHEN `classroom`.`id` = `classroom`.`organization_id` THEN `organization`.`slug`
		ELSE `classroom`.`id`
	END,
	`classroom`.`name`,
	`classroom`.`created_at`,
	`classroom`.`updated_at`
FROM `classroom`
INNER JOIN `organization` ON `organization`.`id` = `classroom`.`organization_id`;
--> statement-breakpoint
DROP TABLE `classroom`;
--> statement-breakpoint
ALTER TABLE `__new_classroom` RENAME TO `classroom`;
--> statement-breakpoint
CREATE INDEX `classroom_organization_created_idx` ON `classroom` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `classroom_organization_slug_uidx` ON `classroom` (`organization_id`,`slug`);
--> statement-breakpoint
ALTER TABLE `invitation` ADD COLUMN `classroom_id` text REFERENCES `classroom`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `invitation` ADD COLUMN `classroom_role` text;
--> statement-breakpoint
CREATE INDEX `invitation_organization_classroom_status_idx` ON `invitation` (`organization_id`,`classroom_id`,`status`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
