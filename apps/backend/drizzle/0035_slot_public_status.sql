ALTER TABLE `slot` ADD COLUMN `public_status` text DEFAULT 'public' NOT NULL;

CREATE INDEX `slot_store_public_status_idx` ON `slot` (`store_id`, `public_status`, `status`, `start_at`);
