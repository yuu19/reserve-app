ALTER TABLE `organization_billing` ADD `trial_started_at` integer;
--> statement-breakpoint
ALTER TABLE `organization_billing` ADD `trial_ended_at` integer;
--> statement-breakpoint
UPDATE `organization_billing`
SET `trial_started_at` = `current_period_start`
WHERE
	`trial_started_at` IS NULL
	AND `subscription_status` = 'trialing'
	AND `current_period_start` IS NOT NULL;
--> statement-breakpoint
UPDATE `organization_billing`
SET `trial_started_at` = (
	SELECT min(`organization_billing_audit_event`.`created_at`)
	FROM `organization_billing_audit_event`
	WHERE
		`organization_billing_audit_event`.`organization_id` = `organization_billing`.`organization_id`
		AND `organization_billing_audit_event`.`source_kind` = 'trial_start'
)
WHERE
	`trial_started_at` IS NULL
	AND EXISTS (
		SELECT 1
		FROM `organization_billing_audit_event`
		WHERE
			`organization_billing_audit_event`.`organization_id` = `organization_billing`.`organization_id`
			AND `organization_billing_audit_event`.`source_kind` = 'trial_start'
	);
