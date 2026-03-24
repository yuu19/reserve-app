CREATE TABLE `organization_billing` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`plan_code` text DEFAULT 'free' NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`stripe_price_id` text,
	`billing_interval` text,
	`subscription_status` text DEFAULT 'free' NOT NULL,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`current_period_start` integer,
	`current_period_end` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_organization_uidx` ON `organization_billing` (`organization_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_stripe_customer_uidx` ON `organization_billing` (`stripe_customer_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_billing_stripe_subscription_uidx` ON `organization_billing` (`stripe_subscription_id`);
--> statement-breakpoint
INSERT INTO `organization_billing` (
	`id`,
	`organization_id`,
	`plan_code`,
	`subscription_status`
)
SELECT
	hex(randomblob(16)),
	`id`,
	'free',
	'free'
FROM `organization`
WHERE `id` NOT IN (
	SELECT `organization_id`
	FROM `organization_billing`
);
