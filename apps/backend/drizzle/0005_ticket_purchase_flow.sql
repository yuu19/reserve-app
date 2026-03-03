ALTER TABLE `ticket_type` ADD `is_for_sale` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `ticket_type` ADD `stripe_price_id` text;
--> statement-breakpoint
CREATE TABLE `ticket_purchase` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`ticket_type_id` text NOT NULL,
	`payment_method` text NOT NULL,
	`status` text NOT NULL,
	`ticket_pack_id` text,
	`stripe_checkout_session_id` text,
	`approved_by_user_id` text,
	`approved_at` integer,
	`rejected_by_user_id` text,
	`rejected_at` integer,
	`reject_reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `participant`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_type`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_pack_id`) REFERENCES `ticket_pack`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`rejected_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ticket_purchase_org_status_created_idx` ON `ticket_purchase` (`organization_id`,`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `ticket_purchase_org_participant_created_idx` ON `ticket_purchase` (`organization_id`,`participant_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_purchase_stripe_checkout_session_uidx` ON `ticket_purchase` (`stripe_checkout_session_id`);
