ALTER TABLE `booking` ADD COLUMN `attendance_status` text DEFAULT 'not_checked' NOT NULL;
--> statement-breakpoint
ALTER TABLE `booking` ADD COLUMN `attendance_marked_at` integer;
--> statement-breakpoint
ALTER TABLE `booking` ADD COLUMN `attendance_marked_by_user_id` text REFERENCES `user`(`id`) ON DELETE set null;
--> statement-breakpoint
UPDATE `booking`
SET
  `attendance_status` = 'no_show',
  `attendance_marked_at` = `no_show_marked_at`
WHERE `status` = 'no_show';
