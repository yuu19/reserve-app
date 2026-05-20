ALTER TABLE `organization_billing_operation_attempt` ADD `reuse_key` text;
--> statement-breakpoint
CREATE INDEX `organization_billing_operation_attempt_reuse_key_idx` ON `organization_billing_operation_attempt` (`organization_id`, `reuse_key`, `state`, `created_at`);
