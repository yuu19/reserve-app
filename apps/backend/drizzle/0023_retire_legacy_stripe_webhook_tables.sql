ALTER TABLE `billing_provider_event` ADD `failure_stage` text;
--> statement-breakpoint
ALTER TABLE `billing_provider_event` ADD `last_failure_reason` text;
--> statement-breakpoint
ALTER TABLE `billing_provider_event` ADD `last_failure_at` integer;
--> statement-breakpoint
INSERT OR IGNORE INTO `billing_provider_event` (
  `id`,
  `provider`,
  `provider_event_id`,
  `event_type`,
  `scope`,
  `payload_hash`,
  `processing_status`,
  `receipt_status`,
  `duplicate_detected`,
  `duplicate_detected_at`,
  `attempt_count`,
  `processing_started_at`,
  `last_attempt_at`,
  `processing_stale_after_ms`,
  `failure_reason`,
  `failure_stage`,
  `last_failure_reason`,
  `last_failure_at`,
  `billing_account_id`,
  `provider_customer_id`,
  `provider_subscription_id`,
  `created_at`,
  `updated_at`,
  `processed_at`
)
SELECT
  'billing_provider_event_failure_' || f.`id`,
  'stripe',
  coalesce(f.`event_id`, 'legacy_failure:' || f.`id`),
  coalesce(f.`event_type`, 'stripe.webhook.' || f.`failure_stage`),
  f.`scope`,
  'legacy-unavailable',
  'failed',
  CASE WHEN f.`failure_stage` = 'signature_verification' THEN 'rejected' ELSE 'received' END,
  0,
  NULL,
  1,
  f.`created_at`,
  f.`created_at`,
  120000,
  f.`failure_reason`,
  f.`failure_stage`,
  f.`failure_reason`,
  f.`created_at`,
  a.`id`,
  f.`stripe_customer_id`,
  f.`stripe_subscription_id`,
  f.`created_at`,
  f.`created_at`,
  NULL
FROM `stripe_webhook_failure` f
LEFT JOIN `billing_account` a
  ON a.`subject_type` = 'organization'
  AND a.`subject_id` = f.`organization_id`;
--> statement-breakpoint
UPDATE `billing_provider_event`
SET
  `failure_stage` = (
    SELECT f.`failure_stage`
    FROM `stripe_webhook_failure` f
    WHERE f.`event_id` = `billing_provider_event`.`provider_event_id`
      AND f.`scope` = `billing_provider_event`.`scope`
    ORDER BY f.`created_at` DESC, f.`id` DESC
    LIMIT 1
  ),
  `last_failure_reason` = (
    SELECT f.`failure_reason`
    FROM `stripe_webhook_failure` f
    WHERE f.`event_id` = `billing_provider_event`.`provider_event_id`
      AND f.`scope` = `billing_provider_event`.`scope`
    ORDER BY f.`created_at` DESC, f.`id` DESC
    LIMIT 1
  ),
  `last_failure_at` = (
    SELECT f.`created_at`
    FROM `stripe_webhook_failure` f
    WHERE f.`event_id` = `billing_provider_event`.`provider_event_id`
      AND f.`scope` = `billing_provider_event`.`scope`
    ORDER BY f.`created_at` DESC, f.`id` DESC
    LIMIT 1
  ),
  `updated_at` = coalesce(
    (
      SELECT max(f.`created_at`)
      FROM `stripe_webhook_failure` f
      WHERE f.`event_id` = `billing_provider_event`.`provider_event_id`
        AND f.`scope` = `billing_provider_event`.`scope`
    ),
    `updated_at`
  )
WHERE `provider` = 'stripe'
  AND EXISTS (
    SELECT 1
    FROM `stripe_webhook_failure` f
    WHERE f.`event_id` = `billing_provider_event`.`provider_event_id`
      AND f.`scope` = `billing_provider_event`.`scope`
  );
--> statement-breakpoint
INSERT OR IGNORE INTO `billing_provider_event` (
  `id`,
  `provider`,
  `provider_event_id`,
  `event_type`,
  `scope`,
  `payload_hash`,
  `processing_status`,
  `receipt_status`,
  `duplicate_detected`,
  `duplicate_detected_at`,
  `attempt_count`,
  `processing_started_at`,
  `last_attempt_at`,
  `processing_stale_after_ms`,
  `failure_reason`,
  `failure_stage`,
  `last_failure_reason`,
  `last_failure_at`,
  `billing_account_id`,
  `provider_customer_id`,
  `provider_subscription_id`,
  `created_at`,
  `updated_at`,
  `processed_at`
)
SELECT
  'billing_provider_event_legacy_' || e.`id`,
  'stripe',
  e.`id`,
  e.`event_type`,
  e.`scope`,
  'legacy-unavailable',
  e.`processing_status`,
  e.`receipt_status`,
  e.`duplicate_detected`,
  e.`duplicate_detected_at`,
  1,
  e.`created_at`,
  e.`updated_at`,
  120000,
  e.`failure_reason`,
  NULL,
  e.`failure_reason`,
  CASE WHEN e.`processing_status` = 'failed' THEN e.`updated_at` ELSE NULL END,
  a.`id`,
  e.`stripe_customer_id`,
  e.`stripe_subscription_id`,
  e.`created_at`,
  e.`updated_at`,
  e.`processed_at`
FROM `stripe_webhook_event` e
LEFT JOIN `billing_account` a
  ON a.`subject_type` = 'organization'
  AND a.`subject_id` = e.`organization_id`;
--> statement-breakpoint
DROP TABLE IF EXISTS `stripe_webhook_failure`;
--> statement-breakpoint
DROP TABLE IF EXISTS `stripe_webhook_event`;
