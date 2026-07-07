ALTER TABLE `billing_subscription_addon_item` ADD `pending_quantity` integer;
ALTER TABLE `billing_subscription_addon_item` ADD `pending_effective_at` integer;
ALTER TABLE `billing_subscription_addon_item` ADD `pending_provider_schedule_id` text;
ALTER TABLE `billing_subscription_addon_item` ADD `pending_requested_at` integer;
