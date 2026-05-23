ALTER TABLE `billing_payment_issue_event` ADD `provider_status` text;
--> statement-breakpoint
ALTER TABLE `billing_payment_issue_event` ADD `owner_facing_status` text;
--> statement-breakpoint
ALTER TABLE `billing_audit_event` ADD `sequence_number` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `billing_audit_event_account_sequence_idx` ON `billing_audit_event` (`billing_account_id`, `sequence_number`);
--> statement-breakpoint
ALTER TABLE `billing_signal` ADD `sequence_number` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `billing_signal_account_sequence_idx` ON `billing_signal` (`billing_account_id`, `sequence_number`);
--> statement-breakpoint
DROP INDEX IF EXISTS `billing_notification_dedupe_uidx`;
--> statement-breakpoint
ALTER TABLE `billing_notification` ADD `channel` text DEFAULT 'email' NOT NULL;
--> statement-breakpoint
ALTER TABLE `billing_notification` ADD `sequence_number` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `billing_notification` ADD `attempt_number` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `billing_notification` ADD `provider_customer_id` text;
--> statement-breakpoint
ALTER TABLE `billing_notification` ADD `provider_subscription_id` text;
--> statement-breakpoint
ALTER TABLE `billing_notification` ADD `plan_state` text;
--> statement-breakpoint
ALTER TABLE `billing_notification` ADD `subscription_status` text;
--> statement-breakpoint
ALTER TABLE `billing_notification` ADD `payment_method_status` text;
--> statement-breakpoint
ALTER TABLE `billing_notification` ADD `trial_ends_at` integer;
--> statement-breakpoint
CREATE INDEX `billing_notification_dedupe_idx` ON `billing_notification` (`billing_account_id`, `notification_kind`, `recipient_email`, `provider_event_id`);
--> statement-breakpoint
CREATE INDEX `billing_notification_account_sequence_idx` ON `billing_notification` (`billing_account_id`, `sequence_number`);
--> statement-breakpoint
ALTER TABLE `billing_document_reference` ADD `provider_customer_id` text;
--> statement-breakpoint
ALTER TABLE `billing_document_reference` ADD `provider_subscription_id` text;
--> statement-breakpoint
INSERT OR IGNORE INTO `billing_account` (
  `id`,
  `subject_type`,
  `subject_id`,
  `provider`,
  `provider_customer_id`,
  `created_at`,
  `updated_at`
)
SELECT
  'billing_account_' || `organization_id`,
  'organization',
  `organization_id`,
  'stripe',
  `stripe_customer_id`,
  coalesce(`created_at`, cast(unixepoch('subsecond') * 1000 as integer)),
  coalesce(`updated_at`, cast(unixepoch('subsecond') * 1000 as integer))
FROM `organization_billing`;
--> statement-breakpoint
INSERT OR IGNORE INTO `billing_subscription` (
  `id`,
  `billing_account_id`,
  `provider`,
  `provider_subscription_id`,
  `provider_schedule_id`,
  `plan_code`,
  `price_code`,
  `interval`,
  `status`,
  `current_period_start`,
  `current_period_end`,
  `trial_start`,
  `trial_end`,
  `cancel_at`,
  `cancel_at_period_end`,
  `created_at`,
  `updated_at`
)
SELECT
  'billing_subscription_' || ob.`organization_id`,
  a.`id`,
  'stripe',
  ob.`stripe_subscription_id`,
  NULL,
  ob.`plan_code`,
  ob.`stripe_price_id`,
  ob.`billing_interval`,
  ob.`subscription_status`,
  ob.`current_period_start`,
  ob.`current_period_end`,
  ob.`trial_started_at`,
  CASE
    WHEN ob.`subscription_status` = 'trialing' THEN ob.`current_period_end`
    ELSE ob.`trial_ended_at`
  END,
  NULL,
  ob.`cancel_at_period_end`,
  ob.`created_at`,
  ob.`updated_at`
FROM `organization_billing` ob
INNER JOIN `billing_account` a
  ON a.`subject_type` = 'organization'
  AND a.`subject_id` = ob.`organization_id`
WHERE NOT EXISTS (
  SELECT 1
  FROM `billing_subscription` existing
  WHERE existing.`billing_account_id` = a.`id`
);
--> statement-breakpoint
INSERT OR IGNORE INTO `billing_payment_issue` (
  `id`,
  `billing_account_id`,
  `billing_subscription_id`,
  `state`,
  `issue_started_at`,
  `issue_started_at_source`,
  `past_due_grace_ends_at`,
  `latest_provider_event_id`,
  `latest_invoice_id`,
  `latest_payment_intent_id`,
  `created_at`,
  `updated_at`
)
SELECT
  'billing_payment_issue_' || ob.`organization_id`,
  a.`id`,
  s.`id`,
  CASE
    WHEN ob.`subscription_status` = 'past_due'
      AND ob.`past_due_grace_ends_at` IS NOT NULL
      AND ob.`past_due_grace_ends_at` > cast(unixepoch('subsecond') * 1000 as integer)
      THEN 'past_due_grace_active'
    WHEN ob.`subscription_status` = 'past_due' THEN 'past_due_grace_expired'
    WHEN ob.`subscription_status` = 'unpaid' THEN 'unpaid'
    WHEN ob.`subscription_status` = 'incomplete' THEN 'incomplete'
    ELSE 'none'
  END,
  CASE
    WHEN ob.`subscription_status` IN ('past_due', 'unpaid', 'incomplete')
      THEN coalesce(ob.`payment_issue_started_at`, ob.`updated_at`)
    ELSE NULL
  END,
  CASE
    WHEN ob.`subscription_status` IN ('past_due', 'unpaid', 'incomplete')
      THEN 'application_receipt_time'
    ELSE 'none'
  END,
  CASE
    WHEN ob.`subscription_status` = 'past_due' THEN ob.`past_due_grace_ends_at`
    ELSE NULL
  END,
  NULL,
  NULL,
  NULL,
  ob.`created_at`,
  ob.`updated_at`
FROM `organization_billing` ob
INNER JOIN `billing_account` a
  ON a.`subject_type` = 'organization'
  AND a.`subject_id` = ob.`organization_id`
LEFT JOIN `billing_subscription` s
  ON s.`id` = (
    SELECT latest.`id`
    FROM `billing_subscription` latest
    WHERE latest.`billing_account_id` = a.`id`
    ORDER BY latest.`updated_at` DESC
    LIMIT 1
  )
WHERE NOT EXISTS (
  SELECT 1
  FROM `billing_payment_issue` existing
  WHERE existing.`billing_account_id` = a.`id`
);
--> statement-breakpoint
INSERT OR IGNORE INTO `billing_audit_event` (
  `id`,
  `billing_account_id`,
  `sequence_number`,
  `source_kind`,
  `source_context`,
  `previous_snapshot_json`,
  `next_snapshot_json`,
  `provider`,
  `provider_event_id`,
  `provider_customer_id`,
  `provider_subscription_id`,
  `created_at`
)
SELECT
  e.`id`,
  a.`id`,
  e.`sequence_number`,
  e.`source_kind`,
  e.`source_context`,
  json_object(
    'planCode', e.`previous_plan_code`,
    'planState', e.`previous_plan_state`,
    'subscriptionStatus', e.`previous_subscription_status`,
    'paymentMethodStatus', e.`previous_payment_method_status`,
    'entitlementState', e.`previous_entitlement_state`,
    'billingInterval', e.`previous_billing_interval`,
    'stripeCustomerId', e.`stripe_customer_id`,
    'stripeSubscriptionId', e.`stripe_subscription_id`
  ),
  json_object(
    'planCode', e.`next_plan_code`,
    'planState', e.`next_plan_state`,
    'subscriptionStatus', e.`next_subscription_status`,
    'paymentMethodStatus', e.`next_payment_method_status`,
    'entitlementState', e.`next_entitlement_state`,
    'billingInterval', e.`next_billing_interval`,
    'stripeCustomerId', e.`stripe_customer_id`,
    'stripeSubscriptionId', e.`stripe_subscription_id`
  ),
  CASE WHEN e.`stripe_customer_id` IS NOT NULL OR e.`stripe_subscription_id` IS NOT NULL OR e.`stripe_event_id` IS NOT NULL THEN 'stripe' ELSE NULL END,
  e.`stripe_event_id`,
  e.`stripe_customer_id`,
  e.`stripe_subscription_id`,
  e.`created_at`
FROM `organization_billing_audit_event` e
INNER JOIN `billing_account` a
  ON a.`subject_type` = 'organization'
  AND a.`subject_id` = e.`organization_id`;
--> statement-breakpoint
INSERT OR IGNORE INTO `billing_signal` (
  `id`,
  `billing_account_id`,
  `sequence_number`,
  `signal_kind`,
  `signal_status`,
  `source_kind`,
  `reason`,
  `app_snapshot_json`,
  `provider`,
  `provider_event_id`,
  `provider_customer_id`,
  `provider_subscription_id`,
  `provider_plan_state`,
  `provider_subscription_status`,
  `created_at`
)
SELECT
  s.`id`,
  a.`id`,
  s.`sequence_number`,
  s.`signal_kind`,
  s.`signal_status`,
  s.`source_kind`,
  s.`reason`,
  json_object(
    'planState', s.`app_plan_state`,
    'subscriptionStatus', s.`app_subscription_status`,
    'paymentMethodStatus', s.`app_payment_method_status`,
    'entitlementState', s.`app_entitlement_state`,
    'stripeCustomerId', s.`stripe_customer_id`,
    'stripeSubscriptionId', s.`stripe_subscription_id`
  ),
  CASE WHEN s.`stripe_customer_id` IS NOT NULL OR s.`stripe_subscription_id` IS NOT NULL OR s.`stripe_event_id` IS NOT NULL THEN 'stripe' ELSE NULL END,
  s.`stripe_event_id`,
  s.`stripe_customer_id`,
  s.`stripe_subscription_id`,
  s.`provider_plan_state`,
  s.`provider_subscription_status`,
  s.`created_at`
FROM `organization_billing_signal` s
INNER JOIN `billing_account` a
  ON a.`subject_type` = 'organization'
  AND a.`subject_id` = s.`organization_id`;
--> statement-breakpoint
INSERT OR IGNORE INTO `billing_notification` (
  `id`,
  `billing_account_id`,
  `notification_kind`,
  `channel`,
  `sequence_number`,
  `recipient_user_id`,
  `recipient_email`,
  `delivery_status`,
  `attempt_number`,
  `failure_reason`,
  `provider`,
  `provider_event_id`,
  `provider_customer_id`,
  `provider_subscription_id`,
  `plan_state`,
  `subscription_status`,
  `payment_method_status`,
  `trial_ends_at`,
  `created_at`,
  `sent_at`,
  `failed_at`
)
SELECT
  n.`id`,
  a.`id`,
  n.`notification_kind`,
  n.`channel`,
  n.`sequence_number`,
  n.`recipient_user_id`,
  coalesce(n.`recipient_email`, 'unassigned'),
  n.`delivery_state`,
  n.`attempt_number`,
  n.`failure_reason`,
  CASE WHEN n.`stripe_customer_id` IS NOT NULL OR n.`stripe_subscription_id` IS NOT NULL OR n.`stripe_event_id` IS NOT NULL THEN 'stripe' ELSE NULL END,
  n.`stripe_event_id`,
  n.`stripe_customer_id`,
  n.`stripe_subscription_id`,
  n.`plan_state`,
  n.`subscription_status`,
  n.`payment_method_status`,
  n.`trial_ends_at`,
  n.`created_at`,
  CASE WHEN n.`delivery_state` = 'sent' THEN n.`created_at` ELSE NULL END,
  CASE WHEN n.`delivery_state` = 'failed' THEN n.`created_at` ELSE NULL END
FROM `organization_billing_notification` n
INNER JOIN `billing_account` a
  ON a.`subject_type` = 'organization'
  AND a.`subject_id` = n.`organization_id`;
--> statement-breakpoint
WITH migrated_operation_attempts AS (
  SELECT
    o.`id`,
    a.`id` AS `billing_account_id`,
    CASE
      WHEN o.`purpose` = 'trial_start' THEN 'start_trial_subscription'
      WHEN o.`purpose` = 'payment_method_setup' THEN 'create_setup_checkout'
      WHEN o.`purpose` = 'billing_portal' THEN 'create_portal_session'
      ELSE 'create_subscription_checkout'
    END AS `purpose`,
    coalesce(
      o.`reuse_key`,
      CASE
        WHEN o.`purpose` = 'trial_start'
          THEN 'start_trial_subscription:organization:' || o.`organization_id` || ':premium'
        WHEN o.`purpose` = 'payment_method_setup'
          THEN 'create_setup_checkout:organization:' || o.`organization_id`
        WHEN o.`purpose` = 'billing_portal' AND o.`stripe_subscription_id` IS NOT NULL
          THEN 'create_portal_session:organization:' || o.`organization_id` || ':subscription_update:' || o.`stripe_subscription_id`
        WHEN o.`purpose` = 'billing_portal'
          THEN 'create_portal_session:organization:' || o.`organization_id` || ':default'
        ELSE 'create_subscription_checkout:organization:' || o.`organization_id` || ':premium:' || coalesce(o.`billing_interval`, 'month')
      END
    ) AS `reuse_key`,
    o.`state`,
    o.`handoff_url`,
    o.`handoff_expires_at`,
    coalesce(o.`provider`, 'stripe') AS `provider`,
    o.`stripe_customer_id`,
    o.`stripe_subscription_id`,
    o.`stripe_checkout_session_id`,
    o.`stripe_portal_session_id`,
    o.`idempotency_key`,
    o.`failure_reason`,
    o.`created_by_user_id`,
    o.`created_at`,
    o.`updated_at`
  FROM `organization_billing_operation_attempt` o
  INNER JOIN `billing_account` a
    ON a.`subject_type` = 'organization'
    AND a.`subject_id` = o.`organization_id`
),
numbered_operation_attempts AS (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY `billing_account_id`, `reuse_key`
      ORDER BY `created_at`, `id`
    ) AS `attempt_number`
  FROM migrated_operation_attempts
)
INSERT OR IGNORE INTO `billing_operation_attempt` (
  `id`,
  `billing_account_id`,
  `purpose`,
  `reuse_key`,
  `attempt_number`,
  `idempotency_key`,
  `state`,
  `handoff_url`,
  `handoff_expires_at`,
  `provider`,
  `provider_customer_id`,
  `provider_subscription_id`,
  `provider_checkout_session_id`,
  `provider_portal_session_id`,
  `failure_reason`,
  `created_by_user_id`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `billing_account_id`,
  `purpose`,
  `reuse_key`,
  `attempt_number`,
  `idempotency_key`,
  `state`,
  `handoff_url`,
  `handoff_expires_at`,
  `provider`,
  `stripe_customer_id`,
  `stripe_subscription_id`,
  `stripe_checkout_session_id`,
  `stripe_portal_session_id`,
  `failure_reason`,
  `created_by_user_id`,
  `created_at`,
  `updated_at`
FROM numbered_operation_attempts;
--> statement-breakpoint
INSERT OR IGNORE INTO `billing_document_reference` (
  `id`,
  `billing_account_id`,
  `document_kind`,
  `provider`,
  `provider_document_id`,
  `provider_customer_id`,
  `provider_subscription_id`,
  `hosted_invoice_url`,
  `invoice_pdf_url`,
  `receipt_url`,
  `availability`,
  `owner_facing_status`,
  `provider_derived`,
  `created_at`,
  `updated_at`
)
SELECT
  d.`id`,
  a.`id`,
  d.`document_kind`,
  'stripe',
  d.`provider_document_id`,
  e.`stripe_customer_id`,
  e.`stripe_subscription_id`,
  d.`hosted_invoice_url`,
  d.`invoice_pdf_url`,
  d.`receipt_url`,
  d.`availability`,
  d.`owner_facing_status`,
  d.`provider_derived`,
  d.`created_at`,
  d.`updated_at`
FROM `organization_billing_document_reference` d
INNER JOIN `billing_account` a
  ON a.`subject_type` = 'organization'
  AND a.`subject_id` = d.`organization_id`
LEFT JOIN `organization_billing_invoice_event` e
  ON e.`id` = d.`invoice_event_id`;
--> statement-breakpoint
INSERT OR IGNORE INTO `billing_payment_issue_event` (
  `id`,
  `billing_account_id`,
  `billing_subscription_id`,
  `event_type`,
  `provider`,
  `provider_event_id`,
  `provider_invoice_id`,
  `provider_payment_intent_id`,
  `provider_status`,
  `owner_facing_status`,
  `occurred_at`,
  `created_at`
)
SELECT
  e.`id`,
  a.`id`,
  s.`id`,
  e.`event_type`,
  'stripe',
  e.`stripe_event_id`,
  e.`stripe_invoice_id`,
  e.`stripe_payment_intent_id`,
  e.`provider_status`,
  e.`owner_facing_status`,
  e.`occurred_at`,
  e.`created_at`
FROM `organization_billing_invoice_event` e
INNER JOIN `billing_account` a
  ON a.`subject_type` = 'organization'
  AND a.`subject_id` = e.`organization_id`
LEFT JOIN `billing_subscription` s
  ON s.`billing_account_id` = a.`id`
  AND (
    e.`stripe_subscription_id` IS NULL
    OR s.`provider_subscription_id` = e.`stripe_subscription_id`
  );
--> statement-breakpoint
DROP TABLE IF EXISTS `organization_billing_document_reference`;
--> statement-breakpoint
DROP TABLE IF EXISTS `organization_billing_invoice_event`;
--> statement-breakpoint
DROP TABLE IF EXISTS `organization_billing_notification`;
--> statement-breakpoint
DROP TABLE IF EXISTS `organization_billing_signal`;
--> statement-breakpoint
DROP TABLE IF EXISTS `organization_billing_audit_event`;
--> statement-breakpoint
DROP TABLE IF EXISTS `organization_billing_operation_attempt`;
--> statement-breakpoint
DROP TABLE IF EXISTS `organization_billing`;
