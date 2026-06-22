ALTER TABLE `billing_subscription` ADD `provider_price_id` text;
ALTER TABLE `billing_subscription` ADD `price_resolution` text DEFAULT 'not_applicable' NOT NULL;
