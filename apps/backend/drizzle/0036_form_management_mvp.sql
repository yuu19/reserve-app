PRAGMA foreign_keys=OFF;
--> statement-breakpoint
DROP TABLE IF EXISTS `booking_answer`;
--> statement-breakpoint
DROP TABLE IF EXISTS `public_site_intake_field`;
--> statement-breakpoint
CREATE TABLE `form_templates` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organization`(`id`) ON DELETE cascade,
  `store_id` text NOT NULL REFERENCES `store`(`id`) ON DELETE cascade,
  `form_type` text NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `status` text DEFAULT 'draft' NOT NULL,
  `current_published_version_id` text,
  `created_by_user_id` text REFERENCES `user`(`id`) ON DELETE set null,
  `updated_by_user_id` text REFERENCES `user`(`id`) ON DELETE set null,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `archived_at` integer
);
--> statement-breakpoint
CREATE INDEX `form_templates_store_type_idx` ON `form_templates` (`organization_id`, `store_id`, `form_type`, `status`);
--> statement-breakpoint
CREATE TABLE `form_fields` (
  `id` text PRIMARY KEY NOT NULL,
  `form_template_id` text NOT NULL REFERENCES `form_templates`(`id`) ON DELETE cascade,
  `field_key` text NOT NULL,
  `field_type` text NOT NULL,
  `label` text NOT NULL,
  `description` text,
  `placeholder` text,
  `required` integer DEFAULT 0 NOT NULL,
  `options_json` text,
  `validation_json` text,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_fields_template_key_uidx` ON `form_fields` (`form_template_id`, `field_key`);
--> statement-breakpoint
CREATE INDEX `form_fields_template_order_idx` ON `form_fields` (`form_template_id`, `sort_order`);
--> statement-breakpoint
CREATE TABLE `form_template_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `form_template_id` text NOT NULL REFERENCES `form_templates`(`id`) ON DELETE cascade,
  `organization_id` text NOT NULL REFERENCES `organization`(`id`) ON DELETE cascade,
  `store_id` text NOT NULL REFERENCES `store`(`id`) ON DELETE cascade,
  `form_type` text NOT NULL,
  `version_number` integer NOT NULL,
  `name_snapshot` text NOT NULL,
  `description_snapshot` text,
  `fields_snapshot_json` text NOT NULL,
  `published_by_user_id` text REFERENCES `user`(`id`) ON DELETE set null,
  `published_at` integer NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_template_versions_template_version_uidx` ON `form_template_versions` (`form_template_id`, `version_number`);
--> statement-breakpoint
CREATE INDEX `form_template_versions_store_idx` ON `form_template_versions` (`organization_id`, `store_id`, `form_type`);
--> statement-breakpoint
CREATE TABLE `form_assignments` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organization`(`id`) ON DELETE cascade,
  `store_id` text NOT NULL REFERENCES `store`(`id`) ON DELETE cascade,
  `form_type` text NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `form_template_id` text NOT NULL REFERENCES `form_templates`(`id`) ON DELETE cascade,
  `created_by_user_id` text REFERENCES `user`(`id`) ON DELETE set null,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_assignments_target_type_uidx` ON `form_assignments` (`organization_id`, `store_id`, `form_type`, `target_type`, `target_id`);
--> statement-breakpoint
CREATE INDEX `form_assignments_template_idx` ON `form_assignments` (`form_template_id`);
--> statement-breakpoint
CREATE TABLE `form_submissions` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organization`(`id`) ON DELETE cascade,
  `store_id` text NOT NULL REFERENCES `store`(`id`) ON DELETE cascade,
  `form_template_id` text NOT NULL REFERENCES `form_templates`(`id`) ON DELETE restrict,
  `form_template_version_id` text NOT NULL REFERENCES `form_template_versions`(`id`) ON DELETE restrict,
  `form_type` text NOT NULL,
  `booking_id` text REFERENCES `booking`(`id`) ON DELETE cascade,
  `participant_id` text REFERENCES `participant`(`id`) ON DELETE set null,
  `customer_name_snapshot` text,
  `customer_email_snapshot` text,
  `source` text NOT NULL,
  `submitted_by_user_id` text REFERENCES `user`(`id`) ON DELETE set null,
  `submitted_at` integer NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_submissions_booking_template_uidx` ON `form_submissions` (`booking_id`, `form_template_id`);
--> statement-breakpoint
CREATE INDEX `form_submissions_booking_idx` ON `form_submissions` (`booking_id`);
--> statement-breakpoint
CREATE INDEX `form_submissions_template_idx` ON `form_submissions` (`form_template_id`, `submitted_at`);
--> statement-breakpoint
CREATE INDEX `form_submissions_store_idx` ON `form_submissions` (`organization_id`, `store_id`, `submitted_at`);
--> statement-breakpoint
CREATE TABLE `form_answers` (
  `id` text PRIMARY KEY NOT NULL,
  `form_submission_id` text NOT NULL REFERENCES `form_submissions`(`id`) ON DELETE cascade,
  `field_key` text NOT NULL,
  `field_type` text NOT NULL,
  `label_snapshot` text NOT NULL,
  `value_json` text NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_answers_submission_field_uidx` ON `form_answers` (`form_submission_id`, `field_key`);
--> statement-breakpoint
CREATE INDEX `form_answers_submission_idx` ON `form_answers` (`form_submission_id`, `sort_order`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
