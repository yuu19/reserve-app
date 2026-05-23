DROP INDEX IF EXISTS `billing_audit_event_account_sequence_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_audit_event_account_sequence_uidx` ON `billing_audit_event` (`billing_account_id`, `sequence_number`);
--> statement-breakpoint
DROP INDEX IF EXISTS `billing_signal_account_sequence_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_signal_account_sequence_uidx` ON `billing_signal` (`billing_account_id`, `sequence_number`);
--> statement-breakpoint
DROP INDEX IF EXISTS `billing_notification_account_sequence_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_notification_account_sequence_uidx` ON `billing_notification` (`billing_account_id`, `sequence_number`);
