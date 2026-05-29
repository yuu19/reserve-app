PRAGMA foreign_keys=OFF;
--> statement-breakpoint
DROP INDEX IF EXISTS `classroom_organization_created_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `classroom_organization_slug_uidx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `public_site_setting_classroom_uidx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `classroom_member_classroom_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `classroom_member_user_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `classroom_member_classroom_user_uidx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `participant_organization_classroom_user_uidx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `participant_organization_classroom_email_uidx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `invitation_organization_classroom_status_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `ai_knowledge_document_scope_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `ai_knowledge_document_source_uidx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `ai_knowledge_chunk_lookup_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `ai_conversation_actor_subject_idx`;
--> statement-breakpoint
ALTER TABLE `classroom` RENAME TO `store`;
--> statement-breakpoint
ALTER TABLE `classroom_member` RENAME TO `store_member`;
--> statement-breakpoint
ALTER TABLE `public_site_setting` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `store_member` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `participant` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `invitation` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `invitation` RENAME COLUMN `accepted_classroom_member_id` TO `accepted_store_member_id`;
--> statement-breakpoint
ALTER TABLE `invitation_audit_log` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `service` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `recurring_schedule` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `recurring_schedule_exception` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `slot` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `booking` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `ticket_type` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `ticket_pack` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `ticket_purchase` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `ticket_ledger` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `booking_audit_log` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `ai_knowledge_document` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `ai_knowledge_chunk` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `ai_conversation` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
ALTER TABLE `ai_usage_event` RENAME COLUMN `classroom_id` TO `store_id`;
--> statement-breakpoint
UPDATE `invitation`
SET `subject_kind` = 'store_operator'
WHERE `subject_kind` = 'classroom_operator';
--> statement-breakpoint
UPDATE `ai_conversation`
SET `subject_type` = 'store'
WHERE `subject_type` = 'classroom';
--> statement-breakpoint
UPDATE `ai_usage_event`
SET `subject_type` = 'store'
WHERE `subject_type` = 'classroom';
--> statement-breakpoint
UPDATE `ai_usage_counter`
SET `scope_kind` = 'store'
WHERE `scope_kind` = 'classroom';
--> statement-breakpoint
UPDATE `billing_entitlement`
SET `key` = 'store.multiple'
WHERE `key` = 'classroom.multiple';
--> statement-breakpoint
CREATE INDEX `store_organization_created_idx` ON `store` (`organization_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_organization_slug_uidx` ON `store` (`organization_id`,`slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_site_setting_store_uidx` ON `public_site_setting` (`organization_id`,`store_id`);
--> statement-breakpoint
CREATE INDEX `store_member_store_idx` ON `store_member` (`store_id`);
--> statement-breakpoint
CREATE INDEX `store_member_user_idx` ON `store_member` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_member_store_user_uidx` ON `store_member` (`store_id`,`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `participant_organization_store_user_uidx` ON `participant` (`organization_id`,`store_id`,`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `participant_organization_store_email_uidx` ON `participant` (`organization_id`,`store_id`,`email`);
--> statement-breakpoint
CREATE INDEX `invitation_organization_store_status_idx` ON `invitation` (`organization_id`,`store_id`,`status`);
--> statement-breakpoint
CREATE INDEX `ai_knowledge_document_scope_idx` ON `ai_knowledge_document` (`organization_id`, `store_id`, `visibility`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_knowledge_document_source_uidx` ON `ai_knowledge_document` (`source_kind`, `source_path`, `organization_id`, `store_id`);
--> statement-breakpoint
CREATE INDEX `ai_knowledge_chunk_lookup_idx` ON `ai_knowledge_chunk` (`locale`, `visibility`, `organization_id`, `store_id`);
--> statement-breakpoint
CREATE INDEX `ai_conversation_actor_subject_idx` ON `ai_conversation` (`actor_user_id`, `subject_type`, `subject_id`, `store_id`, `updated_at`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
