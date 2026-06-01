ALTER TABLE `service` ADD COLUMN `public_status` text DEFAULT 'public' NOT NULL;
--> statement-breakpoint
CREATE INDEX `service_store_public_status_idx` ON `service` (`store_id`, `public_status`, `is_active`);
