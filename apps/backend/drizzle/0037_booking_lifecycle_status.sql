PRAGMA foreign_keys=OFF;
--> statement-breakpoint
UPDATE `booking`
SET `status` = CASE `status`
  WHEN 'cancelled_by_participant' THEN 'cancelled'
  WHEN 'cancelled_by_staff' THEN 'cancelled'
  WHEN 'rejected_by_staff' THEN 'rejected'
  ELSE `status`
END
WHERE `status` IN ('cancelled_by_participant', 'cancelled_by_staff', 'rejected_by_staff');
--> statement-breakpoint
UPDATE `booking_audit_log`
SET `action` = CASE `action`
  WHEN 'booking.application_received' THEN 'created'
  WHEN 'booking.staff_created' THEN 'created'
  WHEN 'booking.created' THEN 'created'
  WHEN 'booking.approved' THEN 'approved'
  WHEN 'booking.rejected_by_staff' THEN 'rejected'
  WHEN 'booking.cancelled_by_participant' THEN 'cancelled_by_customer'
  WHEN 'booking.cancelled_by_staff' THEN 'cancelled_by_staff'
  WHEN 'booking.rescheduled' THEN 'rescheduled'
  WHEN 'booking.attendance_marked' THEN 'checked_in'
  WHEN 'booking.no_show' THEN 'no_show_marked'
  ELSE `action`
END
WHERE `action` IN (
  'booking.application_received',
  'booking.staff_created',
  'booking.created',
  'booking.approved',
  'booking.rejected_by_staff',
  'booking.cancelled_by_participant',
  'booking.cancelled_by_staff',
  'booking.rescheduled',
  'booking.attendance_marked',
  'booking.no_show'
);
--> statement-breakpoint
DROP INDEX IF EXISTS `booking_audit_log_booking_action_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `booking_audit_log_org_created_idx`;
--> statement-breakpoint
CREATE TABLE `__new_booking_audit_log` (
  `id` text PRIMARY KEY NOT NULL,
  `booking_id` text NOT NULL REFERENCES `booking`(`id`) ON DELETE cascade,
  `organization_id` text NOT NULL REFERENCES `organization`(`id`) ON DELETE cascade,
  `store_id` text NOT NULL REFERENCES `store`(`id`) ON DELETE cascade,
  `actor_user_id` text REFERENCES `user`(`id`) ON DELETE set null,
  `action` text NOT NULL,
  `metadata` text,
  `ip_address` text,
  `user_agent` text,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_booking_audit_log` (
  `id`,
  `booking_id`,
  `organization_id`,
  `store_id`,
  `actor_user_id`,
  `action`,
  `metadata`,
  `ip_address`,
  `user_agent`,
  `created_at`
)
SELECT
  `id`,
  `booking_id`,
  `organization_id`,
  `store_id`,
  `actor_user_id`,
  `action`,
  `metadata`,
  `ip_address`,
  `user_agent`,
  `created_at`
FROM `booking_audit_log`;
--> statement-breakpoint
DROP TABLE `booking_audit_log`;
--> statement-breakpoint
ALTER TABLE `__new_booking_audit_log` RENAME TO `booking_audit_log`;
--> statement-breakpoint
CREATE INDEX `booking_audit_log_booking_action_idx` ON `booking_audit_log` (`booking_id`, `action`);
--> statement-breakpoint
CREATE INDEX `booking_audit_log_org_created_idx` ON `booking_audit_log` (`organization_id`, `created_at`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
