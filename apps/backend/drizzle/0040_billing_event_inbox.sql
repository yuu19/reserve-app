CREATE TABLE `billing_event_inbox` (
  `id` text PRIMARY KEY NOT NULL,
  `event_id` text NOT NULL,
  `schema_version` integer NOT NULL,
  `app_id` text NOT NULL,
  `subject_type` text NOT NULL,
  `subject_id` text NOT NULL,
  `revision` integer NOT NULL,
  `reason` text NOT NULL,
  `payload_json` text NOT NULL,
  `processing_status` text DEFAULT 'received' NOT NULL,
  `outcome` text,
  `attempt_count` integer DEFAULT 0 NOT NULL,
  `last_error` text,
  `lease_token` text,
  `lease_expires_at` integer,
  `received_at` integer NOT NULL,
  `processed_at` integer,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);

CREATE UNIQUE INDEX `billing_event_inbox_event_uidx`
  ON `billing_event_inbox` (`event_id`);
CREATE UNIQUE INDEX `billing_event_inbox_subject_revision_uidx`
  ON `billing_event_inbox` (`app_id`, `subject_type`, `subject_id`, `revision`);
CREATE INDEX `billing_event_inbox_status_idx`
  ON `billing_event_inbox` (`processing_status`, `lease_expires_at`, `received_at`);

CREATE TABLE `billing_event_consumer_cursor` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `subject_type` text NOT NULL,
  `subject_id` text NOT NULL,
  `last_revision` integer DEFAULT 0 NOT NULL,
  `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
  `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);

CREATE UNIQUE INDEX `billing_event_consumer_cursor_subject_uidx`
  ON `billing_event_consumer_cursor` (`app_id`, `subject_type`, `subject_id`);
