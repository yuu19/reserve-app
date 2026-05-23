ALTER TABLE `billing_payment_issue_event` RENAME TO `billing_invoice_event`;
--> statement-breakpoint
DROP INDEX IF EXISTS `billing_payment_issue_event_account_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `billing_payment_issue_event_provider_uidx`;
--> statement-breakpoint
CREATE INDEX `billing_invoice_event_account_created_idx` ON `billing_invoice_event` (`billing_account_id`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_invoice_event_provider_uidx` ON `billing_invoice_event` (`provider`, `provider_event_id`, `event_type`);
--> statement-breakpoint
DROP INDEX IF EXISTS `billing_notification_dedupe_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_notification_dedupe_uidx` ON `billing_notification` (`billing_account_id`, `notification_kind`, `recipient_email`, `provider_event_id`, `attempt_number`, `delivery_status`);
